// Mock of the planning and vacation endpoints in contracts/openapi.yaml v0.3.1 (vacation settings/balance/snapshots/adjustments,
// absences, calendar holidays/custom days, plan days, shares). The backend implements these in C8/C9.
// Rules follow "Fachregeln Etappe 3a" in ADR-0005 (backend repo); assumptions are listed in docs/handoffs/L6.md.
import { addDays, isoWeekday, startOfWeek, todayLocal } from '../src/lib/time/dates.ts';
import type {
	Absence,
	AbsenceInput,
	CalendarDay,
	PlanDay,
	PlanMode,
	Share,
	ShareScopes,
	SharedView,
	VacationBalance,
	VacationSettings,
	WorkModel
} from '../src/lib/api/types.ts';
import { holidaysFor } from './holidays.ts';
import { suggestVacation } from './vacation-suggestions.ts';
import { daysBetween, modelForDate, type DerivedDayContext } from './evaluate.ts';

export interface PlanningRequest {
	method: string;
	/** path including the `/api/v1` prefix and the query string */
	path: string;
	body?: any;
	ifMatch?: string;
}

export interface PlanningResponse {
	status: number;
	body?: unknown;
}

export interface PlanningDeps {
	clock: () => number;
	modelsOf: (accountId: string) => WorkModel[];
	/** evaluated work of an owner's day (for shared `actual` views) */
	evaluateFor: (accountId: string, date: string) => { evaluatedWorkSeconds: number; evaluatedStart?: string | null; evaluatedEnd?: string | null };
	findByHandle: (handle: string) => { id: string; displayName: string } | undefined;
	displayNameOf: (accountId: string) => string;
}

interface AdjustmentEntry {
	id: string;
	date: string;
	halfDays: number;
	reason: string;
}

interface PlanningState {
	settings: VacationSettings | null;
	snapshots: { id: string; date: string; remainingHalfDays: number }[];
	adjustments: AdjustmentEntry[];
	absences: Absence[];
	customDays: (CalendarDay & { id: string })[];
	plan: Map<string, PlanDay>;
}

interface StoredShare extends Share {
	ownerId: string;
	recipientId: string;
}

const uuid = () => crypto.randomUUID();
/** K1: server-side derivation of the planned seconds (end - start - break, never negative). */
export function plannedSecondsOf(start?: string | null, end?: string | null, breakMinutes?: number | null): number | null {
	const clock = (value?: string | null) => {
		const match = value ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
		return match ? Number(match[1]) * 60 + Number(match[2]) : null;
	};
	const from = clock(start);
	const to = clock(end);
	if (from === null || to === null || to <= from) return null;
	return Math.max(0, (to - from - (breakMinutes ?? 0)) * 60);
}

/** Validates and normalizes one plan day body (contract v0.17.0): both or neither time, start < end, break 0..600, off ignores times. */
export function normalizePlanBody(body: any): { day: Omit<PlanDay, 'date'> } | { error: string } {
	if (!body || !PLAN_MODES.includes(body.mode) || (body.note != null && (typeof body.note !== 'string' || body.note.length > 200))) return { error: 'bad_request' };
	const base = { mode: body.mode as PlanMode, placeId: body.placeId ?? null, note: body.note ?? null };
	const start = body.plannedStart ?? null;
	const end = body.plannedEnd ?? null;
	const breakMinutes = body.plannedBreakMinutes ?? null;
	if (body.mode === 'off') return { day: { ...base, plannedStart: null, plannedEnd: null, plannedBreakMinutes: null, plannedSeconds: null } };
	if (start === null && end === null) {
		if (breakMinutes !== null) return { error: 'plan_break_invalid' };
		return { day: { ...base, plannedStart: null, plannedEnd: null, plannedBreakMinutes: null, plannedSeconds: null } };
	}
	if (typeof start !== 'string' || typeof end !== 'string' || plannedSecondsOf(start, end, 0) === null) return { error: 'plan_time_invalid' };
	if (breakMinutes !== null && !(Number.isInteger(breakMinutes) && breakMinutes >= 0 && breakMinutes <= 600)) return { error: 'plan_break_invalid' };
	return { day: { ...base, plannedStart: start, plannedEnd: end, plannedBreakMinutes: breakMinutes, plannedSeconds: plannedSecondsOf(start, end, breakMinutes) } };
}

