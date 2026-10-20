import { describe, expect, it } from 'vitest';
import { beginMove, beginResize, beginSelect, dragTo, exceedsThreshold, isNoop, previewRange } from './drag.js';

const origin = { start: '2031-03-11', end: '2031-03-13' };

describe('drag preview', () => {
	it('selects forwards and backwards from the anchor', () => {
		expect(previewRange(dragTo(beginSelect('2031-03-12'), '2031-03-14'))).toEqual({ start: '2031-03-12', end: '2031-03-14' });
		expect(previewRange(dragTo(beginSelect('2031-03-12'), '2031-03-10'))).toEqual({ start: '2031-03-10', end: '2031-03-12' });
		expect(previewRange(beginSelect('2031-03-12'))).toEqual({ start: '2031-03-12', end: '2031-03-12' });
	});
	it('moves by the offset between grab and pointer, whichever day of the block was grabbed', () => {
		const op = dragTo(beginMove('a', origin, '2031-03-12'), '2031-03-19');
		expect(previewRange(op)).toEqual({ start: '2031-03-18', end: '2031-03-20' });
		expect(previewRange(dragTo(beginMove('a', origin, '2031-03-13'), '2031-03-10'))).toEqual({ start: '2031-03-08', end: '2031-03-10' });
	});
	it('resizes at the start and end edge', () => {
		expect(previewRange(dragTo(beginResize('a', 'end', origin), '2031-03-16'))).toEqual({ start: '2031-03-11', end: '2031-03-16' });
		expect(previewRange(dragTo(beginResize('a', 'start', origin), '2031-03-08'))).toEqual({ start: '2031-03-08', end: '2031-03-13' });
	});
	it('flips instead of inverting when an edge passes the fixed edge', () => {
		expect(previewRange(dragTo(beginResize('a', 'end', origin), '2031-03-09'))).toEqual({ start: '2031-03-09', end: '2031-03-11' });
		expect(previewRange(dragTo(beginResize('a', 'start', origin), '2031-03-20'))).toEqual({ start: '2031-03-13', end: '2031-03-20' });
	});
	it('reports a drop at the origin as no-op', () => {
		expect(isNoop(beginMove('a', origin, '2031-03-12'))).toBe(true);
		expect(isNoop(dragTo(beginMove('a', origin, '2031-03-12'), '2031-03-13'))).toBe(false);
		expect(isNoop(beginResize('a', 'end', origin))).toBe(true);
		expect(isNoop(beginSelect('2031-03-12'))).toBe(false);
	});
	it('needs a few pixels of travel before a press becomes a drag', () => {
		expect(exceedsThreshold(2, 2)).toBe(false);
		expect(exceedsThreshold(4, 4)).toBe(true);
	});
});
