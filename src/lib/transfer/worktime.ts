// TypeScript port of the worktime workbook import rules of ADR-0013 (remark rules, pause split, absence merging, holidays).
// The real backend (C21) evaluates on the server; this port backs the mock API and the client-side rule helpers of the
// profile step. Nothing here writes data. Reading the workbook itself lives in mock/worktime-xlsx.ts.
import type { ImportErrorCode, ImportPreview, SegmentKind, WorktimeAction, WorktimeOptions, WorktimePreview, WorktimeRemarkRule } from '../api/types.ts';
import { DEFAULT_TIMEZONE, addDays, isoWeekday, zonedTimeToInstant } from '../time/dates.ts';

export const WORKTIME_ACTIONS: WorktimeAction[] = ['work', 'school', 'vacation', 'sick', 'excused', 'holiday', 'skip'];
export const ABSENCE_ACTIONS: WorktimeAction[] = ['vacation', 'sick', 'excused'];
export const MAX_RULES = 100;
export const MAX_PATTERN = 80;

/** Standard remark rules of ADR-0013 in precedence order (`excused` before `vacation`). The server serves the same list. */
export const DEFAULT_WORKTIME_RULES: WorktimeRemarkRule[] = [
	{ pattern: 'krank', action: 'sick' },
	{ pattern: 'freigestellt', action: 'excused' },
	{ pattern: 'urlaub', action: 'vacation' },
	{ pattern: 'feiertag', action: 'holiday' },
	{ pattern: 'berufsschule', action: 'school' },
	{ pattern: '^bs$', action: 'school' }
];

export const DEFAULT_WORKTIME_OPTIONS = {
	pauseMode: 'split',
	pauseMinutes: null,
	pauseStart: '12:00',
	roundToMinutes: true
} as const satisfies WorktimeOptions;

/** Errors that only warn: the day is imported (as one segment) and the commit is not blocked. */
export const WARNING_CODES: ImportErrorCode[] = ['pause_exceeds_day'];
export const isWarning = (code: string) => (WARNING_CODES as string[]).includes(code);

// ---------------------------------------------------------------------------------------------------- rules

/** Collapses whitespace including NBSP and trims. */
export const normalizeRemark = (text: string) => text.replace(/[\s ]+/g, ' ').trim();

const isExactPattern = (pattern: string) => pattern.length >= 2 && pattern.startsWith('^') && pattern.endsWith('$');

export function ruleMatches(rule: WorktimeRemarkRule, remark: string): boolean {
	const text = normalizeRemark(remark).toLowerCase();
	const pattern = normalizeRemark(rule.pattern).toLowerCase();
	if (pattern === '' || text === '') return false;
	if (isExactPattern(pattern)) return text === normalizeRemark(pattern.slice(1, -1));
	return text.includes(pattern);
}

/** First matching rule wins. `rule` is null when nothing matched: the standard fallback is `work` with the remark as note. */
export function resolveRemark(rules: WorktimeRemarkRule[], remark: string): { action: WorktimeAction; rule: WorktimeRemarkRule | null } {
	const rule = rules.find((r) => ruleMatches(r, remark)) ?? null;
	return { action: rule?.action ?? 'work', rule };
}

export type RuleIssue = 'pattern_empty' | 'pattern_too_long' | 'pattern_exact_empty' | 'duplicate_pattern' | 'too_many';

/** Validation of the rule table in the profile step; keys are indices of the offending rules. */
export function ruleIssues(rules: WorktimeRemarkRule[]): { index: number; issue: RuleIssue }[] {
	const out: { index: number; issue: RuleIssue }[] = [];
	const seen = new Set<string>();
	rules.forEach((rule, index) => {
		const pattern = normalizeRemark(rule.pattern);
		if (pattern === '') out.push({ index, issue: 'pattern_empty' });
		else if (rule.pattern.length > MAX_PATTERN) out.push({ index, issue: 'pattern_too_long' });
		else if (isExactPattern(pattern) && normalizeRemark(pattern.slice(1, -1)) === '') out.push({ index, issue: 'pattern_exact_empty' });
		const key = pattern.toLowerCase();
		if (pattern !== '' && seen.has(key)) out.push({ index, issue: 'duplicate_pattern' });
		seen.add(key);
	});
	if (rules.length > MAX_RULES) out.push({ index: MAX_RULES, issue: 'too_many' });
	return out;
}