const fail = (status: number, code: string, message = code): PlanningResponse => ({ status, body: { error: { code, message } } });
const ok = (body: unknown, status = 200): PlanningResponse => ({ status, body });
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;
const KINDS = ['vacation', 'sick', 'excused', 'other'];
const STATUSES = ['planned', 'requested', 'approved', 'rejected', 'cancelled', 'taken'];
const DOC_STATUSES = ['not_needed', 'pending', 'submitted'];
const PLAN_MODES: PlanMode[] = ['office', 'home', 'customer', 'school', 'off'];
const BOOKED = ['approved', 'taken'];
const PLANNED = ['planned', 'requested'];
const MAX_SPAN_DAYS = 800;
/** Contract v0.3.1: absences, plan/days and shared views accept at most 366 days (else 400 range_too_large). */
const MAX_RANGE_DAYS = 366;

export const DEFAULT_VACATION_SETTINGS: VacationSettings = { region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: {}, carryOverExpiry: null };

export function createPlanningMock(deps: PlanningDeps) {
	const states = new Map<string, PlanningState>();
	const shares: StoredShare[] = [];

	function stateOf(accountId: string): PlanningState {
		let state = states.get(accountId);
		if (!state) {
			state = { settings: null, snapshots: [], adjustments: [], absences: [], customDays: [], plan: new Map() };
			states.set(accountId, state);
		}
		return state;
	}

	const regionOf = (state: PlanningState) => state.settings?.region ?? DEFAULT_VACATION_SETTINGS.region;

	/** Holiday dates of a region: built-in plus the account's own `holiday` custom days. */
	function holidayDates(state: PlanningState, from: string, to: string): Set<string> {
		const set = new Set<string>();
		for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
			for (const h of holidaysFor(year, regionOf(state))) set.add(h.startDate);
		}
		for (const c of state.customDays) {
			if (c.kind !== 'holiday') continue;
			for (const d of daysBetween(c.startDate, c.endDate)) set.add(d);
		}
		return set;
	}

	/**
	 * Counted half days of an absence (ADR-0005): per calendar day that is a workday of the model valid on that date and no holiday,
	 * 2 half days; the half-day flags reduce the first/last day to 1. Optional range clips to a year or period (flags still refer to
	 * the real first/last day).
	 */
	function countHalfDays(accountId: string, a: Pick<AbsenceInput, 'startDate' | 'endDate' | 'halfDayStart' | 'halfDayEnd'>, clip?: { from: string; to: string }): number {
		const state = stateOf(accountId);
		const models = deps.modelsOf(accountId);
		const holidays = holidayDates(state, a.startDate, a.endDate);
		let total = 0;
		for (const date of daysBetween(a.startDate, a.endDate)) {
			if (clip && (date < clip.from || date > clip.to)) continue;
			const model = modelForDate(models, date);
			const workdays = model ? model.workdays : [1, 2, 3, 4, 5]; // assumption: 5-day week without a model
			if (!workdays.includes(isoWeekday(date)) || holidays.has(date)) continue;
			const single = a.startDate === a.endDate;
			const half = single ? !!(a.halfDayStart || a.halfDayEnd) : (date === a.startDate && !!a.halfDayStart) || (date === a.endDate && !!a.halfDayEnd);
			total += half ? 1 : 2;
		}
		return total;
	}

	function balance(accountId: string, year: number): VacationBalance {
		const state = stateOf(accountId);
		const settings = state.settings ?? { region: DEFAULT_VACATION_SETTINGS.region, annualEntitlementHalfDays: 0, carryOverByYear: {} };
		const snapshot = state.snapshots.filter((s) => s.date.startsWith(`${year}-`)).sort((a, b) => b.date.localeCompare(a.date))[0];
		const clip = { from: snapshot?.date ?? `${year}-01-01`, to: `${year}-12-31` };
		let booked = 0;
		let planned = 0;
		for (const a of state.absences) {
			if (a.kind !== 'vacation' || a.endDate < clip.from || a.startDate > clip.to) continue;
			if (BOOKED.includes(a.status)) booked += countHalfDays(accountId, a, clip);
			else if (PLANNED.includes(a.status)) planned += countHalfDays(accountId, a, clip);
		}
		const adjustments = state.adjustments.filter((x) => x.date >= clip.from && x.date <= clip.to).reduce((sum, x) => sum + x.halfDays, 0);
		// With a snapshot the stored remaining days replace entitlement and carry-over of the year (not additive).
		const entitlement = snapshot ? 0 : settings.annualEntitlementHalfDays;
		const carryOver = snapshot ? 0 : (settings.carryOverByYear?.[String(year)] ?? 0);
		const available = (snapshot ? snapshot.remainingHalfDays : entitlement + carryOver) + adjustments - booked;
		return {
			year,
			snapshotDate: snapshot?.date ?? null,
			snapshotRemainingHalfDays: snapshot?.remainingHalfDays ?? null,
			entitlementHalfDays: entitlement,
			carryOverHalfDays: carryOver,
			adjustmentHalfDays: adjustments,
			bookedHalfDays: booked,
			plannedHalfDays: planned,
			availableHalfDays: available,
			availableAfterPlannedHalfDays: available - planned
		};
	}

	/** GET /vacation/suggestions (contract 0.22.0): read-only; validation and defaults as in the backend. */
	function suggestions(accountId: string, query: URLSearchParams): PlanningResponse {
		const state = stateOf(accountId);
		const today = todayLocal(undefined, new Date(deps.clock()));
		const from = query.get('from') ?? today;
		const to = query.get('to') ?? `${Number(today.slice(0, 4)) + 1}-12-31`;
		const intParam = (name: string, fallback: number, max: number): number | null => {
			const raw = query.get(name);
			if (raw === null) return fallback;
			const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
			return n >= 1 && n <= max ? n : null;
		};
		const maxVacationDays = intParam('maxVacationDays', 10, 60);
		const minDaysOff = intParam('minDaysOff', 4, 60);
		const limit = intParam('limit', 20, 100);
		if (!isDate(from) || !isDate(to) || to < from || maxVacationDays === null || minDaysOff === null || limit === null) return fail(400, 'invalid');
		if (daysBetween(from, to).length > 550) return fail(400, 'range_too_large');
		const models = deps.modelsOf(accountId);
		const holidays = new Map<string, string>();
		for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
			for (const h of holidaysFor(year, regionOf(state))) if (h.kind === 'holiday') holidays.set(h.startDate, h.name);
		}
		for (const c of state.customDays) if (c.kind === 'holiday') for (const d of daysBetween(c.startDate, c.endDate)) holidays.set(d, c.name);
		const vacationDates = new Set<string>();
		const absenceDates = new Set<string>();
		for (const a of state.absences) {
			if (a.status === 'rejected' || a.status === 'cancelled') continue;
			for (const d of daysBetween(a.startDate, a.endDate)) (a.kind === 'vacation' ? vacationDates : absenceDates).add(d);
		}
		const planDates = new Map<string, string>();
		for (const [date, plan] of state.plan) planDates.set(date, plan.mode);
		const year = Number(from.slice(0, 4));
		const b = balance(accountId, year);
		const remainingOfYear = (y: number) => balance(accountId, y).availableAfterPlannedHalfDays / 2;
		return ok({
			from,
			to,
			budget: {
				entitlementDays: (b.availableAfterPlannedHalfDays + b.bookedHalfDays + b.plannedHalfDays) / 2,
				takenDays: b.bookedHalfDays / 2,
				plannedDays: b.plannedHalfDays / 2,
				remainingDays: b.availableAfterPlannedHalfDays / 2
			},
			suggestions: suggestVacation({
				from,
				to,
				maxVacationDays,
				minDaysOff,
				limit,
				workdays: (date) => modelForDate(models, date)?.workdays ?? [1, 2, 3, 4, 5],
				holidays,
				schoolHolidays: state.customDays.filter((c) => c.kind === 'school_holiday').map((c) => ({ startDate: c.startDate, endDate: c.endDate, name: c.name })),
				vacationDates,
				absenceDates,
				planDates,
				remainingOfYear
			})
		});
	}

	/** v0.3.1: only vacation counts half days, and not once rejected or cancelled. */
	function withCount(accountId: string, absence: Omit<Absence, 'countedHalfDays'>): Absence {
		const counts = absence.kind === 'vacation' && absence.status !== 'rejected' && absence.status !== 'cancelled';
		return { ...absence, countedHalfDays: counts ? countHalfDays(accountId, absence) : 0 };
	}

	/**
	 * Effect of absences and holidays on one day for the time mock (ADR-0005): holiday on a workday -> mark holiday; approved/taken
	 * vacation or sick -> mark vacation/sick (target 0); a half vacation day halves the target. planned/requested/rejected/cancelled
	 * and kind=other change nothing. An explicit day mark is applied by the evaluation and wins.
	 * Assumption: a holiday wins over an absence on the same day (vacation is not consumed there either).
	 */
	function dayContext(accountId: string, date: string): DerivedDayContext | null {
		const model = modelForDate(deps.modelsOf(accountId), date);
		if (!model || !model.workdays.includes(isoWeekday(date))) return null;
		const state = stateOf(accountId);
		if (holidayDates(state, date, date).has(date)) return { mark: 'holiday' };
		const absence = state.absences.find((a) => BOOKED.includes(a.status) && (a.kind === 'vacation' || a.kind === 'sick' || a.kind === 'excused') && a.startDate <= date && a.endDate >= date);
		if (!absence) return null;
		if (absence.kind === 'sick') return { mark: 'sick' };
		if (absence.kind === 'excused') return { mark: 'excused' };
		const single = absence.startDate === absence.endDate;
		const half = single ? !!(absence.halfDayStart || absence.halfDayEnd) : (date === absence.startDate && !!absence.halfDayStart) || (date === absence.endDate && !!absence.halfDayEnd);
		return half ? { mark: 'vacation', halfTarget: true } : { mark: 'vacation' };
	}

	function normalize(input: any): AbsenceInput | null {
		if (!input || !KINDS.includes(input.kind) || !STATUSES.includes(input.status)) return null;
		if (!isDate(input.startDate) || !isDate(input.endDate) || input.endDate < input.startDate) return null;
		if (daysBetween(input.startDate, input.endDate).length > MAX_SPAN_DAYS) return null;
		if (input.note != null && (typeof input.note !== 'string' || input.note.length > 500)) return null;
		if (input.documentStatus !== undefined && !DOC_STATUSES.includes(input.documentStatus)) return null;
		for (const key of ['documentSubmittedOn', 'documentReferenceStart', 'documentReferenceEnd']) {
			if (input[key] != null && !isDate(input[key])) return null;
		}
		if (input.documentReferenceStart && input.documentReferenceEnd && input.documentReferenceEnd < input.documentReferenceStart) return null;
		return {
			kind: input.kind,
			startDate: input.startDate,
			endDate: input.endDate,
			halfDayStart: !!input.halfDayStart,
			halfDayEnd: !!input.halfDayEnd,
			status: input.status,
			note: input.note ?? null,
			documentStatus: input.documentStatus ?? 'not_needed',
			documentSubmittedOn: input.documentSubmittedOn ?? null,
			documentReferenceStart: input.documentReferenceStart ?? null,
			documentReferenceEnd: input.documentReferenceEnd ?? null
		};
	}

	/** Contract v0.3.1: cancelled and rejected absences do not block other ones. */
	const blocks = (a: Pick<Absence, 'status'>) => a.status !== 'cancelled' && a.status !== 'rejected';

	function overlaps(state: PlanningState, input: AbsenceInput, ignoreId?: string): boolean {
		if (!blocks(input)) return false;
		return state.absences.some((o) => o.id !== ignoreId && blocks(o) && o.startDate <= input.endDate && o.endDate >= input.startDate);
	}

	function parseScopes(raw: any): ShareScopes | null {
		if (raw === null || typeof raw !== 'object') return null;
		for (const key of ['plan', 'actual', 'vacation']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') return null;
		return { plan: !!raw.plan, actual: !!raw.actual, vacation: !!raw.vacation };
	}

	const publicShare = ({ ownerId: _o, recipientId: _r, ...rest }: StoredShare): Share => rest;

	function sharedView(share: StoredShare, from: string, to: string): SharedView {
		const state = stateOf(share.ownerId);
		const view: SharedView = {};
		if (share.scopes.plan) {
			view.plan = [...state.plan.values()].filter((p) => p.date >= from && p.date <= to).sort((a, b) => a.date.localeCompare(b.date)).map((p) => ({ date: p.date, mode: p.mode, ...(p.plannedStart ? { plannedStart: p.plannedStart, plannedEnd: p.plannedEnd!, ...(p.plannedBreakMinutes != null ? { plannedBreakMinutes: p.plannedBreakMinutes } : {}), plannedSeconds: p.plannedSeconds ?? 0 } : {}) }));
		}
		if (share.scopes.actual) {
			view.actual = daysBetween(from, to)
				.map((date) => ({ date, ...deps.evaluateFor(share.ownerId, date) }))
				.filter((d) => d.evaluatedWorkSeconds > 0)
				.map((d) => ({ date: d.date, evaluatedStart: d.evaluatedStart ?? null, evaluatedEnd: d.evaluatedEnd ?? null, evaluatedWorkSeconds: d.evaluatedWorkSeconds }));
		}
		if (share.scopes.vacation) {
			// v0.3.1: only approved/taken vacation is visible to the recipient; never sick/other, notes or documents.
			view.vacation = state.absences
				.filter((a) => a.kind === 'vacation' && BOOKED.includes(a.status) && a.startDate <= to && a.endDate >= from)
				.sort((a, b) => a.startDate.localeCompare(b.startDate))
				.map((a) => ({ startDate: a.startDate, endDate: a.endDate }));
		}
		return view;
	}

	function seedDemo(accountId: string, options: { configured?: boolean } = {}): void {
		const state = stateOf(accountId);
		const today = todayLocal(undefined, new Date(deps.clock()));
		const monday = startOfWeek(today);
		if (options.configured ?? true) state.settings = { ...DEFAULT_VACATION_SETTINGS };
		const add = (input: Partial<AbsenceInput> & Pick<AbsenceInput, 'kind' | 'startDate' | 'endDate' | 'status'>) => {
			state.absences.push(withCount(accountId, { id: uuid(), version: 1, ...(normalize(input) as AbsenceInput) }));
		};
		add({ kind: 'vacation', startDate: addDays(monday, -35), endDate: addDays(monday, -33), status: 'taken' });
		add({ kind: 'sick', startDate: addDays(monday, -14), endDate: addDays(monday, -13), status: 'taken', documentStatus: 'pending', documentReferenceStart: addDays(monday, -14), documentReferenceEnd: addDays(monday, -13), note: 'Erkältung' });
		add({ kind: 'vacation', startDate: addDays(monday, 14), endDate: addDays(monday, 18), status: 'approved' });
		add({ kind: 'vacation', startDate: addDays(monday, 42), endDate: addDays(monday, 44), halfDayEnd: true, status: 'planned' });
		state.customDays.push({ id: uuid(), kind: 'school_holiday', startDate: addDays(monday, 21), endDate: addDays(monday, 25), name: 'Berufsschulferien', source: 'custom' });
		const put = (date: string, mode: PlanMode, start: string | null, end: string | null, breakMinutes: number | null, note: string | null = null) =>
			state.plan.set(date, { date, mode, placeId: null, note, plannedStart: start, plannedEnd: end, plannedBreakMinutes: breakMinutes, plannedSeconds: plannedSecondsOf(start, end, breakMinutes) });
		put(addDays(monday, 0), 'office', '08:00', '16:30', 30);
		put(addDays(monday, 1), 'office', '08:00', '16:30', 30);
		put(addDays(monday, 2), 'home', '08:30', '17:00', 30);
		put(addDays(monday, 3), 'school', '08:00', '13:30', null, 'Blockwoche');
		put(addDays(monday, 4), 'home', '08:00', '14:30', 30);
		put(addDays(monday, 7), 'office', '08:00', '16:30', 30);
		put(addDays(monday, 8), 'customer', '07:30', '16:00', 30);
		put(addDays(monday, 9), 'home', '08:00', '16:30', 30);
		put(addDays(monday, 10), 'office', '08:00', '16:30', 30);
		put(addDays(monday, 11), 'off', null, null, null);
	}

	function seedShare(ownerId: string, recipientId: string, recipientHandle: string, scopes: ShareScopes): void {
		shares.push({ id: uuid(), ownerId, recipientId, recipientHandle, scopes, createdAt: new Date(deps.clock()).toISOString() });
	}

	/** Returns null for paths this module does not own. */
	function handle(accountId: string, req: PlanningRequest): PlanningResponse | null {
		const [path, queryString = ''] = req.path.split('?');
		const query = new URLSearchParams(queryString);
		const method = req.method.toUpperCase();
		const body = req.body ?? {};
		const prefix = '/api/v1/';
		if (!path.startsWith(prefix)) return null;
		const route = path.slice(prefix.length).replace(/\/+$/, '');
		const state = stateOf(accountId);
		let m: RegExpMatchArray | null;

		const range = (): { from: string; to: string } | PlanningResponse => {
			const from = query.get('from');
			const to = query.get('to');
			if (!isDate(from) || !isDate(to) || to < from) return fail(400, 'bad_request');
			if (daysBetween(from, to).length > MAX_RANGE_DAYS) return fail(400, 'range_too_large');
			return { from, to };
		};
		const yearOf = (): number | null => {
			const raw = query.get('year');
			const year = raw !== null && /^\d{4}$/.test(raw) ? Number(raw) : NaN;
			return year >= 1970 && year <= 2200 ? year : null;
		};

		// --- vacation ---
		if (route === 'vacation/settings') {
			if (method === 'GET') return ok(state.settings ? { ...state.settings, configured: true } : { ...DEFAULT_VACATION_SETTINGS, carryOverByYear: {}, configured: false });
			if (method === 'PUT') {
				const carry = body.carryOverByYear ?? {};
				const expiry = body.carryOverExpiry ?? null;
				if (
					typeof body.region !== 'string' || !/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(body.region) ||
					!Number.isInteger(body.annualEntitlementHalfDays) || body.annualEntitlementHalfDays < 0 ||
					carry === null || typeof carry !== 'object' || Array.isArray(carry) ||
					Object.entries(carry).some(([year, value]) => !/^\d{4}$/.test(year) || !Number.isInteger(value) || (value as number) < 0) ||
					(expiry !== null && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(expiry))
				) return fail(400, 'bad_request');
				state.settings = { region: body.region, annualEntitlementHalfDays: body.annualEntitlementHalfDays, carryOverByYear: { ...carry }, carryOverExpiry: expiry };
				return ok({ ...state.settings, configured: true });
			}
		}
		if (route === 'vacation/suggestions' && method === 'GET') return suggestions(accountId, query);
		if (route === 'vacation/balance' && method === 'GET') {
			const year = yearOf();
			return year === null ? fail(400, 'bad_request') : ok(balance(accountId, year));
		}
		if (route === 'vacation/snapshots' && method === 'POST') {
			if (!isDate(body.date) || !Number.isInteger(body.remainingHalfDays) || body.remainingHalfDays < 0) return fail(400, 'bad_request');
			state.snapshots = state.snapshots.filter((s) => s.date !== body.date);
			state.snapshots.push({ id: uuid(), date: body.date, remainingHalfDays: body.remainingHalfDays });
			return ok(balance(accountId, Number(body.date.slice(0, 4))), 201);
		}
		if (route === 'vacation/adjustments' && method === 'POST') {
			if (!isDate(body.date) || !Number.isInteger(body.halfDays) || body.halfDays === 0 || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 200) {
				return fail(400, 'bad_request');
			}
			state.adjustments.push({ id: uuid(), date: body.date, halfDays: body.halfDays, reason: body.reason.trim() });
			return ok(balance(accountId, Number(body.date.slice(0, 4))), 201);
		}

		if (route === 'vacation/entries' && method === 'GET') {
			const year = yearOf();
			if (year === null) return fail(400, 'bad_request');
			const inYear = (e: { date: string }) => e.date.startsWith(`${year}-`);
			return ok({
				snapshots: state.snapshots.filter(inYear).sort((a, b) => a.date.localeCompare(b.date)),
				adjustments: state.adjustments.filter(inYear).sort((a, b) => a.date.localeCompare(b.date))
			});
		}
		if ((m = route.match(/^vacation\/entries\/([^/]+)$/)) && method === 'DELETE') {
			const snapshot = state.snapshots.findIndex((s) => s.id === m![1]);
			if (snapshot >= 0) state.snapshots.splice(snapshot, 1);
			else {
				const adjustment = state.adjustments.findIndex((a) => a.id === m![1]);
				if (adjustment < 0) return fail(404, 'not_found');
				state.adjustments.splice(adjustment, 1);
			}
			return { status: 204 };
		}

		// --- absences ---
		if (route === 'absences') {
			if (method === 'GET') {
				const r = range();
				if ('status' in r) return r;
				return ok(
					state.absences
						.filter((a) => a.startDate <= r.to && a.endDate >= r.from)
						.map((a) => withCount(accountId, a))
						.sort((a, b) => a.startDate.localeCompare(b.startDate))
				);
			}
			if (method === 'POST') {
				const input = normalize(body);
				if (!input) return fail(400, 'bad_request');
				if (overlaps(state, input)) return fail(409, 'absence_overlap');
				const absence = withCount(accountId, { id: uuid(), version: 1, ...input });
				state.absences.push(absence);
				return ok(absence, 201);
			}
		}
		if ((m = route.match(/^absences\/([^/]+)$/))) {
			const absence = state.absences.find((a) => a.id === m![1]);
			if (!absence) return fail(404, 'not_found');
			if (method === 'GET') return ok(withCount(accountId, absence));
			if (method === 'PUT') {
				if (req.ifMatch === undefined) return fail(400, 'bad_request');
				if (String(absence.version) !== req.ifMatch) return fail(412, 'stale_version');
				const input = normalize(body);
				if (!input) return fail(400, 'bad_request');
				if (overlaps(state, input, absence.id)) return fail(409, 'absence_overlap');
				Object.assign(absence, input, { version: absence.version + 1 });
				return ok(withCount(accountId, absence));
			}
			if (method === 'DELETE') {
				state.absences.splice(state.absences.indexOf(absence), 1);
				return { status: 204 };
			}
		}

		// --- calendar ---
		if (route === 'calendar/holidays' && method === 'GET') {
			const year = yearOf();
			if (year === null) return fail(400, 'bad_request');
			const region = query.get('region') ?? regionOf(state);
			const custom = state.customDays.filter((c) => c.startDate <= `${year}-12-31` && c.endDate >= `${year}-01-01`);
			return ok([...holidaysFor(year, region), ...custom].sort((a, b) => a.startDate.localeCompare(b.startDate)));
		}
		if (route === 'calendar/custom-days' && method === 'POST') {
			if (
				!['holiday', 'school_holiday'].includes(body.kind) || !isDate(body.startDate) || !isDate(body.endDate) || body.endDate < body.startDate ||
				typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80
			) return fail(400, 'bad_request');
			const day = { id: uuid(), kind: body.kind, startDate: body.startDate, endDate: body.endDate, name: body.name.trim(), source: 'custom' as const };
			state.customDays.push(day);
			return ok(day, 201);
		}
		if ((m = route.match(/^calendar\/custom-days\/([^/]+)$/)) && method === 'DELETE') {
			const index = state.customDays.findIndex((c) => c.id === m![1]);
			if (index < 0) return fail(404, 'not_found');
			state.customDays.splice(index, 1);
			return { status: 204 };
		}

		// --- plan ---
		if (route === 'plan/days' && method === 'GET') {
			const r = range();
			if ('status' in r) return r;
			return ok([...state.plan.values()].filter((p) => p.date >= r.from && p.date <= r.to).sort((a, b) => a.date.localeCompare(b.date)));
		}
		if ((m = route.match(/^plan\/days\/(\d{4}-\d{2}-\d{2})$/))) {
			const date = m[1];
			if (!isDate(date)) return fail(400, 'bad_request');
			if (method === 'PUT') {
				const normalized = normalizePlanBody(body);
				if ('error' in normalized) return fail(400, normalized.error);
				const day: PlanDay = { date, ...normalized.day };
				state.plan.set(date, day);
				return ok(day);
			}
			if (method === 'DELETE') {
				state.plan.delete(date);
				return { status: 204 };
			}
		}

		// --- shares ---
		if (route === 'shares') {
			if (method === 'GET') return ok(shares.filter((s) => s.ownerId === accountId).map(publicShare));
			if (method === 'POST') {
				const scopes = parseScopes(body.scopes);
				if (typeof body.recipientHandle !== 'string' || !scopes) return fail(400, 'bad_request');
				const recipient = deps.findByHandle(body.recipientHandle.trim());
				if (!recipient) return fail(404, 'recipient_not_found');
				if (recipient.id === accountId) return fail(400, 'bad_request');
				if (shares.some((s) => s.ownerId === accountId && s.recipientId === recipient.id)) return fail(409, 'share_exists');
				const share: StoredShare = { id: uuid(), ownerId: accountId, recipientId: recipient.id, recipientHandle: body.recipientHandle.trim(), scopes, createdAt: new Date(deps.clock()).toISOString() };
				shares.push(share);
				return ok(publicShare(share), 201);
			}
		}
		if (route === 'shares/incoming' && method === 'GET') {
			return ok(shares.filter((s) => s.recipientId === accountId).map((s) => ({ id: s.id, ownerDisplayName: deps.displayNameOf(s.ownerId), scopes: s.scopes })));
		}
		if ((m = route.match(/^shares\/incoming\/([^/]+)\/view$/)) && method === 'GET') {
			const share = shares.find((s) => s.id === m![1] && s.recipientId === accountId);
			if (!share) return fail(404, 'not_found');
			const r = range();
			if ('status' in r) return r;
			return ok(sharedView(share, r.from, r.to));
		}
		if ((m = route.match(/^shares\/([^/]+)$/)) && m[1] !== 'incoming') {
			const share = shares.find((s) => s.id === m![1] && s.ownerId === accountId);
			if (!share) return fail(404, 'not_found');
			if (method === 'PATCH') {
				const scopes = parseScopes(body.scopes);
				if (!scopes) return fail(400, 'bad_request');
				share.scopes = scopes;
				return ok(publicShare(share));
			}
			if (method === 'DELETE') {
				shares.splice(shares.indexOf(share), 1);
				return { status: 204 };
			}
		}
		return null;
	}

	return { handle, seedDemo, seedShare, dayContext, states, shares };
}
