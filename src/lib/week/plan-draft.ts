import type { PlanBlockKind, PlanHint, PlanMode, PlanTimeBlock, PlanWeek, PlanWeekDay, PlanWeekEntry, TimeWeekSummary } from '#lib/api/types.js';

/**
 * Pure editing model of the week planner (K1, ADR-0021; P13, ADR-0031). A draft is one editable day. Since contract
 * 0.35.0 a day holds a list of time blocks (gaps allowed, no overlap, at most 32); on an older server a day holds at
 * most one block plus a break length (`breakMinutes`, legacy only). The server stays the only place that derives the
 * authoritative planned seconds; this file mirrors the rule (sum of block durations, minus the legacy break) for the
 * live preview while editing.
 */
export type DraftMode = PlanMode | '';
export type BlockKind = PlanBlockKind;

export const BLOCK_KINDS: BlockKind[] = ['work', 'school', 'travel', 'office', 'home', 'customer'];
export const MAX_BLOCKS = 32;
export const MAX_NOTE_LENGTH = 200;

export interface DraftBlock {
	start: string;
	end: string;
	kind: BlockKind;
	placeId: string | null;
	note: string;
}

export interface DayDraft {
	date: string;
	/** '' = nothing planned for this day. The day-level mode is independent of the kinds of its blocks. */
	mode: DraftMode;
	/** Chronological, non-overlapping while valid; always empty for '' and 'off'. At most one block on an older server. */
	blocks: DraftBlock[];
	/** Legacy servers only (before contract 0.35.0): the break inside the single block. With block lists the gaps are the breaks and this is 0. */
	breakMinutes: number;
	/** Day note. */
	note: string;
	/** Day-level place, carried through unchanged. */
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

export type DraftProblem = 'times_required' | 'end_before_start' | 'break_invalid' | 'blocks_overlap' | 'too_many_blocks' | 'note_too_long';

const minutesOf = (block: Pick<DraftBlock, 'start' | 'end'>): { start: number; end: number } | null => {
	const start = parseClock(block.start);
	const end = parseClock(block.end);
	return start === null || end === null || end <= start ? null : { start, end };
};

/** Blocks with usable times, chronological. Invalid blocks (empty or reversed times) are left out. */
export function validRanges(blocks: DraftBlock[]): { start: number; end: number; block: DraftBlock }[] {
	return blocks
		.map((block) => ({ range: minutesOf(block), block }))
		.filter((item): item is { range: { start: number; end: number }; block: DraftBlock } => item.range !== null)
		.map(({ range, block }) => ({ ...range, block }))
		.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Why a block list cannot be saved (the contract's validation), or null. */
export function blocksProblem(blocks: DraftBlock[]): Exclude<DraftProblem, 'break_invalid'> | null {
	if (blocks.length > MAX_BLOCKS) return 'too_many_blocks';
	for (const block of blocks) {
		if (parseClock(block.start) === null || parseClock(block.end) === null) return 'times_required';
		if (block.note.length > MAX_NOTE_LENGTH) return 'note_too_long';
	}
	if (blocks.some((block) => minutesOf(block) === null)) return 'end_before_start';
	const ordered = validRanges(blocks);
	for (let i = 1; i < ordered.length; i++) if (ordered[i].start < ordered[i - 1].end) return 'blocks_overlap';
	return null;
}

/** Why a draft cannot be saved, or null. Rows without a mode and rows with mode off are always valid. */
export function draftProblem(draft: DayDraft): DraftProblem | null {
	if (draft.mode === '' || draft.mode === 'off') return null;
	if (draft.blocks.length === 0) return null; // mode without times is allowed (rough plan)
	const problem = blocksProblem(draft.blocks);
	if (problem) return problem;
	if (!Number.isInteger(draft.breakMinutes) || draft.breakMinutes < 0 || draft.breakMinutes > MAX_BREAK_MINUTES) return 'break_invalid';
	return null;
}

/** Planned seconds of a draft as the server derives them; null without usable times. */
export function plannedSecondsOf(draft: DayDraft): number | null {
	if (draft.mode === '' || draft.mode === 'off') return null;
	const ranges = validRanges(draft.blocks);
	if (ranges.length === 0) return null;
	const total = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
	return Math.max(0, total - Math.max(0, draft.breakMinutes)) * 60;
}

/** First start and last end of the valid blocks, in minutes; null without blocks. */
export function spanOf(draft: DayDraft): { start: number; end: number } | null {
	const ranges = validRanges(draft.blocks);
	return ranges.length === 0 ? null : { start: ranges[0].start, end: ranges[ranges.length - 1].end };
}

/** Minutes of gaps between the blocks plus the legacy break: what the server reports as plannedBreakMinutes. */
export function breakMinutesOf(draft: DayDraft): number {
	const ranges = validRanges(draft.blocks);
	let gaps = 0;
	for (let i = 1; i < ranges.length; i++) gaps += Math.max(0, ranges[i].start - ranges[i - 1].end);
	return gaps + Math.max(0, draft.breakMinutes);
}

/** Day-level mode that goes with a block kind: `work` and `travel` have no day mode of their own and count as office. */
export const modeForKind = (kind: BlockKind): Exclude<PlanMode, 'off'> => (kind === 'work' || kind === 'travel' ? 'office' : kind);

/** Kind of a block that follows a day-level mode (legacy servers have no other kind). */
export const kindForMode = (mode: Exclude<PlanMode, 'off'>): BlockKind => mode;

export function emptyDraft(date: string): DayDraft {
	return { date, mode: '', blocks: [], breakMinutes: 0, note: '', placeId: null };
}

export const newBlock = (start: number, end: number, kind: BlockKind, placeId: string | null = null, note = ''): DraftBlock => ({ start: formatClock(start), end: formatClock(end), kind, placeId, note });

/** One working window with an optional break as blocks: two blocks around a gap in the middle (like the server's legacy conversion), or one block. */
export function blocksFromWindow(start: number, end: number, breakMinutes: number, kind: BlockKind, placeId: string | null = null): DraftBlock[] {
	if (breakMinutes <= 0 || breakMinutes >= end - start - 1) return [newBlock(start, end, kind, placeId)];
	const work = end - start - breakMinutes;
	let split = start + Math.round(work / 2 / 5) * 5;
	if (split <= start || split + breakMinutes >= end) split = start + Math.floor(work / 2);
	return [newBlock(start, split, kind, placeId), newBlock(split + breakMinutes, end, kind, placeId)];
}

/** The blocks the planning hints judge: a legacy window with a break counts as two blocks around a gap. */
export function planHintsOfDay(draft: DayDraft): PlanHint[] {
	if (draft.mode === '' || draft.mode === 'off') return [];
	const span = spanOf(draft);
	const first = validRanges(draft.blocks)[0];
	if (span && draft.breakMinutes > 0 && draft.blocks.length === 1 && first) return planHintsOf(blocksFromWindow(span.start, span.end, draft.breakMinutes, first.block.kind));
	return planHintsOf(draft.blocks);
}

export function draftFromDay(day: PlanWeekDay): DayDraft {
	const plan = day.plan;
	if (!plan) return emptyDraft(day.date);
	const base = { date: day.date, mode: plan.mode, note: plan.note ?? '', placeId: plan.placeId ?? null };
	if (Array.isArray(plan.blocks)) {
		// contract 0.35.0: the block list is the plan, the old window fields are only derived from it
		return { ...base, blocks: plan.blocks.map((b) => ({ start: b.start, end: b.end, kind: b.kind, placeId: b.placeId ?? null, note: b.note ?? '' })), breakMinutes: 0 };
	}
	// older server: the single window becomes one block of the day's mode, the break stays a number
	const blocks = plan.mode !== 'off' && plan.plannedStart && plan.plannedEnd ? [{ start: plan.plannedStart, end: plan.plannedEnd, kind: plan.mode as BlockKind, placeId: plan.placeId ?? null, note: '' }] : [];
	return { ...base, blocks, breakMinutes: blocks.length ? (plan.plannedBreakMinutes ?? 0) : 0 };
}

/**
 * The request entry of a draft; null when nothing is planned. With `multi` (contract 0.35.0) the full block list is
 * sent, otherwise the single window with its break in the old fields.
 */
export function entryFromDraft(draft: DayDraft, multi = true): PlanWeekEntry | null {
	if (draft.mode === '') return null;
	const note = draft.note.trim() || null;
	if (multi) {
		const blocks: PlanTimeBlock[] =
			draft.mode === 'off' ? [] : validRanges(draft.blocks).map(({ block }) => ({ start: block.start, end: block.end, kind: block.kind, placeId: block.placeId, note: block.note.trim() || null }));
		return { date: draft.date, mode: draft.mode, placeId: draft.placeId, note, blocks };
	}
	const entry: PlanWeekEntry = { date: draft.date, mode: draft.mode, placeId: draft.blocks[0]?.placeId ?? draft.placeId, note };
	const span = spanOf(draft);
	if (draft.mode !== 'off' && span) {
		entry.plannedStart = formatClock(span.start);
		entry.plannedEnd = formatClock(span.end);
		entry.plannedBreakMinutes = draft.breakMinutes;
	}
	return entry;
}

export const isBlocked = (day: PlanWeekDay) => day.blockedBy !== null;

/**
 * Non-binding planning hints for a block list; the same rule as the server's `planHints` (profile arbzg-adult-de), so the
 * live draft shows them before saving. Gaps of 15 minutes or more are breaks; school time is not working time.
 */
export function planHintsOf(blocks: DraftBlock[]): PlanHint[] {
	const ranges = validRanges(blocks);
	if (ranges.length === 0) return [];
	let work = 0;
	let breaks = 0;
	let run = 0;
	let longest = 0;
	let shortGap = false;
	let previousEnd: number | null = null;
	for (const { start, end, block } of ranges) {
		if (previousEnd !== null && start > previousEnd) {
			const gap = start - previousEnd;
			if (gap >= 15) {
				breaks += gap;
				longest = Math.max(longest, run);
				run = 0;
			} else shortGap = true;
		}
		if (block.kind !== 'school') {
			work += end - start;
			run += end - start;
		}
		previousEnd = end;
	}
	longest = Math.max(longest, run);
	const hints: PlanHint[] = [];
	const required = work > 540 ? 45 : work > 360 ? 30 : 0;
	if (required > breaks) hints.push('planned_break_short');
	if (longest > 360) hints.push('planned_work_stretch_long');
	if (shortGap) hints.push('planned_break_part_short');
	return hints;
}

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

/** A suggested window as the blocks of a day: with a block list the break becomes a gap, on a legacy server it stays a number. */
export function windowDraftParts(window: { start: string; end: string; breakMinutes: number }, kind: BlockKind, multi: boolean): Pick<DayDraft, 'blocks' | 'breakMinutes'> {
	const start = parseClock(window.start) ?? DEFAULT_START;
	const end = parseClock(window.end) ?? start + 60;
	return multi ? { blocks: blocksFromWindow(start, end, window.breakMinutes, kind), breakMinutes: 0 } : { blocks: [newBlock(start, end, kind)], breakMinutes: window.breakMinutes };
}

/**
 * Changes the day-level mode. Picking a working mode on an empty row prefills the suggested times. With block lists the
 * blocks keep their own kinds; on a legacy server the single block follows the mode.
 */
export function withMode(draft: DayDraft, mode: DraftMode, suggestion: WindowSuggestion, targetSeconds: number, multi = true): DayDraft {
	if (mode === '' || mode === 'off') return { ...draft, mode, blocks: [], breakMinutes: 0 };
	if (draft.blocks.length > 0) return { ...draft, mode, blocks: multi ? draft.blocks : draft.blocks.map((b) => ({ ...b, kind: mode })) };
	const window = windowForDay(suggestion, targetSeconds);
	return { ...draft, mode, ...windowDraftParts(window, kindForMode(mode), multi) };
}

const isWorkday = (day: PlanWeekDay) => day.targetSeconds > 0 && !isBlocked(day);

/** "Standardwoche": office on every workday of the work model with the suggested window, everything else cleared. */
export function standardWeek(days: PlanWeekDay[], current: DayDraft[], suggestion: WindowSuggestion, multi = true): DayDraft[] {
	return current.map((draft, index) => {
		const day = days[index];
		if (isBlocked(day)) return draft;
		if (!isWorkday(day)) return { ...emptyDraft(draft.date), placeId: null };
		const window = windowForDay(suggestion, day.targetSeconds);
		return { ...emptyDraft(draft.date), mode: 'office', ...windowDraftParts(window, 'office', multi) };
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

/** The first planned day is applied to all other workdays (mode, blocks, break); day notes stay as they are. */
export function sameForWorkdays(days: PlanWeekDay[], current: DayDraft[]): DayDraft[] {
	const model = current.find((draft, index) => draft.mode !== '' && !isBlocked(days[index]));
	if (!model) return current;
	return current.map((draft, index) => {
		const day = days[index];
		if (isBlocked(day) || !isWorkday(day)) return draft;
		return { ...draft, mode: model.mode, blocks: model.blocks.map((b) => ({ ...b })), breakMinutes: model.breakMinutes, placeId: model.placeId };
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
export function weekRequest(drafts: DayDraft[], multi = true): { replace: true; days: PlanWeekEntry[] } {
	return { replace: true, days: drafts.map((draft) => entryFromDraft(draft, multi)).filter((entry): entry is PlanWeekEntry => entry !== null) };
}

export const draftsEqual = (a: DayDraft[], b: DayDraft[]) => JSON.stringify(a) === JSON.stringify(b);
