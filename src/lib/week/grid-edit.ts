import type { PlanMode, PlanWeekDay } from '#lib/api/types.js';
import { type BlockKind, type DayDraft, type DraftBlock, emptyDraft, formatClock, kindForMode, MAX_BLOCKS, modeForKind, newBlock, parseClock, validRanges } from './plan-draft.js';
import { clampGroupDelta, LAST_MINUTE, type MinuteRange } from './grid.js';

/**
 * Pure edit operations of the week grid on the draft list (index = weekday, Monday first). Since contract 0.35.0 a day
 * holds several blocks (P13, ADR-0031); a block is addressed by `date#index` into the day's block list. On an older server
 * (`multi` false) a day holds one block, so every placement replaces the day's plan, like before P13. Painting over
 * existing blocks carves them (the new block wins, the rest is trimmed or split). Blocked days (holiday, vacation, sick,
 * excused) take no plan; operations skip them and report it. Nothing here mutates.
 */
export type BrushKind = BlockKind | 'off';

export interface Brush {
	kind: BrushKind;
	placeId: string | null;
	/** Legacy servers only: null = automatic (30 minutes for blocks over six hours). */
	breakMinutes: number | null;
}

/** Identity of one block in the week: day and position in that day's block list. */
export type BlockId = string;
export const blockId = (date: string, index: number): BlockId => `${date}#${index}`;
export function parseBlockId(id: BlockId): { date: string; index: number } {
	const at = id.lastIndexOf('#');
	return { date: id.slice(0, at), index: Number(id.slice(at + 1)) };
}

export interface EditCtx {
	days: PlanWeekDay[];
	/** Block lists (contract 0.35.0) instead of one window per day. */
	multi: boolean;
}

export interface EditResult {
	drafts: DayDraft[];
	/** Dates that changed. */
	touched: string[];
	/** Dates that could not take the change (blocked, outside the week, too many blocks). */
	skipped: string[];
	/** Dates where existing plan content was overwritten or trimmed. */
	replaced: string[];
	/** Ids of the resulting blocks that belong to the change, for the new selection. */
	selection: BlockId[];
}

export interface ClipItem {
	/** Days after the first copied day. */
	offset: number;
	block: DraftBlock;
	/** The day it came from: legacy placement keeps break and note with the block. */
	day: Pick<DayDraft, 'mode' | 'breakMinutes' | 'note' | 'placeId'>;
}
export type Clip = ClipItem[];

const sorted = (blocks: DraftBlock[]): DraftBlock[] => [...blocks].sort((a, b) => (parseClock(a.start) ?? 0) - (parseClock(b.start) ?? 0) || (parseClock(a.end) ?? 0) - (parseClock(b.end) ?? 0));

export const isTimedBlock = (block: DraftBlock): boolean => validRanges([block]).length === 1;

/** The valid blocks of a day with their ids and ranges, in list order. */
export function blocksOf(draft: DayDraft): { id: BlockId; index: number; range: MinuteRange; block: DraftBlock }[] {
	const list: { id: BlockId; index: number; range: MinuteRange; block: DraftBlock }[] = [];
	draft.blocks.forEach((block, index) => {
		const start = parseClock(block.start);
		const end = parseClock(block.end);
		if (start !== null && end !== null && end > start) list.push({ id: blockId(draft.date, index), index, range: { start, end }, block });
	});
	return list;
}

/** Range of the block at an id, or null when it does not exist. */
export function rangeAt(drafts: DayDraft[], id: BlockId): MinuteRange | null {
	const { date, index } = parseBlockId(id);
	const draft = drafts.find((d) => d.date === date);
	return draft ? (blocksOf(draft).find((b) => b.index === index)?.range ?? null) : null;
}

/** Free minutes around a block: where its edges may move without touching a neighbour. */
export function neighbourBounds(drafts: DayDraft[], id: BlockId): MinuteRange {
	const { date, index } = parseBlockId(id);
	const draft = drafts.find((d) => d.date === date);
	let start = 0;
	let end = LAST_MINUTE;
	if (!draft) return { start, end };
	const self = blocksOf(draft).find((b) => b.index === index);
	if (!self) return { start, end };
	for (const other of blocksOf(draft)) {
		if (other.index === index) continue;
		if (other.range.end <= self.range.start) start = Math.max(start, other.range.end);
		else if (other.range.start >= self.range.end) end = Math.min(end, other.range.start);
	}
	return { start, end };
}

