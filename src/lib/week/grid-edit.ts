import type { PlanMode, PlanWeekDay } from '#lib/api/types.js';
import { formatClock, parseClock, type DayDraft, emptyDraft } from './plan-draft.js';
import { type MinuteRange, moveRange } from './grid.js';

/**
 * Pure edit operations of the week grid on the draft list (index = weekday, Monday first). The server stores one plan
 * per day (mode, start, end, break), so a "block" is that day's plan: painting on an occupied day replaces it. Blocked
 * days (holiday, vacation, sick, excused) take no plan; operations skip them and report it. Nothing here mutates.
 */
export type BlockMode = Exclude<PlanMode, 'off'>;

export interface Brush {
	mode: PlanMode;
	placeId: string | null;
	/** null = automatic (30 minutes for blocks over six hours) */
	breakMinutes: number | null;
}

export interface EditResult {
	drafts: DayDraft[];
	/** Dates that changed. */
	touched: string[];
	/** Dates that could not take the change (blocked or outside the week). */
	skipped: string[];
	/** Dates where an existing plan was overwritten. */
	replaced: string[];
}

export interface ClipItem {
	/** Days after the first copied day. */
	offset: number;
	draft: Omit<DayDraft, 'date'>;
}
export type Clip = ClipItem[];

export const isTimedBlock = (draft: DayDraft): boolean => draft.mode !== '' && draft.mode !== 'off' && parseClock(draft.start) !== null && parseClock(draft.end) !== null && parseClock(draft.end)! > parseClock(draft.start)!;

/** Range of a block, or null for unplanned days, "off" and plans without times. */
export function rangeOf(draft: DayDraft): MinuteRange | null {
	if (!isTimedBlock(draft)) return null;
	return { start: parseClock(draft.start)!, end: parseClock(draft.end)! };
}

/** 30 minutes of break for blocks over six hours (the planner's usual default), otherwise none. */
export const defaultBreak = (range: MinuteRange): number => (range.end - range.start > 360 ? 30 : 0);

const indexOf = (drafts: DayDraft[], date: string) => drafts.findIndex((d) => d.date === date);
const isBlockedAt = (days: PlanWeekDay[], index: number) => index < 0 || index >= days.length || days[index].blockedBy !== null;
const unchanged = (drafts: DayDraft[]): EditResult => ({ drafts, touched: [], skipped: [], replaced: [] });
const hasPlan = (draft: DayDraft) => draft.mode !== '';

function withRange(draft: DayDraft, range: MinuteRange): DayDraft {
	return { ...draft, start: formatClock(range.start), end: formatClock(range.end) };
}

/** Paints one block per date (the same time range); skips blocked days. */
export function paintDays(drafts: DayDraft[], days: PlanWeekDay[], dates: string[], range: MinuteRange, brush: Brush): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const date of dates) {
		const index = indexOf(drafts, date);
		if (isBlockedAt(days, index)) {
			result.skipped.push(date);
			continue;
		}
		const existing = drafts[index];
		if (hasPlan(existing)) result.replaced.push(date);
		next[index] = {
			...emptyDraft(date),
			mode: brush.mode,
			placeId: brush.placeId,
			note: existing.note,
			...(brush.mode === 'off' ? {} : { start: formatClock(range.start), end: formatClock(range.end), breakMinutes: brush.breakMinutes ?? defaultBreak(range) })
		};
		result.touched.push(date);
	}
	return result;
}

export function eraseDays(drafts: DayDraft[], days: PlanWeekDay[], dates: string[]): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const date of dates) {
		const index = indexOf(drafts, date);
		if (index < 0) continue;
		// A blocked day's stored plan is not shown in the grid, so it is not erased either.
		if (isBlockedAt(days, index)) {
			result.skipped.push(date);
			continue;
		}
		if (!hasPlan(drafts[index])) continue;
		next[index] = emptyDraft(date);
		result.touched.push(date);
	}
	return result;
}

/** Replaces the plan of one day with the given draft (dialog result, paste). */
export function putDraft(drafts: DayDraft[], days: PlanWeekDay[], draft: DayDraft): EditResult {
	const index = indexOf(drafts, draft.date);
	if (isBlockedAt(days, index)) return { ...unchanged(drafts), skipped: [draft.date] };
	const next = drafts.slice();
	next[index] = draft;
	return { drafts: next, touched: [draft.date], skipped: [], replaced: [] };
}

export function resizeBlock(drafts: DayDraft[], date: string, range: MinuteRange): EditResult {
	const index = indexOf(drafts, date);
	if (index < 0 || !isTimedBlock(drafts[index])) return unchanged(drafts);
	const next = drafts.slice();
	next[index] = withRange(drafts[index], range);
	return { drafts: next, touched: [date], skipped: [], replaced: [] };
}

