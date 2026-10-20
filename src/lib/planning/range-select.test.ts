import { describe, expect, it } from 'vitest';
import { addRange, dayDiff, emptySelection, moveCursor, normalizeRange, rangeContains, rangeDates, rangeLength, selectionBounds, selectionRuns, selectOne, selectRangeTo, shiftRange, toggleDate } from './range-select.js';

describe('ranges', () => {
	it('orders a range regardless of direction', () => {
		expect(normalizeRange('2031-03-14', '2031-03-10')).toEqual({ start: '2031-03-10', end: '2031-03-14' });
		expect(normalizeRange('2031-03-10', '2031-03-10')).toEqual({ start: '2031-03-10', end: '2031-03-10' });
	});
	it('counts and lists days across month and year boundaries', () => {
		expect(rangeLength({ start: '2030-12-30', end: '2031-01-02' })).toBe(4);
		expect(rangeDates({ start: '2030-12-30', end: '2031-01-02' })).toEqual(['2030-12-30', '2030-12-31', '2031-01-01', '2031-01-02']);
		expect(rangeContains({ start: '2031-03-10', end: '2031-03-12' }, '2031-03-12')).toBe(true);
		expect(rangeContains({ start: '2031-03-10', end: '2031-03-12' }, '2031-03-13')).toBe(false);
	});
	it('shifts and measures in whole days', () => {
		expect(shiftRange({ start: '2031-03-10', end: '2031-03-12' }, -11)).toEqual({ start: '2031-02-27', end: '2031-03-01' });
		expect(dayDiff('2031-03-10', '2031-03-07')).toBe(-3);
	});
});

describe('selection', () => {
	it('selects one day and extends with shift from the anchor in both directions', () => {
		const one = selectOne('2031-03-12');
		expect(selectRangeTo(one, '2031-03-14').dates).toEqual(['2031-03-12', '2031-03-13', '2031-03-14']);
		expect(selectRangeTo(one, '2031-03-10')).toEqual({ dates: ['2031-03-10', '2031-03-11', '2031-03-12'], anchor: '2031-03-12' });
		expect(selectRangeTo(emptySelection, '2031-03-10').dates).toEqual(['2031-03-10']);
	});
	it('toggles single days and keeps the list sorted', () => {
		let s = selectOne('2031-03-12');
		s = toggleDate(s, '2031-03-10');
		expect(s.dates).toEqual(['2031-03-10', '2031-03-12']);
		s = toggleDate(s, '2031-03-12');
		expect(s.dates).toEqual(['2031-03-10']);
		s = toggleDate(s, '2031-03-10');
		expect(s).toEqual({ dates: [], anchor: null });
	});
	it('adds a dragged range to an existing selection without duplicates', () => {
		const s = addRange(selectOne('2031-03-11'), { start: '2031-03-10', end: '2031-03-12' });
		expect(s.dates).toEqual(['2031-03-10', '2031-03-11', '2031-03-12']);
	});
	it('splits a selection into contiguous runs and reports its bounds', () => {
		const dates = ['2031-03-14', '2031-03-10', '2031-03-11', '2031-03-12', '2031-03-12'];
		expect(selectionRuns(dates)).toEqual([
			{ start: '2031-03-10', end: '2031-03-12' },
			{ start: '2031-03-14', end: '2031-03-14' }
		]);
		expect(selectionBounds(dates)).toEqual({ start: '2031-03-10', end: '2031-03-14' });
		expect(selectionBounds([])).toBeNull();
		expect(selectionRuns([])).toEqual([]);
	});
});

describe('keyboard cursor', () => {
	it('moves by day and week', () => {
		expect(moveCursor('2031-03-10', 'left')).toBe('2031-03-09');
		expect(moveCursor('2031-03-10', 'down')).toBe('2031-03-17');
		expect(moveCursor('2031-03-10', 'up')).toBe('2031-03-03');
	});
	it('jumps to the Monday and Sunday of the week', () => {
		expect(moveCursor('2031-03-12', 'week-start')).toBe('2031-03-10');
		expect(moveCursor('2031-03-12', 'week-end')).toBe('2031-03-16');
		expect(moveCursor('2031-03-16', 'week-start')).toBe('2031-03-10');
		expect(moveCursor('2031-03-10', 'week-end')).toBe('2031-03-16');
	});
	it('pages by month and clamps the day', () => {
		expect(moveCursor('2031-03-31', 'page-down')).toBe('2031-04-30');
		expect(moveCursor('2031-03-31', 'page-up')).toBe('2031-02-28');
		expect(moveCursor('2031-01-15', 'page-up')).toBe('2030-12-15');
		expect(moveCursor('2030-12-15', 'page-down')).toBe('2031-01-15');
	});
});