/** 30 minutes of break for blocks over six hours (the planner's usual default for legacy servers), otherwise none. */
export const defaultBreak = (range: MinuteRange): number => (range.end - range.start > 360 ? 30 : 0);

const indexOf = (drafts: DayDraft[], date: string) => drafts.findIndex((d) => d.date === date);
const isBlockedAt = (days: PlanWeekDay[], index: number) => index < 0 || index >= days.length || days[index].blockedBy !== null;
const unchanged = (drafts: DayDraft[]): EditResult => ({ drafts, touched: [], skipped: [], replaced: [], selection: [] });
export const hasPlan = (draft: DayDraft) => draft.mode !== '';

/** Id of the block equal to `block` in a day, or null. */
function findId(draft: DayDraft, block: DraftBlock): BlockId | null {
	const index = draft.blocks.findIndex((b) => b.start === block.start && b.end === block.end && b.kind === block.kind);
	return index >= 0 ? blockId(draft.date, index) : null;
}

/**
 * Puts a block into a day; the new block wins over what it overlaps. Returns the new day, whether existing blocks were
 * trimmed or removed, and false when the day would exceed the block limit. On a legacy server the day's plan is replaced.
 */
function place(ctx: EditCtx, target: DayDraft, block: DraftBlock, source?: Pick<DayDraft, 'mode' | 'breakMinutes' | 'note' | 'placeId'>): { draft: DayDraft; replaced: boolean; ok: boolean } {
	if (!ctx.multi) {
		const range = { start: parseClock(block.start) ?? 0, end: parseClock(block.end) ?? 0 };
		const mode = (source?.mode && source.mode !== 'off' ? source.mode : modeForKind(block.kind)) as PlanMode;
		return {
			draft: { ...target, mode, blocks: [{ ...block, kind: mode as BlockKind }], breakMinutes: source ? source.breakMinutes : defaultBreak(range), note: source ? source.note : target.note, placeId: source ? source.placeId : block.placeId },
			replaced: hasPlan(target),
			ok: true
		};
	}
	const start = parseClock(block.start)!;
	const end = parseClock(block.end)!;
	const kept: DraftBlock[] = [];
	let replaced = false;
	for (const existing of target.blocks) {
		const range = validRanges([existing])[0];
		if (!range || range.end <= start || range.start >= end) {
			kept.push(existing);
			continue;
		}
		replaced = true;
		if (range.start < start) kept.push({ ...existing, end: formatClock(start) });
		if (range.end > end) kept.push({ ...existing, start: formatClock(end) });
	}
	const blocks = sorted([...kept, block]);
	if (blocks.length > MAX_BLOCKS) return { draft: target, replaced: false, ok: false };
	const mode = target.mode === '' || target.mode === 'off' ? modeForKind(block.kind) : target.mode;
	return { draft: { ...target, mode, blocks, breakMinutes: 0 }, replaced, ok: true };
}

/** Paints one block per date (the same time range); an `off` brush marks the days as free instead. Skips blocked days. */
export function paintDays(drafts: DayDraft[], ctx: EditCtx, dates: string[], range: MinuteRange, brush: Brush): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const date of dates) {
		const index = indexOf(drafts, date);
		if (isBlockedAt(ctx.days, index)) {
			result.skipped.push(date);
			continue;
		}
		const existing = drafts[index];
		if (brush.kind === 'off') {
			if (hasPlan(existing)) result.replaced.push(date);
			next[index] = { ...emptyDraft(date), mode: 'off', note: existing.note };
			result.touched.push(date);
			continue;
		}
		const block = newBlock(range.start, range.end, brush.kind, brush.placeId);
		// a free day takes the block as a fresh plan; a rough plan without times keeps its mode
		const base = existing.mode === 'off' ? { ...emptyDraft(date), note: existing.note } : existing;
		const placed = place(ctx, base, block);
		if (!placed.ok) {
			result.skipped.push(date);
			continue;
		}
		let draft = placed.draft;
		if (!ctx.multi && brush.breakMinutes !== null) draft = { ...draft, breakMinutes: brush.breakMinutes };
		if (placed.replaced || existing.mode === 'off') result.replaced.push(date);
		next[index] = draft;
		result.touched.push(date);
		const id = findId(draft, ctx.multi ? block : draft.blocks[0]);
		if (id) result.selection.push(id);
	}
	return result;
}

