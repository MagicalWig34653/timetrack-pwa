import { describe, expect, it } from 'vitest';
import type { Absence, DayEvaluation } from '#lib/api/types.js';
import type { DayInfo } from './calendar';
import { cellModel, heatLevel, monthSummary } from './cell-model';

const info = (extra: Partial<DayInfo> = {}): DayInfo => ({ date: '2026-10-14', holidays: [], schoolHolidays: [], absences: [], plan: null, evaluation: null, ...extra });
const absence = (extra: Partial<Absence>): Absence => ({ id: 'a', kind: 'vacation', status: 'approved', startDate: '2026-10-14', endDate: '2026-10-14', halfDayStart: false, halfDayEnd: false, ...extra }) as Absence;
const evaluation = (extra: Partial<DayEvaluation> = {}): DayEvaluation => ({ date: '2026-10-14', targetSeconds: 28800, evaluatedWorkSeconds: 0, creditSeconds: 0, ...extra }) as DayEvaluation;

describe('cellModel', () => {
	it('separates open (hatched) from booked vacation and flags half days', () => {
		expect(cellModel(info({ absences: [absence({ status: 'planned' })] }), []).vacation).toBe('open');
		expect(cellModel(info({ absences: [absence({ status: 'requested' })] }), []).vacation).toBe('open');
		const booked = cellModel(info({ absences: [absence({ halfDayStart: true })] }), []);
		expect(booked.vacation).toBe('booked');
		expect(booked.vacationHalf).toBe(true);
	});
	it('marks company half days, sickness, school holidays and free days', () => {
		const h = { startDate: '2026-10-14', endDate: '2026-10-14', name: 'Heiligabend', kind: 'holiday', companyTreatment: 'half' } as DayInfo['holidays'][number];
		expect(cellModel(info({ holidays: [h] }), []).holiday).toBe('half');
		expect(cellModel(info({ holidays: [{ ...h, companyTreatment: null }] }), []).holiday).toBe('full');
		expect(cellModel(info({ absences: [absence({ kind: 'sick' })] }), []).sick).toBe(true);
		expect(cellModel(info({ schoolHolidays: [h] }), []).schoolHoliday).toBe(true);
		expect(cellModel(info({ date: '2026-10-17' }), []).free).toBe(true);
		expect(cellModel(info(), []).free).toBe(false);
	});
});

describe('monthSummary', () => {
	const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
	const days = dates.map((date) => evaluation({ date, evaluatedWorkSeconds: date < '2026-10-14' ? 28800 : 0 }));
	it('sums Ist and Soll and relates the balance to the Soll up to today', () => {
		const s = monthSummary(dates, { holidays: [], absences: [], plan: [], days }, [], '2026-10-13');
		expect(s.actualSeconds).toBe(57600);
		expect(s.targetSeconds).toBe(115200);
		expect(s.targetToDateSeconds).toBe(57600);
		expect(s.balanceSeconds).toBe(0);
		expect(s.complete).toBe(true);
	});
	it('counts vacation days by status, half days as 0.5, and skips non-working days', () => {
		const absences = [
			absence({ id: '1', startDate: '2026-10-12', endDate: '2026-10-13', status: 'approved' }),
			absence({ id: '2', startDate: '2026-10-14', endDate: '2026-10-14', status: 'planned', halfDayStart: true }),
			absence({ id: '3', kind: 'sick', startDate: '2026-10-15', endDate: '2026-10-15' })
		];
		const s = monthSummary([...dates, '2026-10-17'], { holidays: [], absences: [...absences, absence({ id: '4', startDate: '2026-10-17', endDate: '2026-10-17' })], plan: [], days }, [], '2026-10-20');
		expect(s.vacationBooked).toBe(2);
		expect(s.vacationOpen).toBe(0.5);
		expect(s.sickDays).toBe(1);
		expect(s.complete).toBe(false);
	});
});

describe('heatLevel', () => {
	it('grades the worked share of the Soll', () => {
		expect([0, 3600, 20000, 28800, 36000].map((s) => heatLevel(s, 28800))).toEqual([0, 1, 2, 3, 4]);
		expect(heatLevel(3600, 0)).toBe(3);
	});
});
