import type { Segment, SegmentKind } from '#lib/api/types.js';
import { localDateOf } from '#lib/time/dates.js';

/** Pure helpers of the cancelled-entries page (P12). */

export interface TrashFilter {
	from: string;
	to: string;
	kind: SegmentKind | 'all';
}

/** Segments inside the filter (local dates, inclusive), newest first. */
export function filterCancelled(segments: Segment[], filter: TrashFilter, timeZone: string): Segment[] {
	return segments
		.filter((s) => s.voided)
		.filter((s) => {
			const day = localDateOf(s.startedAt, timeZone);
			return day >= filter.from && day <= filter.to && (filter.kind === 'all' || s.kind === filter.kind);
		})
		.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** Toggles one id in a selection without mutating it. */
export function toggleId(selected: Set<string>, id: string): Set<string> {
	const next = new Set(selected);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return next;
}

/** All visible ids selected, or none when they already are. */
export function toggleAll(selected: Set<string>, visible: Segment[]): Set<string> {
	return visible.length > 0 && visible.every((s) => selected.has(s.id)) ? new Set() : new Set(visible.map((s) => s.id));
}

/** Server answers that mean "this endpoint does not exist here" (older backend). */
export function isMissingEndpoint(error: unknown): boolean {
	const status = (error as { status?: number } | null)?.status;
	return status === 404 || status === 405 || status === 501;
}

/** The word a user types before everything cancelled is deleted for good. */
export const PURGE_WORD = 'LÖSCHEN';
