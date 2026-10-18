import { describe, expect, it } from 'vitest';
import type { VacationSuggestion } from '#lib/api/types.js';
import {
	DEFAULT_MIN_EFFICIENCY,
	FILTER_STORAGE_KEY,
	defaultFilters,
	filtersValid,
	formatDays,
	formatFactor,
	loadFilters,
	rangeValid,
	saveFilters,
	timelineCells,
	vacationBlocks,
	visibleSuggestions
} from './planner.js';

function suggestion(partial: Partial<VacationSuggestion>): VacationSuggestion {
	return {
		id: 'a1b2c3d4e5f60718',
		kind: 'bridge',
		start: '2026-05-14',
		end: '2026-05-17',
		vacationDates: ['2026-05-15'],
		vacationDaysNeeded: 1,
		totalDaysOff: 4,
		efficiency: 4,
		holidays: [{ date: '2026-05-14', name: 'Christi Himmelfahrt' }],
		schoolHolidays: [],
		conflicts: [],
		fitsBudget: true,
		remainingAfter: 26,
		...partial
	};
}

const memory = (initial: Record<string, string> = {}) => {
	const store = { ...initial };
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => void (store[key] = value),
		removeItem: (key: string) => void delete store[key],
		store
	};
};

describe('filters', () => {
	it('defaults to today until the end of next year with the efficiency threshold 2', () => {
		expect(defaultFilters('2026-10-19')).toEqual({ from: '2026-10-19', to: '2027-12-31', maxVacationDays: 10, minDaysOff: 4, minEfficiency: DEFAULT_MIN_EFFICIENCY, count: 10 });
		expect(DEFAULT_MIN_EFFICIENCY).toBe(2);
	});

	it('accepts at most 18 months and rejects reversed or invalid ranges', () => {
		expect(rangeValid('2026-10-19', '2027-12-31')).toBe(true);
		expect(rangeValid('2026-01-01', '2027-07-01')).toBe(true);
		expect(rangeValid('2026-01-01', '2027-07-02')).toBe(false);
		expect(rangeValid('2026-10-19', '2026-10-18')).toBe(false);
		expect(rangeValid('', '2026-10-18')).toBe(false);
		expect(rangeValid('2026-01-31', '2027-07-31')).toBe(true);
	});

	it('validates the numeric fields', () => {
		const ok = defaultFilters('2026-10-19');
		expect(filtersValid(ok)).toBe(true);
		expect(filtersValid({ ...ok, maxVacationDays: 0 })).toBe(false);
		expect(filtersValid({ ...ok, maxVacationDays: 61 })).toBe(false);
		expect(filtersValid({ ...ok, count: 101 })).toBe(false);
		expect(filtersValid({ ...ok, minDaysOff: 2.5 })).toBe(false);
		expect(filtersValid({ ...ok, minEfficiency: Number.NaN })).toBe(false);
	});

	it('remembers the filters per viewer and survives broken or missing storage', () => {
		const storage = memory();
		const filters = { ...defaultFilters('2026-10-19'), maxVacationDays: 6, minEfficiency: 1.5, count: 5 };
		saveFilters(filters, storage);
		expect(loadFilters('2026-10-19', storage)).toEqual(filters);

		expect(loadFilters('2026-10-19', memory({ [FILTER_STORAGE_KEY]: '{not json' }))).toEqual(defaultFilters('2026-10-19'));
		expect(loadFilters('2026-10-19', memory({ [FILTER_STORAGE_KEY]: JSON.stringify({ maxVacationDays: 'x' }) }))).toEqual(defaultFilters('2026-10-19'));
		expect(loadFilters('2026-10-19', null)).toEqual(defaultFilters('2026-10-19'));

		const throwing = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		expect(loadFilters('2026-10-19', throwing)).toEqual(defaultFilters('2026-10-19'));
		expect(() => saveFilters(filters, throwing)).not.toThrow();
	});

	it('drops a remembered range that already ended and moves a past start to today', () => {
		const old = { ...defaultFilters('2024-01-01'), maxVacationDays: 7 };
		const loaded = loadFilters('2026-10-19', memory({ [FILTER_STORAGE_KEY]: JSON.stringify(old) }));
		expect(loaded).toMatchObject({ from: '2026-10-19', to: '2027-12-31', maxVacationDays: 7 });
		const running = { ...defaultFilters('2026-10-19'), from: '2026-09-01' };
		expect(loadFilters('2026-10-19', memory({ [FILTER_STORAGE_KEY]: JSON.stringify(running) })).from).toBe('2026-10-19');
	});
});