/** Removes blocks; a day without blocks afterwards has no plan any more. Blocked days are skipped. */
export function eraseBlocks(drafts: DayDraft[], ctx: EditCtx, ids: BlockId[]): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	const byDate = new Map<string, Set<number>>();
	for (const id of ids) {
		const { date, index } = parseBlockId(id);
		byDate.set(date, (byDate.get(date) ?? new Set()).add(index));
	}
	for (const [date, indexes] of byDate) {
		const index = indexOf(drafts, date);
		if (index < 0) continue;
		// A blocked day's stored plan is not shown in the grid, so it is not erased either.
		if (isBlockedAt(ctx.days, index)) {
			result.skipped.push(date);
			continue;
		}
		const draft = drafts[index];
		const blocks = draft.blocks.filter((_, i) => !indexes.has(i));
		if (blocks.length === draft.blocks.length) continue;
		next[index] = blocks.length === 0 ? emptyDraft(date) : { ...draft, blocks };
		result.touched.push(date);
	}
	return result;
}

/** Removes the whole plan of the given days (also rough plans without blocks). */
export function eraseDays(drafts: DayDraft[], ctx: EditCtx, dates: string[]): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const date of dates) {
		const index = indexOf(drafts, date);
		if (index < 0) continue;
		if (isBlockedAt(ctx.days, index)) {
			result.skipped.push(date);
			continue;
		}
		if (!hasPlan(drafts[index])) continue;
		next[index] = emptyDraft(date);
		result.touched.push(date);
	}
	return result;
}

/** Replaces the plan of one day with the given draft (list edit, paste of a whole day). */
export function putDraft(drafts: DayDraft[], ctx: EditCtx, draft: DayDraft): EditResult {
	const index = indexOf(drafts, draft.date);
	if (isBlockedAt(ctx.days, index)) return { ...unchanged(drafts), skipped: [draft.date] };
	const next = drafts.slice();
	next[index] = { ...draft, blocks: sorted(draft.blocks) };
	return { drafts: next, touched: [draft.date], skipped: [], replaced: [], selection: [] };
}

/**
 * The dialog result: replaces the block `from` (or adds one when null) by `block` on `date`, optionally moving it to
 * another day, and sets the day-level mode. Overlaps with other blocks are carved like painting; the dialog warns first.
 */
export function replaceBlock(drafts: DayDraft[], ctx: EditCtx, from: BlockId | null, date: string, block: DraftBlock, options: { mode?: PlanMode; breakMinutes?: number; dayNote?: string } = {}): EditResult {
	const targetIndex = indexOf(drafts, date);
	if (isBlockedAt(ctx.days, targetIndex)) return { ...unchanged(drafts), skipped: [date] };
	let working = drafts.slice();
	const touched: string[] = [];
	if (from) {
		const { date: fromDate, index } = parseBlockId(from);
		const fromIndex = indexOf(working, fromDate);
		if (fromIndex >= 0) {
			const blocks = working[fromIndex].blocks.filter((_, i) => i !== index);
			working[fromIndex] = blocks.length === 0 && fromDate !== date ? emptyDraft(fromDate) : { ...working[fromIndex], blocks };
			touched.push(fromDate);
		}
	}
	const base = working[targetIndex];
	const placed = place(ctx, base.mode === 'off' ? { ...base, mode: '' } : base, block);
	if (!placed.ok) return { ...unchanged(drafts), skipped: [date] };
	let draft = placed.draft;
	if (options.mode) draft = { ...draft, mode: options.mode };
	if (!ctx.multi && options.breakMinutes !== undefined) draft = { ...draft, breakMinutes: options.breakMinutes };
	if (options.dayNote !== undefined) draft = { ...draft, note: options.dayNote };
	working = working.slice();
	working[targetIndex] = draft;
	touched.push(date);
	const id = findId(draft, ctx.multi ? block : draft.blocks[0]);
	return { drafts: working, touched: [...new Set(touched)], skipped: [], replaced: placed.replaced ? [date] : [], selection: id ? [id] : [] };
}

/** New times for one block (resize); the caller keeps the range inside the neighbour bounds. */
export function resizeBlock(drafts: DayDraft[], id: BlockId, range: MinuteRange): EditResult {
	const { date, index } = parseBlockId(id);
	const dayIndex = indexOf(drafts, date);
	if (dayIndex < 0 || !blocksOf(drafts[dayIndex]).some((b) => b.index === index)) return unchanged(drafts);
	const next = drafts.slice();
	const blocks = drafts[dayIndex].blocks.map((b, i) => (i === index ? { ...b, start: formatClock(range.start), end: formatClock(range.end) } : b));
	next[dayIndex] = { ...drafts[dayIndex], blocks };
	return { drafts: next, touched: [date], skipped: [], replaced: [], selection: [id] };
}