export function moveRule<T>(rules: T[], index: number, delta: -1 | 1): T[] {
	const target = index + delta;
	if (index < 0 || index >= rules.length || target < 0 || target >= rules.length) return rules;
	const copy = [...rules];
	[copy[index], copy[target]] = [copy[target], copy[index]];
	return copy;
}

export const removeRule = <T>(rules: T[], index: number): T[] => rules.filter((_, i) => i !== index);

/** Exact-text rule for one remark ("Regel für diesen Text anlegen"); `^` / `$` and trailing spaces are not part of the text. */
export function exactRuleFor(text: string, action: WorktimeAction): WorktimeRemarkRule {
	return { pattern: `^${normalizeRemark(text).toLowerCase()}$`.slice(0, MAX_PATTERN), action };
}

// ---------------------------------------------------------------------------------------------------- evaluation

export interface WorktimeDayRow {
	date: string;
	/** sheet name for diagnostics */
	sheet: string;
	/** 1-based sheet row */
	row: number;
	/** seconds since midnight; null = empty cell */
	start: number | null;
	end: number | null;
	remark: string;
}

export interface WorktimeContext {
	/** ISO date of "today" in the account zone (past absences are `taken`) */
	today: string;
	timezone?: string;
	/** dates in the built-in calendar of the region (Feiertage) */
	holidays: Set<string>;
	/** custom holidays already stored (dates) */
	customHolidays: Set<string>;
	existingSegments: { startedAt: string; endedAt: string | null; kind: SegmentKind }[];
	existingAbsences: { kind: string; startDate: string; endDate: string; status: string }[];
	/** pause from the table (H1) in minutes, 0 when missing */
	tablePauseMinutes: number;
	/** false when module `planning` is off: absences and custom holidays cannot be written */
	planningEnabled: boolean;
	sheetBalanceSeconds?: number | null;
	dateSystem: '1900' | '1904';
}

export interface WorktimeSegmentItem {
	row: number;
	date: string;
	startedAt: string;
	endedAt: string;
	kind: SegmentKind;
	note: string | null;
}
export interface WorktimeAbsenceItem {
	row: number;
	kind: 'vacation' | 'sick' | 'excused';
	startDate: string;
	endDate: string;
	status: 'taken' | 'approved';
	note: string | null;
}
export interface WorktimeCustomDayItem {
	row: number;
	date: string;
	name: string;
}

export interface WorktimeOutcome {
	preview: ImportPreview;
	segments: WorktimeSegmentItem[];
	absences: WorktimeAbsenceItem[];
	customDays: WorktimeCustomDayItem[];
}

