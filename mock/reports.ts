// In-memory mock of contract v0.6.0 (ADR-0008): Berichtsheft - learning fields, entries, ISO weeks, text output, sources.
// The backend implements these in C15. Week arithmetic and the text format are the TS ports in src/lib/reports/.
import type { DayEvaluation, FileMeta, LearningField, ReportEntry, ReportSource, ReportStatus, ReportWeek } from '../src/lib/api/types.ts';
import { formatWeekText } from '../src/lib/reports/text.ts';
import { isValidIsoWeek, weekDates } from '../src/lib/reports/weeks.ts';
import { addDays } from '../src/lib/time/dates.ts';

export interface ReportsRequest {
	method: string;
	/** path including `/api/v1` and the query string */
	path: string;
	body?: any;
	ifMatch?: string;
}

export interface ReportsResponse {
	status: number;
	body?: unknown;
	binary?: { bytes: Uint8Array; contentType: string; headers: Record<string, string> };
}

export interface ReportsDeps {
	clock: () => number;
	/** internal call into the time mock (time/days for the tracked-hours hint) */
	call: (accountId: string, method: string, path: string, body?: unknown) => { status: number; body?: any } | null;
	/** metadata of an uploaded file owned by the account, or null */
	fileOf: (accountId: string, fileId: string) => FileMeta | null;
}

const uuid = () => crypto.randomUUID();
const fail = (status: number, code: string, message = code): ReportsResponse => ({ status, body: { error: { code, message } } });
const ok = (body: unknown, status = 200): ReportsResponse => ({ status, body });
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;

interface State {
	fields: LearningField[];
	entries: ReportEntry[];
	status: Map<string, ReportStatus>;
	sources: { id: string; createdAt: string; year: number; week: number; date: string | null; note: string | null; fileId: string | null }[];
}