describe('visibleSuggestions', () => {
	const list = [4, 3, 2, 1.8, 1.5].map((efficiency, i) => suggestion({ id: `id${i}`, efficiency }));

	it('hides filler windows below the minimum and counts them', () => {
		const { shown, hidden } = visibleSuggestions(list, 2, 10);
		expect(shown.map((s) => s.id)).toEqual(['id0', 'id1', 'id2']);
		expect(hidden).toBe(2);
	});

	it('shows everything once the minimum is lowered and cuts to the requested count', () => {
		expect(visibleSuggestions(list, 1, 10)).toMatchObject({ hidden: 0 });
		expect(visibleSuggestions(list, 1, 2).shown).toHaveLength(2);
	});
});

describe('vacationBlocks', () => {
	it('keeps vacation days separated only by weekends and holidays in one block', () => {
		const blocks = vacationBlocks({ vacationDates: ['2026-05-15', '2026-05-18'], conflicts: [] });
		expect(blocks).toEqual([{ start: '2026-05-15', end: '2026-05-18', dates: ['2026-05-15', '2026-05-18'] }]);
	});

	it('splits at a day that is already vacation so no absence overlaps another', () => {
		const blocks = vacationBlocks({ vacationDates: ['2026-05-18', '2026-05-20'], conflicts: [{ date: '2026-05-19', type: 'already_vacation' }] });
		expect(blocks.map((b) => [b.start, b.end])).toEqual([
			['2026-05-18', '2026-05-18'],
			['2026-05-20', '2026-05-20']
		]);
	});

	it('sorts unordered input', () => {
		expect(vacationBlocks({ vacationDates: ['2026-05-20', '2026-05-18'], conflicts: [] })[0].start).toBe('2026-05-18');
	});
});

describe('timelineCells', () => {
	it('classifies every day from start to end and marks conflicts', () => {
		const cells = timelineCells(suggestion({ conflicts: [{ date: '2026-05-15', type: 'school_day' }] }));
		expect(cells.map((c) => c.kind)).toEqual(['holiday', 'vacation', 'weekend', 'weekend']);
		expect(cells.map((c) => c.day)).toEqual([14, 15, 16, 17]);
		expect(cells[1].conflict).toBe('school_day');
		expect(cells[1].label).toContain('Berufsschultag');
		expect(cells[0].label).toContain('Christi Himmelfahrt');
		expect(cells[0].conflict).toBeNull();
	});

	it('shows already booked vacation as booked and not as a conflict dot', () => {
		const cells = timelineCells(
			suggestion({ start: '2026-05-18', end: '2026-05-20', vacationDates: ['2026-05-18', '2026-05-20'], holidays: [], conflicts: [{ date: '2026-05-19', type: 'already_vacation' }] })
		);
		expect(cells.map((c) => c.kind)).toEqual(['vacation', 'booked', 'vacation']);
		expect(cells[1].conflict).toBeNull();
	});
});

describe('number formatting', () => {
	it('uses German decimals', () => {
		expect(formatFactor(2.75)).toBe('2,8');
		expect(formatFactor(4)).toBe('4');
		expect(formatDays(1)).toBe('1 Tag');
		expect(formatDays(12.5)).toBe('12,5 Tage');
		expect(formatDays(0)).toBe('0 Tage');
	});
});