/**
 * Moves (or copies) blocks by whole days and minutes. All-or-nothing: when one target day is blocked or outside the
 * week, nothing changes. Blocks that are not moved but overlap the new place are trimmed.
 */
export function moveBlocks(drafts: DayDraft[], ctx: EditCtx, ids: BlockId[], deltaDays: number, deltaMinutes: number, copy: boolean): EditResult & { ok: boolean } {
	if (deltaDays === 0 && deltaMinutes === 0) return { ...unchanged(drafts), ok: true };
	const moving: { id: BlockId; date: string; dayIndex: number; index: number; range: MinuteRange; block: DraftBlock }[] = [];
	for (const id of new Set(ids)) {
		const { date, index } = parseBlockId(id);
		const dayIndex = indexOf(drafts, date);
		const entry = dayIndex >= 0 ? blocksOf(drafts[dayIndex]).find((b) => b.index === index) : undefined;
		if (entry) moving.push({ id, date, dayIndex, index, range: entry.range, block: entry.block });
	}
	if (moving.length === 0) return { ...unchanged(drafts), ok: true };
	const skipped = [...new Set(moving.filter((m) => isBlockedAt(ctx.days, m.dayIndex + deltaDays)).map((m) => m.date))];
	if (skipped.length > 0) return { ...unchanged(drafts), skipped, ok: false };
	const shift = clampGroupDelta(moving.map((m) => m.range), deltaMinutes);

	const next = drafts.slice();
	if (!copy) {
		const removed = new Map<number, Set<number>>();
		for (const m of moving) removed.set(m.dayIndex, (removed.get(m.dayIndex) ?? new Set()).add(m.index));
		for (const [dayIndex, indexes] of removed) {
			// keeps the day's mode while it may still receive a block; days left empty are cleared below
			next[dayIndex] = { ...drafts[dayIndex], blocks: drafts[dayIndex].blocks.filter((_, i) => !indexes.has(i)) };
		}
	}
	const touched: string[] = [];
	const replaced: string[] = [];
	const placedBlocks: { dayIndex: number; block: DraftBlock }[] = [];
	for (const m of moving.sort((a, b) => a.dayIndex - b.dayIndex || a.range.start - b.range.start)) {
		const targetIndex = m.dayIndex + deltaDays;
		const moved: DraftBlock = { ...m.block, start: formatClock(m.range.start + shift), end: formatClock(m.range.end + shift) };
		const source = drafts[m.dayIndex];
		const placed = place(ctx, { ...next[targetIndex], date: drafts[targetIndex].date }, moved, ctx.multi ? undefined : { mode: source.mode, breakMinutes: source.breakMinutes, note: source.note, placeId: source.placeId });
		if (!placed.ok) return { ...unchanged(drafts), skipped: [drafts[targetIndex].date], ok: false };
		if (placed.replaced) replaced.push(drafts[targetIndex].date);
		next[targetIndex] = placed.draft;
		touched.push(drafts[targetIndex].date);
		if (!copy && deltaDays !== 0) touched.push(m.date);
		placedBlocks.push({ dayIndex: targetIndex, block: ctx.multi ? moved : placed.draft.blocks[0] });
	}
	if (!copy) next.forEach((draft, i) => { if (draft.mode !== '' && draft.blocks.length === 0 && drafts[i].blocks.length > 0) next[i] = emptyDraft(draft.date); });
	const selection = placedBlocks.map(({ dayIndex, block }) => findId(next[dayIndex], block)).filter((id): id is BlockId => id !== null);
	return { drafts: next, touched: [...new Set(touched)], skipped: [], replaced: [...new Set(replaced)], selection, ok: true };
}

/** Day-level mode of days. `off` clears the blocks. */
export function setModeOn(drafts: DayDraft[], ctx: EditCtx, dates: string[], mode: PlanMode): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const date of dates) {
		const index = indexOf(drafts, date);
		if (isBlockedAt(ctx.days, index)) {
			result.skipped.push(date);
			continue;
		}
		const draft = drafts[index];
		if (!hasPlan(draft) || draft.mode === mode) continue;
		next[index] =
			mode === 'off'
				? { ...draft, mode, blocks: [], breakMinutes: 0 }
				: { ...draft, mode, blocks: ctx.multi ? draft.blocks : draft.blocks.map((b) => ({ ...b, kind: kindForMode(mode) })) };
		result.touched.push(date);
	}
	return result;
}

