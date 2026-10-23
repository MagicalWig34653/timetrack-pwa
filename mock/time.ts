// Mock of the time tracking endpoints in contracts/openapi.yaml v0.2.0 (work models, places, segments, timer,
// day evaluations, time account, suggestions, device tokens, automation events). The backend implements these in C6.
import { addDays, DEFAULT_TIMEZONE, localDateOf, todayLocal, zonedTimeToInstant } from '../src/lib/time/dates.ts';
import type {
	DayMarkKind,
	DeviceToken,
	TriggerLink,
	Place,
	PlaceInput,
	Segment,
	Suggestion,
	WorkModel,
	WorkModelInput
} from '../src/lib/api/types.ts';
import { daysBetween, evaluateDay, modelForDate, workDayOf, type DayPrefs, type DerivedDayContext, type EvalSegment } from './evaluate.ts';

export interface TimeRequest {
	method: string;
	/** path including the `/api/v1` prefix and the query string */
	path: string;
	body?: any;
	ifMatch?: string;
}

export interface TimeResponse {
	status: number;
	body?: unknown;
}

interface Adjustment {
	kind: 'opening' | 'correction';
	date: string;
	seconds: number;
	reason: string;
}

interface StoredToken extends DeviceToken {
	secret: string;
}

interface StoredTriggerLink extends TriggerLink {
	secret: string;
}

interface TimeState {
	accountId: string;
	models: WorkModel[];
	places: Place[];
	segments: Segment[];
	prefs: Map<string, DayPrefs & { note?: string | null }>;
	adjustments: Adjustment[];
	suggestions: Suggestion[];
	tokens: StoredToken[];
	triggerLinks: StoredTriggerLink[];
	timerEvents: Map<string, string>;
	automationEvents: Map<string, { result: string; segmentId: string | null; suggestionId: string | null }>;
}

const uuid = () => crypto.randomUUID();
const fail = (status: number, code: string, message = code): TimeResponse => ({ status, body: { error: { code, message } } });
const ok = (body: unknown, status = 200): TimeResponse => ({ status, body });
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isInstant = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const DAY_MARKS: DayMarkKind[] = ['none', 'holiday', 'vacation', 'sick', 'excused', 'school_credit'];
const SEGMENT_KINDS = ['work', 'travel', 'school'];

