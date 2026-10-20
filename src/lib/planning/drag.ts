import { dayDiff, normalizeRange, shiftRange, type DateRange } from './range-select.js';

/**
 * Pure model of a calendar drag. The UI feeds pointer positions as dates; this module decides which range the
 * gesture would produce. Nothing here touches the DOM or the API.
 */
export type DragOp =
	| { type: 'select'; anchor: string; current: string }
	| { type: 'move'; id: string; origin: DateRange; grab: string; current: string }
	| { type: 'resize'; id: string; edge: 'start' | 'end'; origin: DateRange; current: string };

/** Pointer travel (in px) before a press counts as a drag, so plain clicks stay clicks. */
export const DRAG_THRESHOLD_PX = 5;

export const exceedsThreshold = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;

/** The range a gesture currently shows (ghost preview) and would commit. */
export function previewRange(op: DragOp): DateRange {
	switch (op.type) {
		case 'select':
			return normalizeRange(op.anchor, op.current);
		case 'move':
			return shiftRange(op.origin, dayDiff(op.grab, op.current));
		case 'resize':
			// The dragged edge may pass the fixed edge: the range then flips instead of becoming invalid.
			return op.edge === 'start' ? normalizeRange(op.current, op.origin.end) : normalizeRange(op.origin.start, op.current);
	}
}

/** Updates the pointer date of an ongoing gesture. */
export function dragTo(op: DragOp, date: string): DragOp {
	return { ...op, current: date };
}

/** True when committing would change nothing (dropped where it started). */
export function isNoop(op: DragOp): boolean {
	if (op.type === 'select') return false;
	const next = previewRange(op);
	return next.start === op.origin.start && next.end === op.origin.end;
}

export const beginSelect = (date: string): DragOp => ({ type: 'select', anchor: date, current: date });
export const beginMove = (id: string, origin: DateRange, grab: string): DragOp => ({ type: 'move', id, origin, grab, current: grab });
export const beginResize = (id: string, edge: 'start' | 'end', origin: DateRange): DragOp => ({ type: 'resize', id, edge, origin, current: edge === 'start' ? origin.start : origin.end });