export function createReportsMock(deps: ReportsDeps) {
	const states = new Map<string, State>();
	const stateOf = (accountId: string): State => {
		let s = states.get(accountId);
		if (!s) states.set(accountId, (s = { fields: [], entries: [], status: new Map(), sources: [] }));
		return s;
	};
	const weekKey = (year: number, week: number) => `${year}-${week}`;

	/** The week an entry date belongs to is derived from the date, so entries are found by date range. */
	function entriesOfWeek(s: State, year: number, week: number): ReportEntry[] {
		const dates = weekDates(year, week);
		return s.entries.filter((e) => e.date >= dates[0] && e.date <= dates[6]).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || 0);
	}

	function parseWeek(yearText: string, weekText: string): { year: number; week: number } | null {
		const year = Number(yearText);
		const week = Number(weekText);
		return isValidIsoWeek(year, week) ? { year, week } : null;
	}

	function weekView(accountId: string, year: number, week: number): ReportWeek {
		const s = stateOf(accountId);
		const entries = entriesOfWeek(s, year, week);
		const byName = new Map<string, number>();
		for (const e of entries) byName.set(e.learningField, (byName.get(e.learningField) ?? 0) + (e.durationSeconds ?? 0));
		const dates = weekDates(year, week);
		const days = deps.call(accountId, 'GET', `/api/v1/time/days?from=${dates[0]}&to=${dates[6]}`);
		const tracked = days && days.status === 200 ? (days.body as DayEvaluation[]).reduce((sum, d) => sum + d.evaluatedWorkSeconds, 0) : undefined;
		return {
			year,
			week,
			startDate: dates[0],
			endDate: dates[6],
			status: s.status.get(weekKey(year, week)) ?? 'draft',
			entries,
			totalSeconds: entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0),
			byLearningField: [...byName].map(([learningField, seconds]) => ({ learningField, seconds })),
			...(tracked !== undefined ? { trackedWorkSeconds: tracked } : {}),
			sourceCount: s.sources.filter((x) => x.year === year && x.week === week).length
		};
	}

	function validateField(input: any): { number: number | null; name: string; sortOrder: number } | null {
		const name = typeof input?.name === 'string' ? input.name.trim() : '';
		if (name.length < 1 || name.length > 120) return null;
		const number = input.number ?? null;
		if (number !== null && (!Number.isInteger(number) || number < 0)) return null;
		const sortOrder = input.sortOrder ?? 0;
		if (!Number.isInteger(sortOrder)) return null;
		return { number, name, sortOrder };
	}

	const sortFields = (fields: LearningField[]) =>
		[...fields].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.number ?? Infinity) - (b.number ?? Infinity) || a.name.localeCompare(b.name, 'de'));

	function fieldRoutes(accountId: string, method: string, route: string, req: ReportsRequest): ReportsResponse | null {
		const s = stateOf(accountId);
		if (route === 'reports/learning-fields') {
			if (method === 'GET') return ok(sortFields(s.fields));
			if (method === 'POST') {
				const parsed = validateField(req.body);
				if (!parsed) return fail(400, 'bad_request');
				if (s.fields.some((f) => f.name.toLowerCase() === parsed.name.toLowerCase())) return fail(409, 'learning_field_exists');
				const field: LearningField = { id: uuid(), ...parsed };
				s.fields.push(field);
				return ok(field, 201);
			}
		}
		const m = route.match(/^reports\/learning-fields\/([^/]+)$/);
		if (m) {
			const field = s.fields.find((f) => f.id === m[1]);
			if (!field) return fail(404, 'not_found');
			if (method === 'PUT') {
				const parsed = validateField(req.body);
				if (!parsed) return fail(400, 'bad_request');
				if (s.fields.some((f) => f.id !== field.id && f.name.toLowerCase() === parsed.name.toLowerCase())) return fail(409, 'learning_field_exists');
				Object.assign(field, parsed); // existing entries keep their name snapshot
				return ok(field);
			}
			if (method === 'DELETE') {
				s.fields = s.fields.filter((f) => f !== field);
				return { status: 204 };
			}
		}
		return null;
	}

	function entryInput(s: State, input: any): { date: string; learningFieldId: string | null; learningField: string; durationSeconds: number; notes: string } | ReportsResponse {
		if (!isDate(input?.date)) return fail(400, 'bad_request');
		let learningField = typeof input.learningField === 'string' ? input.learningField.trim() : '';
		const learningFieldId = input.learningFieldId ?? null;
		if (learningFieldId) {
			const field = s.fields.find((f) => f.id === learningFieldId);
			if (!field) return fail(404, 'not_found'); // like the real server: unknown or foreign field id
			learningField = field.name; // the current name becomes the snapshot
		}
		if (learningField.length < 1 || learningField.length > 120) return fail(400, 'bad_request');
		const durationSeconds = input.durationSeconds ?? 0;
		if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 86_400) return fail(400, 'bad_request');
		const notes = input.notes ?? '';
		if (typeof notes !== 'string' || notes.length > 4000) return fail(400, 'bad_request');
		return { date: input.date, learningFieldId, learningField, durationSeconds, notes };
	}

	function entryRoutes(accountId: string, method: string, route: string, req: ReportsRequest): ReportsResponse | null {
		const s = stateOf(accountId);
		if (route === 'reports/entries' && method === 'POST') {
			const parsed = entryInput(s, req.body);
			if ('status' in parsed) return parsed;
			const entry: ReportEntry = { id: uuid(), version: 1, createdAt: new Date(deps.clock()).toISOString(), ...parsed };
			s.entries.push(entry);
			return ok(entry, 201);
		}
		const m = route.match(/^reports\/entries\/([^/]+)$/);
		if (!m) return null;
		const entry = s.entries.find((e) => e.id === m[1]);
		if (!entry) return fail(404, 'not_found');
		if (method === 'PUT') {
			if (req.ifMatch === undefined) return fail(412, 'stale_version'); // like the real server: a missing If-Match is a stale version
			if (String(entry.version) !== req.ifMatch.replace(/^W\/|"/g, '')) return fail(412, 'stale_version');
			const parsed = entryInput(s, req.body);
			if ('status' in parsed) return parsed;
			Object.assign(entry, parsed, { version: entry.version + 1 });
			return ok(entry);
		}
		if (method === 'DELETE') {
			s.entries = s.entries.filter((e) => e !== entry);
			return { status: 204 };
		}
		return null;
	}

	function weekRoutes(accountId: string, method: string, route: string, req: ReportsRequest): ReportsResponse | null {
		const m = route.match(/^reports\/weeks\/(-?\d+)\/(-?\d+)(\/text)?$/);
		if (!m) return null;
		const week = parseWeek(m[1], m[2]);
		if (!week) return fail(400, 'bad_request');
		if (m[3]) {
			if (method !== 'GET') return null;
			const view = weekView(accountId, week.year, week.week);
			return { status: 200, binary: { bytes: new TextEncoder().encode(formatWeekText(week, view.entries)), contentType: 'text/plain; charset=utf-8', headers: {} } };
		}
		if (method === 'GET') return ok(weekView(accountId, week.year, week.week));
		if (method === 'PUT') {
			const status = req.body?.status;
			if (status !== 'draft' && status !== 'done') return fail(400, 'bad_request');
			stateOf(accountId).status.set(weekKey(week.year, week.week), status);
			return ok(weekView(accountId, week.year, week.week));
		}
		return null;
	}

	function sourceRoutes(accountId: string, method: string, route: string, req: ReportsRequest, query: URLSearchParams): ReportsResponse | null {
		const s = stateOf(accountId);
		const present = (x: (typeof s.sources)[number]): ReportSource => ({
			id: x.id,
			createdAt: x.createdAt,
			year: x.year,
			week: x.week,
			date: x.date,
			note: x.note,
			fileId: x.fileId,
			file: x.fileId ? deps.fileOf(accountId, x.fileId) : null
		});
		if (route === 'reports/sources' && method === 'GET') {
			const week = parseWeek(query.get('year') ?? '', query.get('week') ?? '');
			if (!week) return fail(400, 'bad_request');
			return ok(s.sources.filter((x) => x.year === week.year && x.week === week.week).map(present));
		}
		if (route === 'reports/sources' && method === 'POST') {
			const b = req.body;
			const week = parseWeek(String(b?.year), String(b?.week));
			if (!week) return fail(400, 'bad_request');
			const note = typeof b.note === 'string' ? b.note.trim() : '';
			const fileId = b.fileId ?? null;
			// exactly one of text note and file
			if ((note !== '') === (fileId !== null) || note.length > 4000) return fail(400, 'bad_request');
			let date: string | null = b.date ?? null;
			if (date !== null && (!isDate(date) || !weekDates(week.year, week.week).includes(date))) return fail(400, 'bad_request');
			if (fileId && !deps.fileOf(accountId, fileId)) return fail(404, 'not_found');
			date = date ?? null;
			const source = { id: uuid(), createdAt: new Date(deps.clock()).toISOString(), ...week, date, note: note || null, fileId };
			s.sources.push(source);
			return ok(present(source), 201);
		}
		const m = route.match(/^reports\/sources\/([^/]+)$/);
		if (m && method === 'DELETE') {
			const source = s.sources.find((x) => x.id === m[1]);
			if (!source) return fail(404, 'not_found');
			s.sources = s.sources.filter((x) => x !== source);
			return { status: 204 };
		}
		return null;
	}

	function handle(accountId: string, req: ReportsRequest): ReportsResponse | null {
		const [path, queryString = ''] = req.path.split('?');
		const prefix = '/api/v1/';
		if (!path.startsWith(prefix)) return null;
		const route = path.slice(prefix.length).replace(/\/+$/, '');
		if (!route.startsWith('reports/')) return null;
		const method = req.method.toUpperCase();
		return (
			fieldRoutes(accountId, method, route, req) ??
			entryRoutes(accountId, method, route, req) ??
			weekRoutes(accountId, method, route, req) ??
			sourceRoutes(accountId, method, route, req, new URLSearchParams(queryString))
		);
	}

	return { handle, states };
}