/** Kind of single blocks. On a legacy server the kind is the day's mode. */
export function setKindOn(drafts: DayDraft[], ctx: EditCtx, ids: BlockId[], kind: BlockKind): EditResult {
	if (!ctx.multi) return { ...setModeOn(drafts, ctx, ids.map((id) => parseBlockId(id).date), modeForKind(kind)), selection: ids };
	const next = drafts.slice();
	const result = unchanged(next);
	for (const id of ids) {
		const { date, index } = parseBlockId(id);
		const dayIndex = indexOf(next, date);
		if (isBlockedAt(ctx.days, dayIndex)) {
			result.skipped.push(date);
			continue;
		}
		const block = next[dayIndex].blocks[index];
		if (!block || block.kind === kind) continue;
		next[dayIndex] = { ...next[dayIndex], blocks: next[dayIndex].blocks.map((b, i) => (i === index ? { ...b, kind } : b)) };
		result.touched.push(date);
		result.selection.push(id);
	}
	return result;
}

/** Legacy servers: the break inside the day's single block. */
export function setBreakOn(drafts: DayDraft[], ids: BlockId[], minutes: number): EditResult {
	const next = drafts.slice();
	const result = unchanged(next);
	for (const id of ids) {
		const { date } = parseBlockId(id);
		const index = indexOf(drafts, date);
		if (index < 0 || drafts[index].blocks.length === 0 || drafts[index].breakMinutes === minutes) continue;
		next[index] = { ...drafts[index], breakMinutes: minutes };
		result.touched.push(date);
	}
	return { ...result, selection: ids };
}

const MIN_PIECE = 5;

/**
 * Splits a block into two at `at`, with an optional gap (a break) of `gapMinutes` starting there. Both pieces keep
 * kind, place and note and must stay at least five minutes long.
 */
export function splitBlock(drafts: DayDraft[], ctx: EditCtx, id: BlockId, at: number, gapMinutes = 0): EditResult {
	if (!ctx.multi) return unchanged(drafts);
	const { date, index } = parseBlockId(id);
	const dayIndex = indexOf(drafts, date);
	if (isBlockedAt(ctx.days, dayIndex)) return { ...unchanged(drafts), skipped: [date] };
	const entry = blocksOf(drafts[dayIndex]).find((b) => b.index === index);
	if (!entry) return unchanged(drafts);
	const { start, end } = entry.range;
	if (at - start < MIN_PIECE || end - (at + gapMinutes) < MIN_PIECE || drafts[dayIndex].blocks.length >= MAX_BLOCKS) return unchanged(drafts);
	const first = { ...entry.block, end: formatClock(at) };
	const second = { ...entry.block, start: formatClock(at + gapMinutes) };
	const blocks = sorted(drafts[dayIndex].blocks.flatMap((b, i) => (i === index ? [first, second] : [b])));
	const next = drafts.slice();
	next[dayIndex] = { ...drafts[dayIndex], blocks };
	const draft = next[dayIndex];
	return { drafts: next, touched: [date], skipped: [], replaced: [], selection: [findId(draft, first), findId(draft, second)].filter((x): x is BlockId => x !== null) };
}

/** A break (gap) in the middle of a block, rounded to five minutes. */
export function breakBlock(drafts: DayDraft[], ctx: EditCtx, id: BlockId, minutes: number): EditResult {
	const range = rangeAt(drafts, id);
	if (!range) return unchanged(drafts);
	const work = range.end - range.start - minutes;
	if (work < 2 * MIN_PIECE) return unchanged(drafts);
	let at = range.start + Math.round(work / 2 / 5) * 5;
	if (at - range.start < MIN_PIECE || range.end - (at + minutes) < MIN_PIECE) at = range.start + Math.floor(work / 2);
	return splitBlock(drafts, ctx, id, at, minutes);
}

/** The block after `id` on its day (by time) when it has the same kind and place, so the gap between them can be closed. */
function mergeable(drafts: DayDraft[], id: BlockId) {
	const { date } = parseBlockId(id);
	const draft = drafts.find((d) => d.date === date);
	if (!draft) return null;
	const list = blocksOf(draft).sort((a, b) => a.range.start - b.range.start);
	const at = list.findIndex((b) => b.id === id);
	const current = list[at];
	const following = list[at + 1];
	if (!current || !following || current.block.kind !== following.block.kind || current.block.placeId !== following.block.placeId) return null;
	return { current, following };
}

