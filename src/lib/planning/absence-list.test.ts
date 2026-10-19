import { describe, expect, it } from 'vitest';
import type { Absence } from '#lib/api/types.js';
import {
	ABSENCE_FILTER_STORAGE_KEY,
	applyFilters,
	DEFAULT_ABSENCE_FILTERS,
	filtersFromQuery,
	filtersToQuery,
	hasActiveFilters,
	loadFilters,
	normalizeFilters,
	queryHasFilters,
	saveFilters,
	yearFromQuery
} from './absence-list.js';

const a = (id: string, extra: Partial<Absence>): Absence => ({ id, version: 1, countedHalfDays: 2, kind: 'vacation', startDate: '2026-03-02', endDate: '2026-03-03', status: 'approved', ...extra });
const list = [
	a('v1', { startDate: '2026-07-01', endDate: '2026-07-10', note: 'Sommerurlaub Italien' }),
	a('s1', { kind: 'sick', status: 'taken', startDate: '2026-02-02', endDate: '2026-02-04', note: 'Grippe' }),
	a('o1', { kind: 'other', status: 'planned', startDate: '2026-05-04', endDate: '2026-05-04' }),
	a('v2', { startDate: '2026-12-21', endDate: '2026-12-31', status: 'requested' })
];
const ids = (r: Absence[]) => r.map((x) => x.id);
const f = (extra: Partial<typeof DEFAULT_ABSENCE_FILTERS>) => ({ ...DEFAULT_ABSENCE_FILTERS, ...extra });

describe('sorting', () => {
	it('sorts by date both ways', () => {
		expect(ids(applyFilters(list, f({})))).toEqual(['s1', 'o1', 'v1', 'v2']);
		expect(ids(applyFilters(list, f({ sort: 'date_desc' })))).toEqual(['v2', 'v1', 'o1', 's1']);
	});
	it('sorts by kind then date and by status then date', () => {
		expect(ids(applyFilters(list, f({ sort: 'kind' })))).toEqual(['v1', 'v2', 's1', 'o1']);
		expect(ids(applyFilters(list, f({ sort: 'status' })))).toEqual(['o1', 'v2', 'v1', 's1']);
	});
});

describe('filtering', () => {
	it('filters by kind and status', () => {
		expect(ids(applyFilters(list, f({ kind: 'vacation' })))).toEqual(['v1', 'v2']);
		expect(ids(applyFilters(list, f({ status: 'taken' })))).toEqual(['s1']);
		expect(ids(applyFilters(list, f({ kind: 'sick', status: 'approved' })))).toEqual([]);
	});
	it('matches absences that overlap the date range', () => {
		expect(ids(applyFilters(list, f({ from: '2026-07-05', to: '2026-12-22' })))).toEqual(['v1', 'v2']);
		expect(ids(applyFilters(list, f({ to: '2026-03-01' })))).toEqual(['s1']);
		expect(ids(applyFilters(list, f({ from: '2026-12-31' })))).toEqual(['v2']);
	});
	it('searches the note case-insensitively', () => {
		expect(ids(applyFilters(list, f({ q: 'ITALIEN' })))).toEqual(['v1']);
		expect(ids(applyFilters(list, f({ q: '  grippe ' })))).toEqual(['s1']);
		expect(ids(applyFilters(list, f({ q: 'nichts' })))).toEqual([]);
	});
	it('filters by attachment presence and hides entries whose attachments are not loaded yet', () => {
		const counts = { v1: 2, s1: 0 };
		expect(ids(applyFilters(list, f({ attachment: 'with' }), counts))).toEqual(['v1']);
		expect(ids(applyFilters(list, f({ attachment: 'without' }), counts))).toEqual(['s1']);
		expect(ids(applyFilters(list, f({ attachment: 'any' }), counts))).toHaveLength(4);
	});
});

describe('query and persistence', () => {
	it('reads sanitised filters from the URL', () => {
		const filters = filtersFromQuery(new URLSearchParams('sort=date_desc&kind=sick&status=bogus&from=2026-13-01&to=2026-06-30&q=arzt&attachment=with'));
		expect(filters).toEqual({ sort: 'date_desc', kind: 'sick', status: 'all', attachment: 'with', from: '', to: '2026-06-30', q: 'arzt' });
		expect(queryHasFilters(new URLSearchParams('year=2025'))).toBe(false);
		expect(queryHasFilters(new URLSearchParams('kind=sick'))).toBe(true);
	});
	it('writes only non-default values and round-trips', () => {
		expect(filtersToQuery(DEFAULT_ABSENCE_FILTERS, 2026, 2026).toString()).toBe('');
		const custom = f({ kind: 'vacation', q: 'sommer', sort: 'status' });
		const query = filtersToQuery(custom, 2025, 2026);
		expect(query.get('year')).toBe('2025');
		expect(filtersFromQuery(query)).toEqual(custom);
		expect(yearFromQuery(new URLSearchParams('year=abc'), 2026)).toBe(2026);
		expect(yearFromQuery(query, 2026)).toBe(2025);
	});
	it('knows whether filters are active (sorting alone is not a filter)', () => {
		expect(hasActiveFilters(f({ sort: 'kind' }))).toBe(false);
		expect(hasActiveFilters(f({ q: 'x' }))).toBe(true);
	});
	it('stores and loads filters, tolerating broken or unavailable storage', () => {
		const data = new Map<string, string>();
		const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
		saveFilters(f({ kind: 'sick' }), storage);
		expect(loadFilters(storage).kind).toBe('sick');
		saveFilters(DEFAULT_ABSENCE_FILTERS, storage);
		expect(data.has(ABSENCE_FILTER_STORAGE_KEY)).toBe(false);
		data.set(ABSENCE_FILTER_STORAGE_KEY, '{nope');
		expect(loadFilters(storage)).toEqual(DEFAULT_ABSENCE_FILTERS);
		const throwing = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(loadFilters(throwing)).toEqual(DEFAULT_ABSENCE_FILTERS);
		expect(() => saveFilters(f({ q: 'x' }), throwing)).not.toThrow();
		expect(normalizeFilters({ kind: 'x', q: 5 })).toEqual(DEFAULT_ABSENCE_FILTERS);
	});
});
