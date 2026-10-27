import { describe, expect, it } from 'vitest';
import type { Absence, DayEvaluation, PlanDay } from '#lib/api/types.js';
import type { DayInfo } from './calendar';
import { actualBar, cellModel, heatLevel, lineSpan, monthSummary, planBars } from './cell-model';

const info = (extra: Partial<DayInfo> = {}): DayInfo => ({ date: '2026-10-14', holidays: [], schoolHolidays: [], absences: [], plan: null, evaluation: null, ...extra });
const absence = (extra: Partial<Absence>): Absence => ({ id: 'a', kind: 'vacation', status: 'approved', startDate: '2026-10-14', endDate: '2026-10-14', halfDayStart: false, halfDayEnd: false, ...extra }) as Absence;
const evaluation = (extra: Partial<DayEvaluation> = {}): DayEvaluation => ({ date: '2026-10-14', targetSeconds: 28800, evaluatedWorkSeconds: 0, creditSeconds: 0, ...extra }) as DayEvaluation;

describe('lineSpan', () => {
	it('maps minutes into the 06-22 window in percent', () => {
		expect(lineSpan(6 * 60, 14 * 60)).toEqual({ left: 0, width: 50 });
		expect(lineSpan(14 * 60, 22 * 60)).toEqual({ left: 50, width: 50 });
	});
	it('clamps to the window, rejects empty and outside ranges and keeps tiny blocks visible', () => {
		expect(lineSpan(4 * 60, 8 * 60)).toEqual({ left: 0, width: 12.5 });
		expect(lineSpan(23 * 60, 23 * 60 + 30)).toBeNull();
		expect(lineSpan(600, 600)).toBeNull();
		expect(lineSpan(600, 605)?.width).toBe(3);
		const edge = lineSpan(21 * 60 + 58, 22 * 60)!;
		expect(edge.left + edge.width).toBeLessThanOrEqual(100);
	});
});

describe('planBars', () => {
	it('uses the block list with the kind of each block', () => {
		const plan = { mode: 'office', blocks: [{ start: '08:00', end: '12:00', kind: 'school' }, { start: '13:00', end: '16:00', kind: 'office' }] } as PlanDay;
		expect(planBars(plan).map((b) => b.kind)).toEqual(['school', 'office']);
	});
	it('falls back to the rough window in the plan mode and draws nothing for free days', () => {
		expect(planBars({ mode: 'home', plannedStart: '08:00', plannedEnd: '16:00' } as PlanDay)).toHaveLength(1);
		expect(planBars({ mode: 'off', plannedStart: '08:00', plannedEnd: '16:00' } as PlanDay)).toEqual([]);
		expect(planBars(null)).toEqual([]);
	});
});

describe('actualBar', () => {
	it('converts the evaluated start and end into the time zone', () => {
		const bar = actualBar(evaluation({ evaluatedWorkSeconds: 3600, evaluatedStart: '2026-10-14T06:00:00Z', evaluatedEnd: '2026-10-14T14:00:00Z' }), 'Europe/Berlin');
		expect(bar).toEqual({ left: 12.5, width: 50 });
	});
	it('is null without time', () => {
		expect(actualBar(evaluation(), 'Europe/Berlin')).toBeNull();
		expect(actualBar(null, 'Europe/Berlin')).toBeNull();
	});
});

describe('cellModel', () => {
	it('separates open (hatched) from booked vacation and flags half days', () => {
		expect(cellModel(info({ absences: [absence({ status: 'planned' })] }), [], 'UTC').vacation).toBe('open');
		expect(cellModel(info({ absences: [absence({ status: 'requested' })] }), [], 'UTC').vacation).toBe('open');
		const booked = cellModel(info({ absences: [absence({ halfDayStart: true })] }), [], 'UTC');
		expect(booked.vacation).toBe('booked');
		expect(booked.vacationHalf).toBe(true);
	});
	it('marks company half days, sickness, school holidays and free days', () => {
		const h = { startDate: '2026-10-14', endDate: '2026-10-14', name: 'Heiligabend', kind: 'holiday', companyTreatment: 'half' } as DayInfo['holidays'][number];
		expect(cellModel(info({ holidays: [h] }), [], 'UTC').holiday).toBe('half');
		expect(cellModel(info({ holidays: [{ ...h, companyTreatment: null }] }), [], 'UTC').holiday).toBe('full');
		expect(cellModel(info({ absences: [absence({ kind: 'sick' })] }), [], 'UTC').sick).toBe(true);
		expect(cellModel(info({ schoolHolidays: [h] }), [], 'UTC').schoolHoliday).toBe(true);
		expect(cellModel(info({ date: '2026-10-17' }), [], 'UTC').free).toBe(true);
		expect(cellModel(info(), [], 'UTC').free).toBe(false);
	});
	it('lists the distinct plan kinds in painting order', () => {
		const plan = { mode: 'office', blocks: [{ start: '08:00', end: '09:00', kind: 'office' }, { start: '10:00', end: '11:00', kind: 'work' }, { start: '12:00', end: '13:00', kind: 'office' }] } as PlanDay;
		const model = cellModel(info({ plan }), [], 'UTC');
		expect(model.kinds).toEqual(['work', 'office']);
		expect(model.hasTimeline).toBe(true);
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
