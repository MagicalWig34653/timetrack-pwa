import { describe, expect, it } from 'vitest';
import type { CalendarDay, VacationBalance, WorkModel } from '../api/types';
import { buildRequestData } from './request';

const balance = (extra: Partial<VacationBalance> = {}): VacationBalance => ({
	year: 2026,
	snapshotDate: null,
	snapshotRemainingHalfDays: null,
	entitlementHalfDays: 60,
	carryOverHalfDays: 8,
	adjustmentHalfDays: 2,
	bookedHalfDays: 10,
	plannedHalfDays: 20,
	availableHalfDays: 60,
	availableAfterPlannedHalfDays: 40,
	...extra
});
const model: WorkModel = { id: 'm', createdAt: '', validFrom: '2026-01-01', validTo: null, weeklyTargetSeconds: 144000, workdays: [1, 2, 3, 4, 5] };
const holidays: CalendarDay[] = [{ startDate: '2026-07-08', endDate: '2026-07-08', name: 'Testfeiertag', kind: 'holiday', source: 'custom' }];
const base = { from: '2026-07-06', to: '2026-07-17', today: '2026-06-01', models: [model], holidays };

describe('buildRequestData', () => {
	it('derives working days, rest days and free ranges', () => {
		const data = buildRequestData({ ...base, balance: balance(), inBalance: false });
		expect(data.workingDays).toBe(9); // 10 weekdays minus the holiday
		expect(data.entitlementYearHalfDays).toBe(60);
		expect(data.entitlementTotalHalfDays).toBe(70); // 60 + 8 + 2
		expect(data.restBeforeHalfDays).toBe(40);
		expect(data.restAfterHalfDays).toBe(22);
		expect(data.freeRanges).toEqual([
			{ from: '2026-07-08', to: '2026-07-08' },
			{ from: '2026-07-11', to: '2026-07-12' }
		]);
	});
	it('adds the request back when its absence already counts as planned or booked', () => {
		const data = buildRequestData({ ...base, balance: balance(), inBalance: true });
		expect(data.restBeforeHalfDays).toBe(58);
		expect(data.restAfterHalfDays).toBe(40);
	});
	it('uses the snapshot remainder instead of entitlement and carry-over', () => {
		const data = buildRequestData({ ...base, balance: balance({ snapshotDate: '2026-03-01', snapshotRemainingHalfDays: 50, entitlementHalfDays: 0, carryOverHalfDays: 0 }), inBalance: false });
		expect(data.entitlementTotalHalfDays).toBe(52);
		expect(data.entitlementYearHalfDays).toBe(50);
	});
	it('handles half days at the edges', () => {
		const data = buildRequestData({ ...base, balance: balance(), inBalance: false, halfDayStart: true });
		expect(data.workingDays).toBe(8.5);
		expect(data.restAfterHalfDays).toBe(40 - 17);
	});
	it('passes the substitute and today through', () => {
		const data = buildRequestData({ ...base, balance: balance(), inBalance: false, substitute: 'A. B.' });
		expect(data).toMatchObject({ substitute: 'A. B.', today: '2026-06-01', from: '2026-07-06', to: '2026-07-17' });
	});
});