const clock = (seconds: number) => {
	const s = Math.floor(seconds);
	return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const parseClock = (value: string): number => {
	const [h, m] = value.split(':').map(Number);
	return h * 3600 + m * 60;
};

export function resolveOptions(options: WorktimeOptions | undefined): Required<Omit<WorktimeOptions, 'pauseMinutes'>> & { pauseMinutes: number | null } {
	return {
		pauseMode: options?.pauseMode ?? 'split',
		pauseMinutes: options?.pauseMinutes ?? null,
		pauseStart: options?.pauseStart ?? '12:00',
		roundToMinutes: options?.roundToMinutes ?? true,
		rules: options?.rules && options.rules.length > 0 ? options.rules : DEFAULT_WORKTIME_RULES
	};
}

/** Splits [start, end) around the pause; the gap starts at `pauseStart` or, when it does not fit, in the middle. */
export function splitAroundPause(start: number, end: number, pauseSeconds: number, pauseStart: number): [number, number][] {
	if (pauseSeconds <= 0 || end - start <= pauseSeconds) return [[start, end]];
	let gapStart = pauseStart;
	if (gapStart < start || gapStart + pauseSeconds > end) gapStart = start + Math.floor((end - start - pauseSeconds) / 2);
	const parts: [number, number][] = [];
	if (gapStart > start) parts.push([start, gapStart]);
	if (gapStart + pauseSeconds < end) parts.push([gapStart + pauseSeconds, end]);
	return parts;
}

const isWeekend = (date: string) => isoWeekday(date) >= 6;

/**
 * Evaluates the day rows of a worktime workbook (ADR-0013). Pure: the caller supplies existing data and the built-in calendar.
 * Duplicate dates (the same ISO week in two yearly sheets) are merged when identical and reported as `duplicate_date_conflict` otherwise.
 */
export function evaluateWorktime(inputRows: WorktimeDayRow[], optionsInput: WorktimeOptions | undefined, ctx: WorktimeContext): WorktimeOutcome {
	const options = resolveOptions(optionsInput);
	const zone = ctx.timezone || DEFAULT_TIMEZONE;
	const errors: { row: number; code: ImportErrorCode }[] = [];
	const fail = (row: number, code: ImportErrorCode) => errors.push({ row, code });
	const norm = (v: number | null) => (v === null ? null : options.roundToMinutes ? Math.round(v / 60) * 60 : Math.round(v));

	// 1) merge duplicate dates across sheets
	const byDate = new Map<string, WorktimeDayRow & { start: number | null; end: number | null }>();
	const sorted = [...inputRows].sort((a, b) => a.date.localeCompare(b.date) || a.sheet.localeCompare(b.sheet) || a.row - b.row);
	for (const raw of sorted) {
		// a sheet that only repeats the date cells of a shared week never conflicts
		if (raw.start === null && raw.end === null && normalizeRemark(raw.remark) === '') continue;
		const row = { ...raw, start: norm(raw.start), end: norm(raw.end), remark: normalizeRemark(raw.remark) };
		const existing = byDate.get(row.date);
		if (!existing) {
			byDate.set(row.date, row);
			continue;
		}
		const same = existing.start === row.start && existing.end === row.end && existing.remark.toLowerCase() === row.remark.toLowerCase();
		if (!same) {
			fail(row.row, 'duplicate_date_conflict');
			existing.date = ''; // poisoned: dropped below
		}
	}
	const rows = [...byDate.values()].filter((r) => r.date !== '');

	const unmapped = new Map<string, { text: string; count: number }>();
	const byAction: Record<string, number> = {};
	const segments: WorktimeSegmentItem[] = [];
	const customDays: WorktimeCustomDayItem[] = [];
	const absenceDays: { date: string; kind: WorktimeAbsenceItem['kind']; row: number; remark: string }[] = [];
	const tableHolidays = new Set<string>();
	let skippedHolidays = 0;
	let duplicates = 0;
	let days = 0;
	let firstDate: string | null = null;
	let lastDate: string | null = null;

	const takenIntervals = ctx.existingSegments.filter((s) => s.endedAt).map((s) => ({ start: Date.parse(s.startedAt), end: Date.parse(s.endedAt as string) }));
	const knownKeys = new Set(ctx.existingSegments.map((s) => `${Date.parse(s.startedAt)}|${s.endedAt ? Date.parse(s.endedAt) : ''}|${s.kind}`));
	const pauseSeconds = (options.pauseMinutes ?? ctx.tablePauseMinutes) * 60;
	const pauseStart = parseClock(options.pauseStart);

	for (const r of rows) {
		const hasTimes = r.start !== null || r.end !== null;
		if (!hasTimes && r.remark === '') continue;
		days++;
		if (firstDate === null || r.date < firstDate) firstDate = r.date;
		if (lastDate === null || r.date > lastDate) lastDate = r.date;

		const { action, rule } = resolveRemark(options.rules, r.remark);
		byAction[action] = (byAction[action] ?? 0) + 1;
		if (!rule && r.remark !== '') {
			const key = r.remark.toLowerCase();
			const entry = unmapped.get(key);
			if (entry) entry.count++;
			else unmapped.set(key, { text: r.remark, count: 1 });
		}

		if (action === 'skip') continue;
		if (action === 'holiday') {
			tableHolidays.add(r.date);
			if (ctx.holidays.has(r.date)) skippedHolidays++;
			else if (!ctx.planningEnabled) fail(r.row, 'planning_disabled');
			else if (ctx.customHolidays.has(r.date)) duplicates++;
			else customDays.push({ row: r.row, date: r.date, name: r.remark.slice(0, 80) || r.date });
			continue;
		}
		if (ABSENCE_ACTIONS.includes(action)) {
			if (!ctx.planningEnabled) fail(r.row, 'planning_disabled');
			else absenceDays.push({ date: r.date, kind: action as WorktimeAbsenceItem['kind'], row: r.row, remark: r.remark });
			continue;
		}

		// work / school
		if (!hasTimes) continue; // a remark without times creates nothing
		if (r.start === null || r.end === null) {
			fail(r.row, 'missing_value');
			continue;
		}
		if (r.end <= r.start) {
			fail(r.row, 'end_before_start');
			continue;
		}
		const kind: SegmentKind = action === 'school' ? 'school' : 'work';
		let parts: [number, number][] = [[r.start, r.end]];
		if (options.pauseMode === 'split' && pauseSeconds > 0) {
			if (r.end - r.start <= pauseSeconds) fail(r.row, 'pause_exceeds_day');
			else parts = splitAroundPause(r.start, r.end, pauseSeconds, pauseStart);
		}
		const built = parts.map(([s, e]) => ({
			row: r.row,
			date: r.date,
			startedAt: zonedTimeToInstant(r.date, clock(s), zone).toISOString(),
			endedAt: zonedTimeToInstant(r.date, clock(e), zone).toISOString(),
			kind,
			note: r.remark || null
		}));
		const fresh = built.filter((b) => !knownKeys.has(`${Date.parse(b.startedAt)}|${Date.parse(b.endedAt)}|${b.kind}`));
		if (fresh.length === 0) {
			duplicates++;
			continue;
		}
		if (fresh.some((b) => takenIntervals.some((t) => t.start < Date.parse(b.endedAt) && t.end > Date.parse(b.startedAt)))) {
			fail(r.row, 'overlap');
			continue;
		}
		for (const b of fresh) {
			knownKeys.add(`${Date.parse(b.startedAt)}|${Date.parse(b.endedAt)}|${b.kind}`);
			takenIntervals.push({ start: Date.parse(b.startedAt), end: Date.parse(b.endedAt) });
			segments.push(b);
		}
	}

	// 2) absences: merge consecutive working days of the same kind; weekends and holidays do not interrupt
	const absences: WorktimeAbsenceItem[] = [];
	absenceDays.sort((a, b) => a.date.localeCompare(b.date));
	const isOff = (date: string) => isWeekend(date) || ctx.holidays.has(date) || tableHolidays.has(date);
	let current: { kind: WorktimeAbsenceItem['kind']; startDate: string; endDate: string; row: number; notes: string[] } | null = null;
	const flush = () => {
		if (!current) return;
		const status: WorktimeAbsenceItem['status'] = current.endDate < ctx.today ? 'taken' : 'approved';
		const note = current.notes.join(' / ').slice(0, 500) || null;
		const clash = ctx.existingAbsences.filter((a) => !['rejected', 'cancelled'].includes(a.status) && a.startDate <= current!.endDate && a.endDate >= current!.startDate);
		if (clash.length === 0) absences.push({ row: current.row, kind: current.kind, startDate: current.startDate, endDate: current.endDate, status, note });
		else if (clash.length === 1 && clash[0].kind === current.kind && clash[0].startDate === current.startDate && clash[0].endDate === current.endDate) duplicates++;
		else fail(current.row, 'overlap');
		current = null;
	};
	for (const day of absenceDays) {
		if (current && current.kind === day.kind) {
			let cursor = addDays(current.endDate, 1);
			while (cursor < day.date && isOff(cursor)) cursor = addDays(cursor, 1);
			if (cursor === day.date) {
				current.endDate = day.date;
				if (day.remark && !current.notes.includes(day.remark)) current.notes.push(day.remark);
				continue;
			}
		}
		flush();
		current = { kind: day.kind, startDate: day.date, endDate: day.date, row: day.row, notes: day.remark ? [day.remark] : [] };
	}
	flush();

	const worktime: WorktimePreview = {
		days,
		segments: segments.length,
		absences: absences.length,
		customDays: customDays.length,
		skippedHolidays,
		firstDate,
		lastDate,
		dateSystem: ctx.dateSystem,
		sheetBalanceSeconds: ctx.sheetBalanceSeconds ?? null,
		unmappedRemarks: [...unmapped.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
		byAction
	};
	return {
		preview: {
			profile: 'worktime_workbook',
			rows: days,
			valid: segments.length + absences.length + customDays.length,
			duplicates,
			errorCount: errors.length,
			errors,
			sample: segments.slice(0, 10).map((s) => ({ date: s.date, startedAt: s.startedAt, endedAt: s.endedAt, kind: s.kind })),
			worktime
		},
		segments,
		absences,
		customDays
	};
}
