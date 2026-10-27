/**
 * Pure geometry of the week time grid (P11): pixel <-> minute conversion, snapping and the ranges produced by
 * painting, moving and resizing. No DOM, no API; the grid component feeds pointer positions in and renders the result.
 * Minutes are minutes since local midnight (0..1439); a plan never crosses midnight (contract: plannedEnd on the same day).
 */
export const SNAP_MINUTES = 15;
export const FINE_MINUTES = 5;
export const FREE_MINUTES = 1;
/** Shortest block the grid creates or resizes to. */
export const MIN_BLOCK_MINUTES = 15;
export const LAST_MINUTE = 23 * 60 + 59;

export interface GridMetrics {
	startHour: number;
	endHour: number;
	/** Pixels per hour. */
	hourHeight: number;
}

export interface MinuteRange {
	start: number;
	end: number;
}

export const DEFAULT_START_HOUR = 5;
export const DEFAULT_END_HOUR = 23;

export const gridHeight = (m: GridMetrics) => (m.endHour - m.startHour) * m.hourHeight;

/** Snap step by modifier keys: Shift = 5 minutes, Ctrl/Cmd = free (1 minute), otherwise 15 minutes. */
export function stepFor(mods: { shift?: boolean; free?: boolean }): number {
	if (mods.free) return FREE_MINUTES;
	if (mods.shift) return FINE_MINUTES;
	return SNAP_MINUTES;
}

export const snap = (minutes: number, step: number) => Math.round(minutes / step) * step;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Minutes for a pixel offset from the top of the grid (unsnapped, may be outside the visible hours). */
export const yToMinutes = (y: number, m: GridMetrics) => m.startHour * 60 + (y / m.hourHeight) * 60;
export const minutesToY = (minutes: number, m: GridMetrics) => ((minutes - m.startHour * 60) / 60) * m.hourHeight;

/** Snapped minutes inside the visible hours (the day's last minute is 23:59, not 24:00). */
export function snappedMinutes(y: number, m: GridMetrics, step: number): number {
	return clamp(snap(yToMinutes(y, m), step), m.startHour * 60, Math.min(m.endHour * 60, LAST_MINUTE));
}

export function blockRect(range: MinuteRange, m: GridMetrics): { top: number; height: number } {
	return { top: minutesToY(range.start, m), height: ((range.end - range.start) / 60) * m.hourHeight };
}

/** Column index (0-based) for an x position; clamped to the existing columns. */
export function columnAt(x: number, left: number, width: number, columns: number): number {
	if (columns <= 0 || width <= 0) return 0;
	return clamp(Math.floor(((x - left) / width) * columns), 0, columns - 1);
}

/** Range painted between two pointer minutes: order does not matter, a click-sized range grows to the minimum. */
export function paintRange(anchor: number, current: number, step: number, bounds: MinuteRange = { start: 0, end: LAST_MINUTE }): MinuteRange {
	let start = Math.min(anchor, current);
	let end = Math.max(anchor, current);
	if (end - start < MIN_BLOCK_MINUTES) end = start + MIN_BLOCK_MINUTES;
	if (end > bounds.end) {
		end = bounds.end;
		start = Math.min(start, end - MIN_BLOCK_MINUTES);
	}
	start = Math.max(start, bounds.start);
	return { start, end };
}

/** A range moved by a delta (snapped to the step); the duration stays, the range stays inside the day. */
export function moveRange(range: MinuteRange, deltaMinutes: number, step: number): MinuteRange {
	const duration = range.end - range.start;
	const start = clamp(range.start + snap(deltaMinutes, step), 0, LAST_MINUTE - duration);
	return { start, end: start + duration };
}

/**
 * One edge dragged to a new minute. The edge stops at the minimum duration instead of flipping, and at `bounds` (the
 * neighbouring blocks of the same day), so resizing never overlaps another block.
 */
export function resizeRange(range: MinuteRange, edge: 'start' | 'end', toMinute: number, step: number, bounds: MinuteRange = { start: 0, end: LAST_MINUTE }): MinuteRange {
	const target = snap(toMinute, step);
	if (edge === 'start') return { start: clamp(target, bounds.start, range.end - MIN_BLOCK_MINUTES), end: range.end };
	return { start: range.start, end: clamp(target, range.start + MIN_BLOCK_MINUTES, bounds.end) };
}

/** Largest minute shift (closest to `delta`) that keeps every range of a group inside the day, so a moved group keeps its shape. */
export function clampGroupDelta(ranges: MinuteRange[], delta: number): number {
	if (ranges.length === 0) return 0;
	const lowest = -Math.min(...ranges.map((r) => r.start));
	const highest = LAST_MINUTE - Math.max(...ranges.map((r) => r.end));
	return clamp(delta, lowest, Math.max(lowest, highest));
}

/** Keyboard nudge of a whole range or one edge. */
export function nudgeRange(range: MinuteRange, part: 'both' | 'start' | 'end', deltaMinutes: number, bounds?: MinuteRange): MinuteRange {
	if (part === 'both') return moveRange(range, deltaMinutes, 1);
	return resizeRange(range, part, (part === 'start' ? range.start : range.end) + deltaMinutes, 1, bounds);
}

export const rangesOverlap = (a: MinuteRange, b: MinuteRange) => a.start < b.end && b.start < a.end;

/** Hours to show: the default window, widened to whole hours around every block. */
export function visibleHours(blocks: MinuteRange[], defaults = { start: DEFAULT_START_HOUR, end: DEFAULT_END_HOUR }): { startHour: number; endHour: number } {
	let startHour = defaults.start;
	let endHour = defaults.end;
	for (const block of blocks) {
		startHour = Math.min(startHour, Math.floor(block.start / 60));
		endHour = Math.max(endHour, Math.ceil(block.end / 60));
	}
	return { startHour: clamp(startHour, 0, 23), endHour: clamp(endHour, startHour + 1, 24) };
}

/** Rectangle between two points, normalised (for the marquee). */
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}
export const boxBetween = (ax: number, ay: number, bx: number, by: number): Box => ({ left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) });
export const boxesIntersect = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Clock text "HH:mm" for minutes. */
export function clock(minutes: number): string {
	const m = clamp(Math.round(minutes), 0, 24 * 60);
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Keyboard nudge step: 15 minutes, Shift = 5. */
export const nudgeStep = (mods: { shift?: boolean }) => (mods.shift ? FINE_MINUTES : SNAP_MINUTES);
