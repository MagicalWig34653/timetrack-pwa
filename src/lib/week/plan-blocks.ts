import type { PlanBlockKind, PlanTimeBlock } from '#lib/api/types.js';
import { blockKindLabel } from '#lib/planning/labels.js';

/** Minimal block shape: share views carry start, end and kind only. */
export type ShownBlock = Pick<PlanTimeBlock, 'start' | 'end' | 'kind'>;

/** "08:00–12:00" */
export const blockTimes = (block: Pick<PlanTimeBlock, 'start' | 'end'>) => `${block.start}–${block.end}`;

/** "Schule 08:00–12:00, Arbeit 13:00–17:00": one entry per block, chronological, in the order the cards show them. */
export function blocksText(blocks: ShownBlock[]): string {
	return [...blocks]
		.sort((a, b) => a.start.localeCompare(b.start))
		.map((block) => `${blockKindLabel(block.kind)} ${blockTimes(block)}`)
		.join(', ');
}

/** Only the times: "08:00–12:00, 13:00–17:00". */
export const blocksTimesText = (blocks: ShownBlock[]) =>
	[...blocks]
		.sort((a, b) => a.start.localeCompare(b.start))
		.map(blockTimes)
		.join(', ');

/** Minutes between the blocks of a day (the planned breaks), counting every gap. */
export function gapMinutes(blocks: ShownBlock[]): number {
	const ordered = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
	const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
	let gaps = 0;
	for (let i = 1; i < ordered.length; i++) gaps += Math.max(0, minutes(ordered[i].start) - minutes(ordered[i - 1].end));
	return gaps;
}

export const KIND_ORDER: PlanBlockKind[] = ['work', 'school', 'travel', 'office', 'home', 'customer'];

/**
 * True when a day's blocks are worth listing one by one: different kinds, or more than two blocks. Two blocks of one kind
 * around a gap are just a working window with a break and read better as one span.
 */
export const listsBlocks = (blocks: ShownBlock[] | null | undefined): boolean => !!blocks && (blocks.length > 2 || (blocks.length === 2 && blocks[0].kind !== blocks[1].kind));