/**
 * Moves (or copies) the blocks of `sources` by whole days and minutes. All-or-nothing: when one target day is blocked or
 * outside the week, nothing changes. Target days occupied by blocks that do not move themselves are overwritten.
 */
export function moveBlocks(drafts: DayDraft[], days: PlanWeekDay[], sources: string[], deltaDays: number, deltaMinutes: number, copy: boolean): EditResult & { ok: boolean } {
	if (deltaDays === 0 && deltaMinutes === 0) return { ...unchanged(drafts), ok: true };
	const moving = sources.map((date) => indexOf(drafts, date)).filter((i) => i >= 0 && hasPlan(drafts[i]));
	const skipped: string[] = [];
	for (const i of moving) if (isBlockedAt(days, i + deltaDays)) skipped.push(drafts[i].date);
	if (skipped.length > 0) return { ...unchanged(drafts), skipped, ok: false };
	const next = drafts.slice();
	if (!copy) for (const i of moving) next[i] = emptyDraft(drafts[i].date);
	const touched: string[] = [];
	const replaced: string[] = [];
	for (const i of moving) {
		const target = i + deltaDays;
		const source = drafts[i];
		const range = rangeOf(source);
		const shifted = range ? withRange(source, moveRange(range, deltaMinutes, 1)) : source;
		const occupant = next[target];
		if (hasPlan(occupant)) replaced.push(occupant.date);
		next[target] = { ...shifted, date: drafts[target].date };
		touched.push(drafts[target].date);
		if (!copy && target !== i) touched.push(source.date);
	}
	return { drafts: next, touched: [...new Set(touched)], skipped: [], replaced: [...new Set(replaced)], ok: true };
}

export function setModeOn(drafts: DayDraft[], days: PlanWeekDay[], dates: string[], mode: PlanMode): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const date of dates) {
		const index = indexOf(drafts, date);
		if (isBlockedAt(days, index)) {
			result.skipped.push(date);
			continue;
		}
		const draft = drafts[index];
		if (!hasPlan(draft) || draft.mode === mode) continue;
		next[index] = mode === 'off' ? { ...draft, mode, start: '', end: '', breakMinutes: 0 } : { ...draft, mode };
		result.touched.push(date);
	}
	return result;
}

export function setBreakOn(drafts: DayDraft[], dates: string[], minutes: number): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const date of dates) {
		const index = indexOf(drafts, date);
		if (index < 0 || !isTimedBlock(drafts[index]) || drafts[index].breakMinutes === minutes) continue;
		next[index] = { ...drafts[index], breakMinutes: minutes };
		result.touched.push(date);
	}
	return result;
}

export function copyToDates(drafts: DayDraft[], days: PlanWeekDay[], fromDate: string, targets: string[]): EditResult {
	const source = drafts[indexOf(drafts, fromDate)];
	const next = drafts.slice();
	const result = unchanged(next);
	if (!source || !hasPlan(source)) return result;
	for (const date of targets) {
		if (date === fromDate) continue;
		const index = indexOf(drafts, date);
		if (isBlockedAt(days, index)) {
			result.skipped.push(date);
			continue;
		}
		if (hasPlan(drafts[index])) result.replaced.push(date);
		next[index] = { ...source, date };
		result.touched.push(date);
	}
	return result;
}

/** The clipboard content of the given days: relative day offsets, so a paste keeps the shape of the selection. */
export function copyClip(drafts: DayDraft[], dates: string[]): Clip {
	const items = dates
		.map((date) => ({ index: indexOf(drafts, date), date }))
		.filter(({ index }) => index >= 0 && hasPlan(drafts[index]))
		.sort((a, b) => a.index - b.index);
	if (items.length === 0) return [];
	const base = items[0].index;
	return items.map(({ index }) => {
		const { date: _date, ...rest } = drafts[index];
		return { offset: index - base, draft: rest };
	});
}

/** Pastes a clip so that its first day lands on `targetDate`; days outside the week or blocked are skipped. */
export function pasteClip(drafts: DayDraft[], days: PlanWeekDay[], clip: Clip, targetDate: string): EditResult {
	const base = indexOf(drafts, targetDate);
	const next = drafts.slice();
	const result = unchanged(next);
	if (base < 0) return result;
	for (const item of clip) {
		const index = base + item.offset;
		if (isBlockedAt(days, index)) {
			result.skipped.push(drafts[index]?.date ?? targetDate);
			continue;
		}
		if (hasPlan(drafts[index])) result.replaced.push(drafts[index].date);
		next[index] = { ...item.draft, date: drafts[index].date };
		result.touched.push(drafts[index].date);
	}
	return result;
}

/** Day index of the first day that is not blocked, for default targets. */
export const firstFreeIndex = (days: PlanWeekDay[]) => Math.max(0, days.findIndex((d) => d.blockedBy === null));
