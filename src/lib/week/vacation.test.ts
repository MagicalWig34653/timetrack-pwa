import { describe, expect, it } from 'vitest';
import type { Absence } from '#lib/api/types.js';
import { entriesForDay, vacationByDay, vacationLabel, vacationTooltip } from './vacation.js';

const abs = (over: Partial<Absence>): Absence => ({ id: 'a', version: 1, countedHalfDays: 2, kind: 'vacation', startDate: '2026-10-27', endDate: '2026-10-28', status: 'planned', ...over });

describe('vacationByDay', () => {
	it('lists planned, requested and approved vacation on every covered day of the week', () => {
		const result = vacationByDay([abs({ id: 'p', status: 'planned' }), abs({ id: 'r', status: 'requested', startDate: '2026-10-29', endDate: '2026-10-29' }), abs({ id: 'g', status: 'approved', startDate: '2026-10-30', endDate: '2026-10-30' })], '2026-10-26', '2026-11-01');
		expect(Object.keys(result)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
		expect(result['2026-10-29']).toEqual([{ id: 'r', status: 'requested', halfDay: false }]);
		expect(result['2026-10-30'][0].status).toBe('approved');
	});
	it('ignores rejected, cancelled, taken and other kinds', () => {
		const list = [abs({ status: 'rejected' }), abs({ status: 'cancelled' }), abs({ status: 'taken' }), abs({ kind: 'sick', status: 'approved' })];
		expect(vacationByDay(list, '2026-10-26', '2026-11-01')).toEqual({});
	});
	it('clips to the visible week', () => {
		const result = vacationByDay([abs({ startDate: '2026-10-22', endDate: '2026-11-05' })], '2026-10-26', '2026-11-01');
		expect(Object.keys(result)).toHaveLength(7);
		expect(result['2026-10-25']).toBeUndefined();
		expect(result['2026-11-02']).toBeUndefined();
	});
	it('marks half days at the ends of a range and on a single day', () => {
		const range = vacationByDay([abs({ startDate: '2026-10-27', endDate: '2026-10-29', halfDayStart: true, halfDayEnd: true })], '2026-10-26', '2026-11-01');
		expect(range['2026-10-27'][0].halfDay).toBe(true);
		expect(range['2026-10-28'][0].halfDay).toBe(false);
		expect(range['2026-10-29'][0].halfDay).toBe(true);
		const single = vacationByDay([abs({ startDate: '2026-10-27', endDate: '2026-10-27', halfDayEnd: true })], '2026-10-26', '2026-11-01');
		expect(single['2026-10-27'][0].halfDay).toBe(true);
	});
	it('orders overlapping entries with the most binding status first', () => {
		const result = vacationByDay([abs({ id: 'p', status: 'planned' }), abs({ id: 'g', status: 'approved' })], '2026-10-26', '2026-11-01');
		expect(result['2026-10-27'].map((e) => e.id)).toEqual(['g', 'p']);
	});
});

describe('vacationLabel', () => {
	it('names the status and half days', () => {
		expect(vacationLabel({ status: 'planned', halfDay: false })).toBe('Urlaub – geplant');
		expect(vacationLabel({ status: 'requested', halfDay: false })).toBe('Urlaub – beantragt');
		expect(vacationLabel({ status: 'approved', halfDay: true })).toBe('Urlaub (halber Tag) – genehmigt');
	});
});

describe('entriesForDay', () => {
	const by = { '2026-10-27': [{ id: 'a', status: 'planned' as const, halfDay: false }] };
	it('is null without a list and empty on free days', () => {
		expect(entriesForDay(null, '2026-10-27', 'work')).toBeNull();
		expect(entriesForDay(by, '2026-10-27', 'off')).toEqual([]);
		expect(entriesForDay(by, '2026-10-27', 'holiday')).toEqual([]);
		expect(entriesForDay(by, '2026-10-27', 'work')).toHaveLength(1);
		expect(entriesForDay(by, '2026-10-28', 'work')).toEqual([]);
	});
});

describe('vacationTooltip', () => {
	it('adds what is still open and nothing for approved vacation', () => {
		expect(vacationTooltip({ status: 'planned', halfDay: false })).toBe('Urlaub – geplant, noch nicht beantragt');
		expect(vacationTooltip({ status: 'requested', halfDay: true })).toBe('Urlaub (halber Tag) – beantragt, noch nicht genehmigt');
		expect(vacationTooltip({ status: 'approved', halfDay: false })).toBe('Urlaub – genehmigt');
	});
});
