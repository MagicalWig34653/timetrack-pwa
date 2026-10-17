import type { PlanMode, PlanWeek, PlanWeekDay, PlanWeekEntry, TimeWeekSummary } from '#lib/api/types.js';

/**
 * Pure editing model of the week planner (K1, ADR-0021). A draft is one editable row; the server stays the only place
 * that derives the authoritative planned seconds, this file mirrors the rule (end - start - break, never negative) for
 * the live preview while typing.
 */
export type DraftMode = PlanMode | '';

export interface DayDraft {
	date: string;
	/** '' = nothing planned for this day */
	mode: DraftMode;
	start: string;
	end: string;
	breakMinutes: number;
	note: string;
	/** carried through unchanged: the planner has no place picker */
	placeId: string | null;
}

export interface WindowSuggestion {
	start: string;
	end: string;
	breakMinutes: number;
	/** history = average of the last weeks, fallback = 08:00 plus the day's target */
	source: 'history' | 'fallback';
}

export const STEP_MINUTES = 15;
export const MAX_BREAK_MINUTES = 600;
const DEFAULT_START = 8 * 60;
const DEFAULT_BREAK = 30;

export function parseClock(value: string): number | null {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatClock(minutes: number): string {
	const clamped = Math.min(Math.max(Math.round(minutes), 0), 23 * 60 + 59);
	return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

const roundTo = (minutes: number, step: number) => Math.round(minutes / step) * step;

/** Why a draft cannot be saved, or null. Rows without a mode and rows with mode off are always valid. */
export function draftProblem(draft: DayDraft): 'times_required' | 'end_before_start' | 'break_invalid' | null {
	if (draft.mode === '' || draft.mode === 'off') return null;
	const start = parseClock(draft.start);
	const end = parseClock(draft.end);
	if (draft.start === '' && draft.end === '' && draft.breakMinutes === 0) return null; // mode without times is allowed (rough plan)
	if (start === null || end === null) return 'times_required';
	if (end <= start) return 'end_before_start';
	if (!Number.isInteger(draft.breakMinutes) || draft.breakMinutes < 0 || draft.breakMinutes > MAX_BREAK_MINUTES) return 'break_invalid';
	return null;
}

/** Planned seconds of a draft as the server derives them; null without usable times. */
export function plannedSecondsOf(draft: DayDraft): number | null {
	if (draft.mode === '' || draft.mode === 'off') return null;
	const start = parseClock(draft.start);
	const end = parseClock(draft.end);
	if (start === null || end === null || end <= start) return null;
	return Math.max(0, (end - start - Math.max(0, draft.breakMinutes)) * 60);
}

export function emptyDraft(date: string): DayDraft {
	return { date, mode: '', start: '', end: '', breakMinutes: 0, note: '', placeId: null };
}

export function draftFromDay(day: PlanWeekDay): DayDraft {
	const plan = day.plan;
	if (!plan) return emptyDraft(day.date);
	return {
		date: day.date,
		mode: plan.mode,
		start: plan.plannedStart ?? '',
		end: plan.plannedEnd ?? '',
		breakMinutes: plan.plannedBreakMinutes ?? 0,
		note: plan.note ?? '',
		placeId: plan.placeId ?? null
	};
}

/** The request entry of a draft; null when nothing is planned. */
export function entryFromDraft(draft: DayDraft): PlanWeekEntry | null {
	if (draft.mode === '') return null;
	const entry: PlanWeekEntry = { date: draft.date, mode: draft.mode, placeId: draft.placeId, note: draft.note.trim() || null };
	if (draft.mode !== 'off' && parseClock(draft.start) !== null && parseClock(draft.end) !== null) {
		entry.plannedStart = draft.start;
		entry.plannedEnd = draft.end;
		entry.plannedBreakMinutes = draft.breakMinutes;
	}
	return entry;
}

export const isBlocked = (day: PlanWeekDay) => day.blockedBy !== null;

/** Suggested working window: average of the last weeks' averages (rounded to 15 min), else 08:00 plus the day's target. */
export function suggestWindow(history: TimeWeekSummary[], targetSeconds: number): WindowSuggestion {
	const starts: number[] = [];
	const ends: number[] = [];
	let breakSeconds = 0;
	let workDays = 0;
	for (const week of history) {
		const start = week.averageStart ? parseClock(week.averageStart) : null;
		const end = week.averageEnd ? parseClock(week.averageEnd) : null;
		if (start === null || end === null || end <= start || week.workDays === 0) continue;
		starts.push(start);
		ends.push(end);
		breakSeconds += week.breakSeconds;
		workDays += week.workDays;
	}
	if (starts.length > 0) {
		const start = roundTo(starts.reduce((a, b) => a + b, 0) / starts.length, STEP_MINUTES);
		const end = roundTo(ends.reduce((a, b) => a + b, 0) / ends.length, STEP_MINUTES);
		const gap = workDays > 0 ? breakSeconds / workDays / 60 : 0;
		// Gaps below 15 minutes are no real break; the usual half hour is the fallback.
		const breakMinutes = gap >= 15 ? Math.min(MAX_BREAK_MINUTES, roundTo(gap, 5)) : end - start >= 360 ? DEFAULT_BREAK : 0;
		if (end > start) return { start: formatClock(start), end: formatClock(end), breakMinutes, source: 'history' };
	}
	return fallbackWindow(targetSeconds);
}

export function fallbackWindow(targetSeconds: number): WindowSuggestion {
	const breakMinutes = targetSeconds > 6 * 3600 ? DEFAULT_BREAK : 0;
	const end = roundTo(DEFAULT_START + targetSeconds / 60 + breakMinutes, STEP_MINUTES);
	return { start: formatClock(DEFAULT_START), end: formatClock(Math.min(end, 23 * 60 + 45)), breakMinutes, source: 'fallback' };
}

/** Window to prefill for one day: the history suggestion, or the fallback derived from that day's own target. */
export function windowForDay(suggestion: WindowSuggestion, targetSeconds: number): WindowSuggestion {
	return suggestion.source === 'history' ? suggestion : fallbackWindow(targetSeconds);
}

/** Changes the mode of a draft; picking a working mode on an empty row prefills the suggested times. */
export function withMode(draft: DayDraft, mode: DraftMode, suggestion: WindowSuggestion, targetSeconds: number): DayDraft {
	if (mode === '' || mode === 'off') return { ...draft, mode, start: '', end: '', breakMinutes: 0 };
	if (draft.start !== '' && draft.end !== '') return { ...draft, mode };
	const window = windowForDay(suggestion, targetSeconds);
	return { ...draft, mode, start: window.start, end: window.end, breakMinutes: window.breakMinutes };
}

const isWorkday = (day: PlanWeekDay) => day.targetSeconds > 0 && !isBlocked(day);

/** "Standardwoche": office on every workday of the work model with the suggested window, everything else cleared. */
export function standardWeek(days: PlanWeekDay[], current: DayDraft[], suggestion: WindowSuggestion): DayDraft[] {
	return current.map((draft, index) => {
		const day = days[index];
		if (isBlocked(day)) return draft;
		if (!isWorkday(day)) return { ...emptyDraft(draft.date), placeId: null };
		const window = windowForDay(suggestion, day.targetSeconds);
		return { ...emptyDraft(draft.date), mode: 'office', start: window.start, end: window.end, breakMinutes: window.breakMinutes };
	});
}

/** Copies the plan of another week day by day (Monday to Monday); blocked days keep their draft. */
export function copyWeek(source: PlanWeek, days: PlanWeekDay[], current: DayDraft[]): DayDraft[] {
	return current.map((draft, index) => {
		if (isBlocked(days[index])) return draft;
		const from = source.days[index];
		return from ? { ...draftFromDay(from), date: draft.date } : emptyDraft(draft.date);
	});
}

/** The first planned day is applied to all other workdays (mode, times, break); notes stay as they are. */
export function sameForWorkdays(days: PlanWeekDay[], current: DayDraft[]): DayDraft[] {
	const model = current.find((draft, index) => draft.mode !== '' && !isBlocked(days[index]));
	if (!model) return current;
	return current.map((draft, index) => {
		const day = days[index];
		if (isBlocked(day) || !isWorkday(day)) return draft;
		return { ...draft, mode: model.mode, start: model.start, end: model.end, breakMinutes: model.breakMinutes, placeId: model.placeId };
	});
}

export function clearWeek(days: PlanWeekDay[], current: DayDraft[]): DayDraft[] {
	return current.map((draft, index) => (isBlocked(days[index]) ? draft : emptyDraft(draft.date)));
}

/** Live totals: blocked days count 0 planned; the target comes from the server. */
export function weekTotals(days: PlanWeekDay[], drafts: DayDraft[]): { plannedSeconds: number; targetSeconds: number; differenceSeconds: number } {
	let planned = 0;
	let target = 0;
	drafts.forEach((draft, index) => {
		target += days[index].targetSeconds;
		if (!isBlocked(days[index])) planned += plannedSecondsOf(draft) ?? 0;
	});
	return { plannedSeconds: planned, targetSeconds: target, differenceSeconds: planned - target };
}

/** The PUT body: every planned row, including the stored plan of blocked days (replace=true would delete it otherwise). */
export function weekRequest(drafts: DayDraft[]): { replace: true; days: PlanWeekEntry[] } {
	return { replace: true, days: drafts.map(entryFromDraft).filter((entry): entry is PlanWeekEntry => entry !== null) };
}

export const draftsEqual = (a: DayDraft[], b: DayDraft[]) => JSON.stringify(a) === JSON.stringify(b);
