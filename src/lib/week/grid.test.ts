import { describe, expect, it } from 'vitest';
import { blockRect, boxBetween, boxesIntersect, clock, columnAt, FINE_MINUTES, FREE_MINUTES, minutesToY, moveRange, nudgeRange, paintRange, rangesOverlap, resizeRange, SNAP_MINUTES, snap, snappedMinutes, stepFor, visibleHours, yToMinutes } from './grid.js';

const m = { startHour: 5, endHour: 23, hourHeight: 48 };

describe('snapping', () => {
	it('picks the step by modifier', () => {
		expect(stepFor({})).toBe(SNAP_MINUTES);
		expect(stepFor({ shift: true })).toBe(FINE_MINUTES);
		expect(stepFor({ free: true })).toBe(FREE_MINUTES);
		expect(stepFor({ shift: true, free: true })).toBe(FREE_MINUTES);
	});
	it('rounds to the nearest step', () => {
		expect(snap(7 * 60 + 7, 15)).toBe(7 * 60);
		expect(snap(7 * 60 + 8, 15)).toBe(7 * 60 + 15);
		expect(snap(7 * 60 + 8, 5)).toBe(7 * 60 + 10);
	});
	it('converts pixels and minutes both ways and clamps to the visible hours', () => {
		expect(yToMinutes(0, m)).toBe(300);
		expect(yToMinutes(48, m)).toBe(360);
		expect(minutesToY(360, m)).toBe(48);
		expect(snappedMinutes(50, m, 15)).toBe(360);
		expect(snappedMinutes(-200, m, 15)).toBe(300);
		expect(snappedMinutes(99_999, m, 15)).toBe(23 * 60);
	});
	it('computes block rectangles', () => {
		expect(blockRect({ start: 8 * 60, end: 16 * 60 + 30 }, m)).toEqual({ top: 144, height: 408 });
	});
});

describe('columns', () => {
	it('maps x to a clamped column', () => {
		expect(columnAt(10, 0, 700, 7)).toBe(0);
		expect(columnAt(250, 0, 700, 7)).toBe(2);
		expect(columnAt(9999, 0, 700, 7)).toBe(6);
		expect(columnAt(-5, 0, 700, 7)).toBe(0);
		expect(columnAt(150, 100, 100, 1)).toBe(0);
	});
});

describe('painting', () => {
	it('orders the anchors and keeps the minimum length', () => {
		expect(paintRange(600, 540, 15)).toEqual({ start: 540, end: 600 });
		expect(paintRange(600, 600, 15)).toEqual({ start: 600, end: 615 });
		expect(paintRange(600, 605, 5)).toEqual({ start: 600, end: 615 });
	});
	it('stays inside the day', () => {
		const r = paintRange(23 * 60 + 55, 23 * 60 + 55, 15);
		expect(r.end).toBeLessThanOrEqual(23 * 60 + 59);
		expect(r.end - r.start).toBeGreaterThanOrEqual(15);
		expect(paintRange(-30, 20, 15).start).toBe(0);
	});
});

describe('moving and resizing', () => {
	it('moves by snapped delta and keeps the duration', () => {
		expect(moveRange({ start: 480, end: 960 }, 62, 15)).toEqual({ start: 540, end: 1020 });
		expect(moveRange({ start: 480, end: 960 }, 62, 1)).toEqual({ start: 542, end: 1022 });
	});
	it('clamps a move to the day', () => {
		expect(moveRange({ start: 60, end: 120 }, -500, 15)).toEqual({ start: 0, end: 60 });
		const late = moveRange({ start: 1200, end: 1380 }, 600, 15);
		expect(late.end).toBe(23 * 60 + 59);
		expect(late.end - late.start).toBe(180);
	});
	it('resizes one edge but never below the minimum', () => {
		expect(resizeRange({ start: 480, end: 960 }, 'end', 1000, 15)).toEqual({ start: 480, end: 1005 });
		expect(resizeRange({ start: 480, end: 960 }, 'end', 400, 15)).toEqual({ start: 480, end: 495 });
		expect(resizeRange({ start: 480, end: 960 }, 'start', 950, 15)).toEqual({ start: 945, end: 960 });
		expect(resizeRange({ start: 480, end: 960 }, 'start', -10, 15)).toEqual({ start: 0, end: 960 });
	});
	it('nudges by keyboard', () => {
		expect(nudgeRange({ start: 480, end: 960 }, 'both', 15)).toEqual({ start: 495, end: 975 });
		expect(nudgeRange({ start: 480, end: 960 }, 'end', -15)).toEqual({ start: 480, end: 945 });
		expect(nudgeRange({ start: 480, end: 960 }, 'start', 5)).toEqual({ start: 485, end: 960 });
	});
});

describe('overlap, hours, boxes', () => {
	it('detects overlap but not touching ranges', () => {
		expect(rangesOverlap({ start: 0, end: 60 }, { start: 30, end: 90 })).toBe(true);
		expect(rangesOverlap({ start: 0, end: 60 }, { start: 60, end: 90 })).toBe(false);
	});
	it('widens the visible hours around blocks', () => {
		expect(visibleHours([])).toEqual({ startHour: 5, endHour: 23 });
		expect(visibleHours([{ start: 3 * 60 + 30, end: 23 * 60 + 15 }])).toEqual({ startHour: 3, endHour: 24 });
	});
	it('intersects marquee boxes', () => {
		const a = boxBetween(50, 80, 10, 20);
		expect(a).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
		expect(boxesIntersect(a, boxBetween(40, 70, 90, 90))).toBe(true);
		expect(boxesIntersect(a, boxBetween(60, 70, 90, 90))).toBe(false);
	});
	it('formats clock text', () => {
		expect(clock(8 * 60 + 5)).toBe('08:05');
		expect(clock(24 * 60)).toBe('24:00');
	});
});