export const canMergeWithNext = (drafts: DayDraft[], id: BlockId): boolean => mergeable(drafts, id) !== null;

/** Joins a block with the next block of the day (closing the gap between them) when both have the same kind and place. */
export function mergeWithNext(drafts: DayDraft[], ctx: EditCtx, id: BlockId): EditResult {
	if (!ctx.multi) return unchanged(drafts);
	const { date } = parseBlockId(id);
	const dayIndex = indexOf(drafts, date);
	if (isBlockedAt(ctx.days, dayIndex)) return { ...unchanged(drafts), skipped: [date] };
	const pair = mergeable(drafts, id);
	if (!pair) return unchanged(drafts);
	const { current, following } = pair;
	const joined: DraftBlock = { ...current.block, end: following.block.end, note: current.block.note || following.block.note };
	const blocks = sorted(drafts[dayIndex].blocks.flatMap((b, i) => (i === current.index ? [joined] : i === following.index ? [] : [b])));
	const next = drafts.slice();
	next[dayIndex] = { ...drafts[dayIndex], blocks };
	return { drafts: next, touched: [date], skipped: [], replaced: [], selection: [findId(next[dayIndex], joined)].filter((x): x is BlockId => x !== null) };
}

/** Copies the whole plan of one day (all blocks, break, notes) to the given days; blocked days are skipped. */
export function copyToDates(drafts: DayDraft[], ctx: EditCtx, fromDate: string, targets: string[]): EditResult {
	const source = drafts[indexOf(drafts, fromDate)];
	const next = drafts.slice();
	const result = unchanged(next);
	if (!source || !hasPlan(source)) return result;
	for (const date of targets) {
		if (date === fromDate) continue;
		const index = indexOf(drafts, date);
		if (isBlockedAt(ctx.days, index)) {
			result.skipped.push(date);
			continue;
		}
		if (hasPlan(drafts[index])) result.replaced.push(date);
		next[index] = { ...source, blocks: source.blocks.map((b) => ({ ...b })), date };
		result.touched.push(date);
	}
	return result;
}

/** The clipboard content of the given blocks: relative day offsets, so a paste keeps the shape of the selection. */
export function copyClip(drafts: DayDraft[], ids: BlockId[]): Clip {
	const items = [...new Set(ids)]
		.map((id) => {
			const { date, index } = parseBlockId(id);
			const dayIndex = indexOf(drafts, date);
			const entry = dayIndex >= 0 ? blocksOf(drafts[dayIndex]).find((b) => b.index === index) : undefined;
			return entry ? { dayIndex, entry, draft: drafts[dayIndex] } : null;
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)
		.sort((a, b) => a.dayIndex - b.dayIndex || a.entry.range.start - b.entry.range.start);
	if (items.length === 0) return [];
	const base = items[0].dayIndex;
	return items.map(({ dayIndex, entry, draft }) => ({
		offset: dayIndex - base,
		block: { ...entry.block },
		day: { mode: draft.mode, breakMinutes: draft.breakMinutes, note: draft.note, placeId: draft.placeId }
	}));
}

/** Pastes a clip so that its first day lands on `targetDate`; days outside the week or blocked are skipped. */
export function pasteClip(drafts: DayDraft[], ctx: EditCtx, clip: Clip, targetDate: string): EditResult {
	const base = indexOf(drafts, targetDate);
	const next = drafts.slice();
	const result = unchanged(next);
	if (base < 0) return result;
	for (const item of clip) {
		const index = base + item.offset;
		if (isBlockedAt(ctx.days, index)) {
			result.skipped.push(drafts[index]?.date ?? targetDate);
			continue;
		}
		const placed = place(ctx, { ...next[index] }, { ...item.block }, ctx.multi ? undefined : item.day);
		if (!placed.ok) {
			result.skipped.push(drafts[index].date);
			continue;
		}
		if (placed.replaced) result.replaced.push(drafts[index].date);
		next[index] = placed.draft;
		result.touched.push(drafts[index].date);
		const id = findId(placed.draft, ctx.multi ? item.block : placed.draft.blocks[0]);
		if (id) result.selection.push(id);
	}
	return result;
}

/** Day index of the first day that is not blocked, for default targets. */
export const firstFreeIndex = (days: PlanWeekDay[]) => Math.max(0, days.findIndex((d) => d.blockedBy === null));
