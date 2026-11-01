// Mock of the plan block rules of contract 0.35.0 (package P13, ADR-0031), written after the backend's PlanTimes and
// PlanService.validate so the mock rejects and derives exactly what the real server does. Kept independent of the PWA's own
// copy of the hint rule (src/lib/week/plan-draft.ts), so a test can compare the two.
import type { PlanBlockKind, PlanHint, PlanTimeBlock } from '../src/lib/api/types.ts';

export const BLOCK_KINDS: PlanBlockKind[] = ['work', 'school', 'travel', 'office', 'home', 'customer'];
export const MAX_BLOCKS = 32;

/** Strict "HH:mm", 00:00 to 23:59; null otherwise. */
export function clockMinutes(value: unknown): number | null {
	const match = typeof value === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null;
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export const formatClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function blockSeconds(blocks: PlanTimeBlock[]): number | null {
	if (blocks.length === 0) return null;
	let total = 0;
	for (const block of blocks) {
		const start = clockMinutes(block.start);
		const end = clockMinutes(block.end);
		if (start === null || end === null || end <= start) return null;
		total += (end - start) * 60;
	}
	return total;
}

/** planned_break_short / planned_work_stretch_long / planned_break_part_short for the adult profile; gaps of 15 minutes or more are breaks, school is no work. */
export function planHints(blocks: PlanTimeBlock[]): PlanHint[] {
	if (blocks.length === 0) return [];
	let work = 0;
	let breaks = 0;
	let run = 0;
	let longest = 0;
	let shortGap = false;
	let previousEnd: number | null = null;
	for (const block of blocks) {
		const start = clockMinutes(block.start);
		const end = clockMinutes(block.end);
		if (start === null || end === null) return [];
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

/** The server's conversion of an old window write into blocks: one block, or two around a gap in the middle. */
export function legacyBlocks(start: string | null, end: string | null, breakMinutes: number | null, kind: PlanBlockKind, placeId: string | null, note: string | null): PlanTimeBlock[] {
	const from = clockMinutes(start);
	const to = clockMinutes(end);
	if (kind === ('off' as string) || from === null || to === null || to <= from) return [];
	const gap = breakMinutes ?? 0;
	const first: PlanTimeBlock = { start: start!, end: end!, kind, placeId, note };
	if (gap <= 0) return [first];
	if (!(gap < to - from - 1)) return [];
	const work = to - from - gap;
	const split = from + Math.floor(work / 2);
	return [
		{ start: start!, end: formatClock(split), kind, placeId, note },
		{ start: formatClock(split + gap), end: end!, kind, placeId, note }
	];
}

export type BlockValidation = { blocks: PlanTimeBlock[]; start: string | null; end: string | null; breakMinutes: number | null } | { error: string };

/** Validation of a supplied block list in the backend's order: count and off, then per block time, kind, note, overlap. */
export function validateBlocks(mode: string, supplied: unknown): BlockValidation {
	if (!Array.isArray(supplied)) return { error: 'bad_request' };
	if (supplied.length > MAX_BLOCKS || (mode === 'off' && supplied.length > 0)) return { error: 'plan_blocks_invalid' };
	let previousEnd = -1;
	let gaps = 0;
	const blocks: PlanTimeBlock[] = [];
	for (const raw of supplied) {
		const start = clockMinutes(raw?.start);
		const end = clockMinutes(raw?.end);
		if (start === null || end === null || start >= end) return { error: 'plan_time_invalid' };
		if (!BLOCK_KINDS.includes(raw.kind)) return { error: 'plan_kind_invalid' };
		if (raw.note != null && (typeof raw.note !== 'string' || raw.note.length > 200)) return { error: 'plan_note_invalid' };
		if (start < previousEnd) return { error: 'plan_blocks_overlap' };
		if (previousEnd >= 0) gaps += start - previousEnd;
		previousEnd = end;
		blocks.push({ start: raw.start, end: raw.end, kind: raw.kind, placeId: raw.placeId ?? null, note: raw.note ?? null });
	}
	return { blocks, start: blocks[0]?.start ?? null, end: blocks[blocks.length - 1]?.end ?? null, breakMinutes: blocks.length === 0 ? null : gaps };
}