export function createTimeMock(clock: () => number) {
	const states = new Map<string, TimeState>();
	/** Set by the API mock: how absences and holidays change a day (planning data lives in another module). */
	let dayContext: (accountId: string, date: string) => DerivedDayContext | null = () => null;

	function stateOf(accountId: string): TimeState {
		let state = states.get(accountId);
		if (!state) {
			state = {
				accountId,
				models: [],
				places: [],
				segments: [],
				prefs: new Map(),
				adjustments: [],
				suggestions: [],
				tokens: [],
				triggerLinks: [],
				timerEvents: new Map(),
				automationEvents: new Map()
			};
			states.set(accountId, state);
		}
		return state;
	}

	/** Realistic demo data for the dev account: a 38:30 h/week model, three places, two weeks of segments, one suggestion. */
	function seedDemo(accountId: string): void {
		const state = stateOf(accountId);
		const today = todayLocal(DEFAULT_TIMEZONE, new Date(clock()));
		state.models.push({
			id: uuid(),
			createdAt: new Date(clock()).toISOString(),
			validFrom: addDays(today, -60),
			validTo: null,
			timezone: DEFAULT_TIMEZONE,
			weeklyTargetSeconds: 38.5 * 3600,
			workdays: [1, 2, 3, 4, 5],
			travelCountsAsWork: true,
			roundingEnabled: true,
			roundingMinutes: 15,
			schoolFullDayThresholdSeconds: 10800,
			schoolCreditSeconds: null,
			dayBoundaryMinutes: 0,
			fixedBreaks: [],
			version: 1
		});
		const office: Place = { id: uuid(), name: 'Büro', kind: 'office', automationMode: 'direct', latitude: 52.52, longitude: 13.405, radiusMeters: 150, confirmAfterSeconds: 300, defaultSegmentKind: 'work', archived: false };
		const school: Place = { id: uuid(), name: 'Berufsschule', kind: 'school', automationMode: 'suggest', latitude: null, longitude: null, radiusMeters: null, confirmAfterSeconds: 300, defaultSegmentKind: 'school', archived: false };
		const home: Place = { id: uuid(), name: 'Zuhause', kind: 'home', automationMode: 'off', latitude: null, longitude: null, radiusMeters: null, confirmAfterSeconds: 300, defaultSegmentKind: 'work', archived: false };
		state.places.push(office, school, home);
		state.adjustments.push({ kind: 'opening', date: addDays(today, -14), seconds: 4500, reason: 'Anfangsstand' });

		const add = (date: string, from: string, to: string, kind: Segment['kind'], placeId: string, source: Segment['source'] = 'timer') => {
			const startedAt = zonedTimeToInstant(date, from).toISOString();
			const endedAt = zonedTimeToInstant(date, to).toISOString();
			state.segments.push({ id: uuid(), kind, placeId, startedAt, endedAt, rawStartedAt: startedAt, rawEndedAt: endedAt, source, note: null, version: 1, voided: false, needsReview: false, revisions: 0 });
		};
		const patterns: [string, string, string, string][] = [
			['08:07', '12:00', '13:00', '16:02'],
			['07:58', '12:10', '12:50', '16:30'],
			['08:20', '12:30', '13:00', '16:41'],
			['08:00', '12:00', '12:45', '15:55']
		];
		let n = 0;
		for (let offset = 1; offset <= 14; offset++) {
			const date = addDays(today, -offset);
			const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
			if (weekday === 0 || weekday === 6) continue;
			if (weekday === 4) {
				add(date, '08:00', '13:30', 'school', school.id);
				add(date, '13:30', '14:15', 'travel', home.id);
				continue;
			}
			const [a, b, c, d] = patterns[n++ % patterns.length];
			add(date, a, b, 'work', office.id);
			add(date, c, d, 'work', office.id);
		}
		const suggestedAt = new Date(clock() - 25 * 60_000).toISOString();
		state.suggestions.push({ id: uuid(), type: 'start', placeId: office.id, proposedStartedAt: suggestedAt, proposedEndedAt: null, segmentId: null, createdAt: suggestedAt });
	}

	function toEval(segments: Segment[]): EvalSegment[] {
		return segments.map((s) => ({ id: s.id, kind: s.kind, startedAt: Date.parse(s.startedAt), endedAt: s.endedAt ? Date.parse(s.endedAt) : null }));
	}

	function segmentsOfDay(state: TimeState, date: string): Segment[] {
		return state.segments.filter((s) => {
			if (s.voided) return false;
			const model = modelForDate(state.models, localDateOf(s.startedAt, DEFAULT_TIMEZONE));
			return workDayOf(Date.parse(s.startedAt), model) === date;
		});
	}

	function evaluate(state: TimeState, date: string) {
		return evaluateDay({
			date,
			models: state.models,
			segments: toEval(segmentsOfDay(state, date)),
			prefs: state.prefs.get(date),
			derived: dayContext(state.accountId, date),
			now: clock()
		});
	}

	function account(state: TimeState, asOf: string) {
		const today = todayLocal(DEFAULT_TIMEZONE, new Date(clock()));
		const opening = state.adjustments.find((a) => a.kind === 'opening');
		const corrections = state.adjustments.filter((a) => a.kind === 'correction' && a.date <= asOf);
		const adjustmentSeconds = corrections.reduce((sum, a) => sum + a.seconds, 0);
		let total = (opening?.seconds ?? 0) + adjustmentSeconds;
		if (opening) {
			const last = asOf < today ? asOf : today;
			for (const date of daysBetween(opening.date, last)) total += evaluate(state, date).deltaSeconds;
		}
		return {
			asOf,
			accountStart: opening?.date ?? null,
			balanceSeconds: total,
			openingSeconds: opening?.seconds ?? 0,
			adjustmentSeconds,
			provisional: asOf >= today
		};
	}

	function findOverlap(state: TimeState, startedAt: number, endedAt: number | null, ignoreId?: string): Segment | undefined {
		return state.segments.find((s) => {
			if (s.voided || s.id === ignoreId) return false;
			const aStart = Date.parse(s.startedAt);
			const aEnd = s.endedAt ? Date.parse(s.endedAt) : Infinity;
			return startedAt < aEnd && (endedAt ?? Infinity) > aStart;
		});
	}

	const running = (state: TimeState) => state.segments.find((s) => !s.voided && s.endedAt === null);

	function newSegment(state: TimeState, input: Partial<Segment> & { startedAt: string }, source: Segment['source']): Segment {
		const segment: Segment = {
			id: uuid(),
			kind: input.kind ?? 'work',
			placeId: input.placeId ?? null,
			startedAt: input.startedAt,
			endedAt: input.endedAt ?? null,
			rawStartedAt: input.startedAt,
			rawEndedAt: input.endedAt ?? null,
			source,
			note: input.note ?? null,
			version: 1,
			voided: false,
			needsReview: false,
			revisions: 0
		};
		state.segments.push(segment);
		return segment;
	}

	function validateModel(input: WorkModelInput): boolean {
		return (
			isDate(input?.validFrom) &&
			Number.isInteger(input.weeklyTargetSeconds) &&
			input.weeklyTargetSeconds >= 0 &&
			Array.isArray(input.workdays) &&
			input.workdays.length > 0 &&
			input.workdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) &&
			(input.roundingMinutes === undefined || (input.roundingMinutes >= 1 && input.roundingMinutes <= 60)) &&
			(input.dayBoundaryMinutes === undefined || (input.dayBoundaryMinutes >= 0 && input.dayBoundaryMinutes <= 719)) &&
			(input.fixedBreaks ?? []).every((b) => /^[0-2]\d:[0-5]\d$/.test(b.start) && /^[0-2]\d:[0-5]\d$/.test(b.end) && b.start < b.end)
		);
	}

	const EDITABLE_MODEL_FIELDS = [
		'validFrom', 'validTo', 'timezone', 'weeklyTargetSeconds', 'workdays', 'dailyTargetSeconds', 'travelCountsAsWork',
		'roundingEnabled', 'roundingMinutes', 'schoolFullDayThresholdSeconds', 'schoolCreditSeconds', 'dayBoundaryMinutes', 'fixedBreaks'
	] as const;
	const MODEL_DEFAULTS = {
		timezone: DEFAULT_TIMEZONE,
		travelCountsAsWork: true,
		roundingEnabled: true,
		roundingMinutes: 15,
		schoolFullDayThresholdSeconds: 10800,
		schoolCreditSeconds: null,
		dayBoundaryMinutes: 0,
		fixedBreaks: [],
		dailyTargetSeconds: {},
		validTo: null
	};

	/** Mirrors the backend plan (contract v0.16.0): validation, neighbour adjustment and the changed fields. */
	function planCorrection(state: TimeState, id: string, body: WorkModelInput) {
		const current = state.models.find((x) => x.id === id);
		if (!current) return { error: fail(404, 'not_found') };
		if (!validateModel(body) || (body.validTo != null && (!isDate(body.validTo) || body.validTo < body.validFrom))) return { error: fail(400, 'bad_request') };
		const sorted = [...state.models].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
		const others = sorted.filter((x) => x.id !== id);
		const previous = [...others].reverse().find((x) => x.validFrom < current.validFrom);
		const next = others.find((x) => x.validFrom > current.validFrom);
		const corrected: WorkModel = { ...MODEL_DEFAULTS, ...body, id, createdAt: current.createdAt, version: (current.version ?? 1) + 1 };
		corrected.validTo = body.validTo ?? null;
		let adjusted: WorkModel | null = null;
		if (previous) {
			if (corrected.validFrom <= previous.validFrom) return { error: fail(409, 'model_overlap') };
			const adjacent = !previous.validTo || previous.validTo === addDays(current.validFrom, -1);
			const end = addDays(corrected.validFrom, -1);
			if ((adjacent || (previous.validTo ?? '') >= corrected.validFrom) && previous.validTo !== end) {
				adjusted = { ...previous, validTo: end, version: (previous.version ?? 1) + 1 };
			}
		}
		if (next && (!corrected.validTo || corrected.validTo >= next.validFrom)) return { error: fail(409, 'model_overlap') };
		const models = sorted.map((x) => (x.id === id ? corrected : adjusted && x.id === adjusted.id ? adjusted : x));
		const changedFields = EDITABLE_MODEL_FIELDS.filter((f) => JSON.stringify(current[f] ?? MODEL_DEFAULTS[f as keyof typeof MODEL_DEFAULTS] ?? null) !== JSON.stringify(corrected[f] ?? null));
		return { models, corrected, adjusted, current, changedFields: [...changedFields] as string[] };
	}

	function validatePlace(input: PlaceInput): boolean {
		return (
			typeof input?.name === 'string' &&
			input.name.trim().length > 0 &&
			input.name.length <= 80 &&
			['office', 'home', 'customer', 'school', 'other'].includes(input.kind) &&
			['direct', 'suggest', 'off'].includes(input.automationMode) &&
			(input.defaultSegmentKind === undefined || SEGMENT_KINDS.includes(input.defaultSegmentKind))
		);
	}

	/** Returns null for paths this module does not own. */
	function handle(accountId: string, req: TimeRequest): TimeResponse | null {
		const [path, queryString = ''] = req.path.split('?');
		const query = new URLSearchParams(queryString);
		const method = req.method.toUpperCase();
		const body = req.body ?? {};
		const state = stateOf(accountId);
		const prefix = '/api/v1/';
		if (!path.startsWith(prefix)) return null;
		const route = path.slice(prefix.length).replace(/\/+$/, '');
		let m: RegExpMatchArray | null;

		// --- work models ---
		if (route === 'work-models') {
			if (method === 'GET') return ok([...state.models].sort((a, b) => a.validFrom.localeCompare(b.validFrom)));
			if (method === 'POST') {
				if (!validateModel(body)) return fail(400, 'bad_request');
				if (state.models.some((x) => x.validFrom >= body.validFrom)) return fail(409, 'model_overlap');
				const previous = state.models.find((x) => !x.validTo || x.validTo >= body.validFrom);
				if (previous) previous.validTo = addDays(body.validFrom, -1);
				const model: WorkModel = {
					timezone: DEFAULT_TIMEZONE,
					travelCountsAsWork: true,
					roundingEnabled: true,
					roundingMinutes: 15,
					schoolFullDayThresholdSeconds: 10800,
					schoolCreditSeconds: null,
					dayBoundaryMinutes: 0,
					fixedBreaks: [],
					validTo: null,
					...body,
					version: 1,
					id: uuid(),
					createdAt: new Date(clock()).toISOString()
				};
				state.models.push(model);
				return ok(model, 201);
			}
		}
		if ((m = route.match(/^work-models\/([^/]+)$/))) {
			const model = state.models.find((x) => x.id === m![1]);
			if (!model) return fail(404, 'not_found');
			if (method === 'GET') return ok(model);
			if (method === 'PUT') {
				const plan = planCorrection(state, model.id, body);
				if ('error' in plan) return plan.error as TimeResponse;
				state.models = plan.models;
				return ok(plan.corrected);
			}
			if (method === 'PATCH') {
				if (!isDate(body.validTo) || body.validTo < model.validFrom) return fail(400, 'bad_request');
				if (state.models.some((x) => x.id !== model.id && x.validFrom <= body.validTo && x.validFrom > model.validFrom)) {
					return fail(409, 'model_overlap');
				}
				model.validTo = body.validTo;
				return ok(model);
			}
		}

		if ((m = route.match(/^work-models\/([^/]+)\/preview$/)) && method === 'POST') {
			const plan = planCorrection(state, m[1], body);
			if ('error' in plan) return plan.error as TimeResponse;
			const today = todayLocal(DEFAULT_TIMEZONE, new Date(clock()));
			const before = account(state, today).balanceSeconds;
			const after = account({ ...state, models: plan.models }, today).balanceSeconds;
			const touched = [plan.current, plan.corrected, ...(plan.adjusted ? [plan.adjusted] : [])];
			const from = touched.map((x) => x.validFrom).sort()[0];
			const open = touched.some((x) => !x.validTo);
			const to = open ? null : touched.map((x) => x.validTo as string).sort().at(-1) ?? null;
			const last = to && to < today ? to : today;
			return ok({
				affectedFrom: from,
				affectedTo: to,
				affectedDays: from <= today ? daysBetween(from, last).length : 0,
				balanceBeforeSeconds: before,
				balanceAfterSeconds: after,
				differenceSeconds: after - before,
				changedFields: plan.changedFields,
				previousValidTo: plan.adjusted?.validTo ?? null
			});
		}

		// --- places ---
		if (route === 'places') {
			if (method === 'GET') return ok(state.places.filter((p) => !p.archived));
			if (method === 'POST') {
				if (!validatePlace(body)) return fail(400, 'bad_request');
				const place: Place = { confirmAfterSeconds: 300, defaultSegmentKind: 'work', latitude: null, longitude: null, radiusMeters: null, ...body, id: uuid(), archived: false };
				state.places.push(place);
				return ok(place, 201);
			}
		}
		if ((m = route.match(/^places\/([^/]+)$/))) {
			const place = state.places.find((p) => p.id === m![1] && !p.archived);
			if (!place) return fail(404, 'not_found');
			if (method === 'PUT') {
				if (!validatePlace(body)) return fail(400, 'bad_request');
				Object.assign(place, body);
				return ok(place);
			}
			if (method === 'DELETE') {
				place.archived = true;
				return { status: 204 };
			}
		}

		// --- segments ---
		if (route === 'time/segments') {
			if (method === 'GET') {
				if (!isInstant(query.get('from')) || !isInstant(query.get('to'))) return fail(400, 'bad_request');
				const from = Date.parse(query.get('from')!);
				const to = Date.parse(query.get('to')!);
				const includeVoided = query.get('includeVoided') === 'true';
				return ok(
					state.segments
						.filter((s) => (includeVoided || !s.voided) && Date.parse(s.startedAt) >= from && Date.parse(s.startedAt) < to)
						.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
				);
			}
			if (method === 'POST') {
				if (!SEGMENT_KINDS.includes(body.kind) || !isInstant(body.startedAt) || (body.endedAt != null && !isInstant(body.endedAt))) {
					return fail(400, 'bad_request');
				}
				const start = Date.parse(body.startedAt);
				const end = body.endedAt ? Date.parse(body.endedAt) : null;
				if (end !== null && end <= start) return fail(400, 'bad_request');
				if (findOverlap(state, start, end)) return fail(409, 'segment_overlap');
				return ok(newSegment(state, body, 'manual'), 201);
			}
		}
		if ((m = route.match(/^time\/segments\/([^/]+)$/))) {
			const segment = state.segments.find((s) => s.id === m![1]);
			if (!segment) return fail(404, 'not_found');
			if (method === 'PATCH') {
				if (req.ifMatch === undefined) return fail(400, 'bad_request');
				if (String(segment.version) !== req.ifMatch) return fail(412, 'stale_version');
				if (typeof body.reason !== 'string' || body.reason.trim() === '') return fail(400, 'bad_request');
				const startedAt = body.startedAt ?? segment.startedAt;
				const endedAt = 'endedAt' in body ? body.endedAt : segment.endedAt;
				if (!isInstant(startedAt) || (endedAt != null && !isInstant(endedAt))) return fail(400, 'bad_request');
				if (endedAt != null && Date.parse(endedAt) <= Date.parse(startedAt)) return fail(400, 'bad_request');
				// Contract 0.27.0: `endedAt: null` on a finished segment reopens it (guards: cancelled, other running, later segment).
				const reopening = 'endedAt' in body && body.endedAt === null && segment.endedAt !== null;
				if (reopening) {
					if (segment.voided) return fail(409, 'conflict');
					if (running(state)) return fail(409, 'timer_already_running');
					const oldEnd = Date.parse(segment.endedAt!);
					if (state.segments.some((s) => s.id !== segment.id && !s.voided && Date.parse(s.startedAt) >= oldEnd)) return fail(409, 'segment_overlap');
				}
				if (findOverlap(state, Date.parse(startedAt), endedAt ? Date.parse(endedAt) : null, segment.id)) {
					return fail(409, 'segment_overlap');
				}
				segment.startedAt = startedAt;
				segment.endedAt = endedAt ?? null;
				if (body.kind) segment.kind = body.kind;
				if ('placeId' in body) segment.placeId = body.placeId;
				if ('note' in body) segment.note = body.note;
				segment.version += 1;
				segment.revisions = (segment.revisions ?? 0) + 1;
				return ok(segment);
			}
			if (method === 'DELETE') {
				const reason = query.get('reason');
				if (!reason?.trim()) return fail(400, 'bad_request');
				segment.voided = true;
				segment.version += 1;
				return { status: 204 };
			}
		}

		// --- timer ---
		if (route === 'time/timer' && method === 'GET') return ok(running(state) ?? null);
		if (route === 'time/timer/start' && method === 'POST') {
			if (typeof body.clientEventId !== 'string') return fail(400, 'bad_request');
			const earlier = state.timerEvents.get(body.clientEventId);
			if (earlier) return ok(state.segments.find((s) => s.id === earlier));
			if (running(state)) return fail(409, 'timer_already_running');
			const place = body.placeId ? state.places.find((p) => p.id === body.placeId) : undefined;
			if (body.placeId && !place) return fail(404, 'not_found');
			const segment = newSegment(state, { kind: body.kind ?? place?.defaultSegmentKind ?? 'work', placeId: body.placeId ?? null, startedAt: new Date(clock()).toISOString() }, 'timer');
			state.timerEvents.set(body.clientEventId, segment.id);
			return ok(segment);
		}
		if (route === 'time/timer/stop' && method === 'POST') {
			if (typeof body.clientEventId !== 'string') return fail(400, 'bad_request');
			const earlier = state.timerEvents.get(body.clientEventId);
			if (earlier) return ok(state.segments.find((s) => s.id === earlier));
			const current = running(state);
			if (!current) return fail(409, 'no_running_timer');
			current.endedAt = current.rawEndedAt = new Date(clock()).toISOString();
			state.timerEvents.set(body.clientEventId, current.id);
			return ok(current);
		}

		// --- day evaluations ---
		if (route === 'time/days' && method === 'GET') {
			const from = query.get('from');
			const to = query.get('to');
			if (!isDate(from) || !isDate(to) || to < from) return fail(400, 'bad_request');
			const days = daysBetween(from, to);
			if (days.length > 93) return fail(400, 'range_too_large');
			return ok(days.map((date) => evaluate(state, date)));
		}
		if ((m = route.match(/^time\/days\/(\d{4}-\d{2}-\d{2})$/))) {
			const date = m[1];
			if (method === 'GET') return ok(evaluate(state, date));
			if (method === 'PUT') {
				if (body.mark !== undefined && !DAY_MARKS.includes(body.mark)) return fail(400, 'bad_request');
				if (body.creditSeconds != null && !(Number.isInteger(body.creditSeconds) && body.creditSeconds >= 0)) return fail(400, 'bad_request');
				if (typeof body.note === 'string' && body.note.length > 200) return fail(400, 'bad_request');
				if (body.targetOverrideSeconds != null && !(Number.isInteger(body.targetOverrideSeconds) && body.targetOverrideSeconds >= 0)) return fail(400, 'bad_request');
				const current = state.prefs.get(date) ?? {};
				const next = { ...current };
				if (body.mark !== undefined) next.mark = body.mark === 'none' ? undefined : body.mark;
				if ('creditSeconds' in body) next.creditSeconds = body.creditSeconds;
				if (body.skipFixedBreaks !== undefined) next.skipFixedBreaks = body.skipFixedBreaks;
				if ('note' in body) next.note = body.note;
				if ('targetOverrideSeconds' in body) next.targetOverrideSeconds = body.targetOverrideSeconds;
				state.prefs.set(date, next);
				return ok(evaluate(state, date));
			}
		}

		// --- time account ---
		if (route === 'time/account' && method === 'GET') {
			const asOf = query.get('asOf') ?? todayLocal(DEFAULT_TIMEZONE, new Date(clock()));
			if (!isDate(asOf)) return fail(400, 'bad_request');
			return ok(account(state, asOf));
		}
		if (route === 'time/account/adjustments' && method === 'POST') {
			if (!['opening', 'correction'].includes(body.kind) || !isDate(body.date) || !Number.isInteger(body.seconds) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 200) {
				return fail(400, 'bad_request');
			}
			if (body.kind === 'opening' && state.adjustments.some((a) => a.kind === 'opening')) return fail(409, 'opening_exists');
			state.adjustments.push({ kind: body.kind, date: body.date, seconds: body.seconds, reason: body.reason });
			return ok(account(state, todayLocal(DEFAULT_TIMEZONE, new Date(clock()))), 201);
		}

		// --- suggestions ---
		if (route === 'time/suggestions' && method === 'GET') return ok(state.suggestions);
		if ((m = route.match(/^time\/suggestions\/([^/]+)\/(accept|reject)$/)) && method === 'POST') {
			const index = state.suggestions.findIndex((s) => s.id === m![1]);
			if (index < 0) return fail(404, 'not_found');
			const suggestion = state.suggestions[index];
			if (m[2] === 'reject') {
				state.suggestions.splice(index, 1);
				return { status: 204 };
			}
			if (suggestion.type === 'end') {
				const target = state.segments.find((s) => s.id === suggestion.segmentId && !s.voided);
				if (!target || target.endedAt) return fail(409, 'conflict');
				const end = body.endedAt ?? suggestion.proposedEndedAt ?? new Date(clock()).toISOString();
				if (Date.parse(end) <= Date.parse(target.startedAt)) return fail(400, 'bad_request');
				target.endedAt = target.rawEndedAt = end;
				state.suggestions.splice(index, 1);
				return ok(target);
			}
			const startedAt = body.startedAt ?? suggestion.proposedStartedAt ?? new Date(clock()).toISOString();
			const endedAt = body.endedAt ?? suggestion.proposedEndedAt ?? null;
			if (findOverlap(state, Date.parse(startedAt), endedAt ? Date.parse(endedAt) : null)) return fail(409, 'segment_overlap');
			const place = state.places.find((p) => p.id === suggestion.placeId);
			state.suggestions.splice(index, 1);
			return ok(newSegment(state, { startedAt, endedAt, placeId: suggestion.placeId, kind: place?.defaultSegmentKind ?? 'work' }, 'suggestion'));
		}

		// --- device tokens ---
		if (route === 'me/device-tokens') {
			if (method === 'GET') return ok(state.tokens.map(({ secret: _secret, ...rest }) => rest));
			if (method === 'POST') {
				if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) return fail(400, 'bad_request');
				const days = body.expiresInDays;
				if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 730)) return fail(400, 'bad_request');
				const secret = 'ttd_' + uuid().replace(/-/g, '') + uuid().replace(/-/g, '').slice(0, 12);
				const token: StoredToken = {
					id: uuid(),
					name: body.name.trim(),
					createdAt: new Date(clock()).toISOString(),
					expiresAt: days ? new Date(clock() + days * 86400_000).toISOString() : null,
					lastUsedAt: null,
					secret
				};
				state.tokens.push(token);
				const { secret: _s, ...publicToken } = token;
				return ok({ ...publicToken, token: secret }, 201);
			}
		}
		if ((m = route.match(/^me\/device-tokens\/([^/]+)$/)) && method === 'DELETE') {
			const index = state.tokens.findIndex((t) => t.id === m![1]);
			if (index < 0) return fail(404, 'not_found');
			state.tokens.splice(index, 1);
			return { status: 204 };
		}

		// --- trigger links (contract 0.26.0): the token and path exist only in the POST response ---
		if (route === 'me/trigger-links') {
			if (method === 'GET') return ok(state.triggerLinks.map(({ secret: _secret, ...rest }) => rest));
			if (method === 'POST') {
				const actions = body.actions;
				if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80) return fail(400, 'bad_request');
				if (!Array.isArray(actions) || actions.length === 0 || actions.some((a) => !['start', 'stop', 'toggle'].includes(a))) return fail(400, 'bad_request');
				if (body.kind !== undefined && !SEGMENT_KINDS.includes(body.kind)) return fail(400, 'bad_request');
				const days = body.expiresInDays;
				if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 730)) return fail(400, 'bad_request');
				if (body.placeId && !state.places.some((p) => p.id === body.placeId && !p.archived)) return fail(404, 'not_found');
				if (state.triggerLinks.length >= 20) return fail(409, 'too_many_trigger_links');
				const secret = (uuid() + uuid()).replace(/-/g, '').slice(0, 43);
				const link: StoredTriggerLink = {
					id: uuid(),
					label: body.label.trim(),
					actions: [...new Set<string>(actions)] as TriggerLink['actions'],
					placeId: body.placeId ?? null,
					kind: body.kind ?? 'work',
					createdAt: new Date(clock()).toISOString(),
					expiresAt: days ? new Date(clock() + days * 86400_000).toISOString() : null,
					lastUsedAt: null,
					lastAction: null,
					secret
				};
				state.triggerLinks.push(link);
				const { secret: _s, ...publicLink } = link;
				return ok({ ...publicLink, token: secret, path: `/t/${secret}` }, 201);
			}
		}
		if ((m = route.match(/^me\/trigger-links\/([^/]+)$/)) && method === 'DELETE') {
			const index = state.triggerLinks.findIndex((l) => l.id === m![1]);
			if (index < 0) return fail(404, 'not_found');
			state.triggerLinks.splice(index, 1);
			return { status: 204 };
		}
		return null;
	}

	/** Bearer-token endpoint for Shortcuts; no cookie, no CSRF. */
	function automationEvent(authorization: string | undefined, body: any): TimeResponse {
		const secret = authorization?.replace(/^Bearer\s+/i, '');
		let owner: string | undefined;
		let token: StoredToken | undefined;
		for (const [accountId, state] of states) {
			token = state.tokens.find((t) => t.secret === secret);
			if (token) {
				owner = accountId;
				break;
			}
		}
		if (!owner || !token) return fail(401, 'unauthorized');
		token.lastUsedAt = new Date(clock()).toISOString();
		const state = stateOf(owner);
		if (typeof body?.eventId !== 'string' || !['arrival', 'presence_confirmed', 'departure', 'cancel'].includes(body.type) || !isInstant(body.occurredAt)) {
			return fail(400, 'bad_request');
		}
		const earlier = state.automationEvents.get(body.eventId);
		if (earlier) return ok(earlier);
		const place = state.places.find((p) => p.id === body.placeId && !p.archived);
		if (!place) return fail(404, 'not_found');
		let result = { result: 'recorded', segmentId: null as string | null, suggestionId: null as string | null };
		if (body.type === 'cancel') result.result = 'ignored';
		else if (body.type !== 'arrival' && place.automationMode !== 'off') {
			const current = running(state);
			if (body.type === 'presence_confirmed') {
				if (current) result.result = 'needs_review';
				else if (place.automationMode === 'direct') {
					result = { result: 'booked', segmentId: newSegment(state, { startedAt: body.occurredAt, placeId: place.id, kind: place.defaultSegmentKind ?? 'work' }, 'automation').id, suggestionId: null };
				} else {
					const suggestion: Suggestion = { id: uuid(), type: 'start', placeId: place.id, proposedStartedAt: body.occurredAt, proposedEndedAt: null, segmentId: null, createdAt: new Date(clock()).toISOString() };
					state.suggestions.push(suggestion);
					result = { result: 'suggested', segmentId: null, suggestionId: suggestion.id };
				}
			} else if (current && current.placeId === place.id) {
				// A missing departure proves nothing, but a delivered one only ever becomes a suggestion to end the segment.
				const suggestion: Suggestion = { id: uuid(), type: 'end', placeId: place.id, proposedStartedAt: null, proposedEndedAt: body.occurredAt, segmentId: current.id, createdAt: new Date(clock()).toISOString() };
				state.suggestions.push(suggestion);
				result = { result: 'suggested', segmentId: current.id, suggestionId: suggestion.id };
			} else result.result = 'ignored';
		}
		state.automationEvents.set(body.eventId, result);
		return ok(result);
	}

	const modelsOf = (accountId: string) => stateOf(accountId).models;
	const evaluateFor = (accountId: string, date: string) => evaluate(stateOf(accountId), date);
	const setDayContext = (fn: (accountId: string, date: string) => DerivedDayContext | null) => {
		dayContext = fn;
	};
	return { handle, seedDemo, automationEvent, states, modelsOf, evaluateFor, setDayContext };
}
