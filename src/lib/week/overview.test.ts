import { describe, expect, it } from 'vitest';
import type { TimeWeekDay, TimeWeekSummary } from '#lib/api/types.js';
import { balanceTone, barShares, dayAriaLabel, dayHours, isEmptyWeek, noteworthyDays, summarySentence } from './overview.js';

const day = (extra: Partial<TimeWeekDay> = {}): TimeWeekDay => ({
	date: '2026-10-20', weekday: 2, mark: 'work', markSource: 'none', targetSeconds: 27_720, plannedSeconds: null, planMode: null,
	workSeconds: 27_720, creditSeconds: 0, rawWorkSeconds: 27_720, breakSeconds: 0, breakDeductionSeconds: 0, travelSeconds: 0, schoolSeconds: 0,
	balanceSeconds: 0, firstStart: null, lastEnd: null, segmentsCount: 2, absences: [], provisional: false, isToday: false, isFuture: false, ...extra
});
const summary = (extra: Partial<TimeWeekSummary> = {}): TimeWeekSummary => ({
	targetSeconds: 138_600, targetToDateSeconds: 138_600, workSeconds: 112_500, creditSeconds: 0, balanceSeconds: -8100, plannedSeconds: null,
	accountBalanceBeforeSeconds: 0, accountBalanceAfterSeconds: 0, accountBalanceAsOf: '2026-10-25', vacationDays: 1, sickDays: 0, schoolDays: 0, holidayDays: 1,
	workDays: 3, travelSeconds: 0, breakSeconds: 0, averageStart: null, averageEnd: null, longestDay: null, provisional: false, ...extra
});

describe('day card facts', () => {
	it('adds credit to the shown hours', () => expect(dayHours(day({ workSeconds: 0, creditSeconds: 27_720 }))).toBe(27_720));
	it('scales worked, planned and target bars against the largest of them', () => {
		expect(barShares(day({ workSeconds: 13_860, plannedSeconds: 27_720 }))).toEqual({ actual: 50, planned: 100, target: 100 });
		expect(barShares(day({ workSeconds: 36_000, plannedSeconds: null }))).toMatchObject({ actual: 100, planned: 0 });
		expect(barShares(day({ workSeconds: 0, targetSeconds: 0 }))).toEqual({ actual: 0, planned: 0, target: 0 });
	});
	it('reads a day aloud with date, hours, balance and mode', () => {
		const text = dayAriaLabel(day({ workSeconds: 27_720 + 720, balanceSeconds: 720, planMode: 'office' }));
		expect(text).toBe('Dienstag, 20.10.2026, 7:54 Stunden, Saldo plus 0:12, Büro');
	});
	it('names the mark and omits hours for future days', () => {
		expect(dayAriaLabel(day({ mark: 'vacation', isFuture: true, workSeconds: 0, balanceSeconds: null, plannedSeconds: 28_800 }))).toBe('Dienstag, 20.10.2026, Urlaub, geplant 8:00 Stunden');
		expect(dayAriaLabel(day({ balanceSeconds: -5400, workSeconds: 22_320 }))).toContain('Saldo minus 1:30');
	});
	it('detects an empty week', () => {
		const idle = Array.from({ length: 7 }, () => day({ segmentsCount: 0, workSeconds: 0, balanceSeconds: 0, isFuture: true }));
		expect(isEmptyWeek(idle)).toBe(true);
		expect(isEmptyWeek([...idle.slice(1), day({ plannedSeconds: 100 })])).toBe(false);
		expect(isEmptyWeek([...idle.slice(1), day({ mark: 'holiday', segmentsCount: 0 })])).toBe(false);
	});
	it('colours balances', () => {
		expect([balanceTone(0), balanceTone(1), balanceTone(-1), balanceTone(null)]).toEqual(['neutral', 'success', 'warning', 'neutral']);
	});
});

describe('summary sentence', () => {
	it('names hours, the gap to the target and the non-work days', () => {
		expect(summarySentence(summary({ workSeconds: 112_500, balanceSeconds: -8100 }), true, 43)).toBe(
			'Diese Woche: 31:15 Std. gearbeitet, 2:15 Std. unter Soll; 1 Urlaubstag, 1 Feiertag.'
		);
	});
	it('uses the week number for other weeks and handles over-target and exact weeks', () => {
		expect(summarySentence(summary({ balanceSeconds: 600, vacationDays: 0, holidayDays: 0 }), false, 41)).toBe('KW 41: 31:15 Std. gearbeitet, 0:10 Std. über Soll.');
		expect(summarySentence(summary({ balanceSeconds: 0, vacationDays: 0, holidayDays: 0 }), true, 43)).toBe('Diese Woche: 31:15 Std. gearbeitet, genau im Soll.');
	});
	it('lists half vacation days with a decimal comma and plural forms', () => {
		expect(noteworthyDays(summary({ vacationDays: 2.5, sickDays: 1, schoolDays: 2, holidayDays: 0 }))).toEqual(['2,5 Urlaubstage', '1 Krankheitstag', '2 Schultage']);
	});
});
