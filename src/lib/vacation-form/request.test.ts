import { describe, expect, it } from 'vitest';
import type { Absence, CalendarDay, VacationBalance, WorkModel } from '../api/types';
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

const abs = (id: string, status: Absence['status'], startDate: string, endDate: string, countedHalfDays: number, extra: Partial<Absence> = {}): Absence => ({
	id, version: 1, kind: 'vacation', status, countedHalfDays, startDate, endDate, ...extra
});

describe('buildRequestData: remaining days as of the request', () => {
	// total 70; request 07-06..07-17 = 18 half days; booked 10 (A), planned+requested 36 (B 10, C 8, self 18) -> available after planned 24
	const A = abs('A', 'approved', '2026-03-02', '2026-03-06', 10);
	const B = abs('B', 'planned', '2026-05-04', '2026-05-08', 10);
	const C = abs('C', 'requested', '2026-09-01', '2026-09-04', 8);
	const self = abs('self', 'planned', '2026-07-06', '2026-07-17', 18);
	const bal = balance({ bookedHalfDays: 10, plannedHalfDays: 36, availableHalfDays: 60, availableAfterPlannedHalfDays: 24 });
	const run = (absences: Absence[] | null, extra: Partial<Parameters<typeof buildRequestData>[0]> = {}) =>
		buildRequestData({ ...base, balance: bal, inBalance: true, targetId: 'self', absences, ...extra });

	it('deducts approved and planned vacation before the request, not the later one', () => {
		const data = run([A, B, C, self]);
		expect(data.breakdown?.before.map((b) => [b.id, b.halfDays])).toEqual([['A', 10], ['B', 10]]);
		expect(data.breakdown?.later.map((b) => [b.id, b.halfDays])).toEqual([['C', 8]]);
		expect(data.restBeforeHalfDays).toBe(50); // 70 - 20
		expect(data.restAfterHalfDays).toBe(32); // 50 - 18
		expect(data.restYearEndHalfDays).toBe(24); // everything deducted
		expect(data.breakdown?.laterHalfDays).toBe(8);
		expect(data.compensatedHalfDays).toBe(20);
		expect(data.compensatedDecidedHalfDays).toBe(10); // only the approved block
	});
	it('a planned block before the request reduces the rest (the reported bug)', () => {
		const withPlan = run([A, B, self]).restBeforeHalfDays;
		const without = run([A, self]).restBeforeHalfDays;
		expect(without - withPlan).toBe(10);
	});
	it('a planned block after the request does not reduce the rest at the request, only the year-end figure', () => {
		const data = run([A, C, self], { balance: balance({ bookedHalfDays: 10, plannedHalfDays: 26, availableAfterPlannedHalfDays: 34 }) });
		expect(data.restBeforeHalfDays).toBe(60);
		expect(data.restYearEndHalfDays).toBe(34 - 0);
		expect(data.restAfterHalfDays).toBe(42);
		expect(data.breakdown?.laterHalfDays).toBe(8);
	});
	it('counts a block that starts before the request only up to the request start and does not double count the overlap', () => {
		const overlap = abs('O', 'planned', '2026-06-29', '2026-07-09', 12);
		const data = run([overlap, self]);
		expect(data.breakdown?.before).toEqual([{ id: 'O', from: '2026-06-29', to: '2026-07-09', status: 'planned', halfDays: 10, partial: true }]);
		expect(data.breakdown?.later).toEqual([]);
		expect(data.breakdown?.overlapping.map((b) => b.id)).toEqual(['O']);
		expect(data.compensatedHalfDays).toBe(10);
	});
	it('splits a block that reaches over the whole request into a before and a later part', () => {
		const wide = abs('W', 'approved', '2026-07-01', '2026-07-24', 30);
		const data = run([wide, self]);
		expect(data.breakdown?.before[0]).toMatchObject({ id: 'W', halfDays: 6, partial: true }); // Wed-Fri 07-01..07-03
		expect(data.breakdown?.later[0]).toMatchObject({ id: 'W', halfDays: 10, partial: true }); // 07-20..07-24
	});
	it('keeps half days: a whole block with a half day edge uses the server count', () => {
		const half = abs('H', 'approved', '2026-06-15', '2026-06-19', 9, { halfDayEnd: true });
		const data = run([half, self]);
		expect(data.breakdown?.before[0].halfDays).toBe(9);
		expect(data.restBeforeHalfDays).toBe(70 - 9);
	});
	it('counts two half days that meet on the first request day on both sides', () => {
		const meet = abs('M', 'approved', '2026-06-29', '2026-07-06', 11, { halfDayEnd: true });
		const data = run([meet, self], { halfDayStart: true });
		expect(data.breakdown?.before[0]).toMatchObject({ id: 'M', halfDays: 11, partial: false });
		expect(data.breakdown?.overlapping).toEqual([]);
		expect(data.workingDays).toBe(8.5);
	});
	it('a request half day at the start with a full-day neighbour on the same day is an overlap', () => {
		const meet = abs('M', 'approved', '2026-06-29', '2026-07-06', 12);
		const data = run([meet, self]);
		expect(data.breakdown?.before[0]).toMatchObject({ halfDays: 10, partial: true }); // 06-29..07-03
		expect(data.breakdown?.overlapping.map((b) => b.id)).toEqual(['M']);
	});
	it('includes carry-over in the total and respects a snapshot (nothing before the snapshot date counts)', () => {
		const pre = abs('P', 'approved', '2026-02-02', '2026-02-06', 10);
		const post = abs('Q', 'approved', '2026-04-06', '2026-04-10', 10);
		const snap = balance({ snapshotDate: '2026-03-01', snapshotRemainingHalfDays: 50, entitlementHalfDays: 0, carryOverHalfDays: 0, adjustmentHalfDays: 0, bookedHalfDays: 10, plannedHalfDays: 18, availableAfterPlannedHalfDays: 22 });
		const data = run([pre, post, self], { balance: snap });
		expect(data.breakdown?.before.map((b) => b.id)).toEqual(['Q']);
		expect(data.restBeforeHalfDays).toBe(40);
		const withCarry = run([A, self]);
		expect(withCarry.entitlementTotalHalfDays).toBe(70); // 60 + 8 carry-over + 2 correction
		expect(withCarry.restBeforeHalfDays).toBe(60);
	});
	it('clips at the year boundary: the previous year part is not counted, the next year part is not "later"', () => {
		const dec = abs('D', 'approved', '2025-12-22', '2026-01-09', 26);
		const jan = buildRequestData({ ...base, from: '2026-01-12', to: '2026-01-16', balance: bal, inBalance: false, absences: [dec], holidays: [] });
		expect(jan.breakdown?.before[0]).toMatchObject({ id: 'D', halfDays: 14, partial: true }); // 01-01..01-09, 7 weekdays
		const next = abs('N', 'planned', '2026-12-28', '2027-01-08', 16);
		const late = buildRequestData({ ...base, from: '2026-12-14', to: '2026-12-18', balance: bal, inBalance: false, absences: [next], holidays: [] });
		expect(late.breakdown?.later[0]).toMatchObject({ id: 'N', halfDays: 8, partial: true }); // 12-28..12-31
		expect(late.breakdown?.before).toEqual([]);
	});
	it('ignores rejected, cancelled and non-vacation absences and the absence the request is for', () => {
		const rejected = abs('R', 'rejected', '2026-05-04', '2026-05-08', 10);
		const cancelled = abs('X', 'cancelled', '2026-05-11', '2026-05-15', 10);
		const sick = { ...abs('S', 'approved', '2026-05-18', '2026-05-22', 10), kind: 'sick' } as Absence;
		const own = abs('self', 'approved', '2026-06-01', '2026-06-05', 10);
		const data = run([rejected, cancelled, sick, own]);
		expect(data.breakdown?.before).toEqual([]);
		expect(data.restBeforeHalfDays).toBe(70);
	});
	it('without the absence list everything counts as earlier and the page says so', () => {
		const data = run(null);
		expect(data.breakdown?.blocksKnown).toBe(false);
		expect(data.restBeforeHalfDays).toBe(24 + 18);
		expect(data.restAfterHalfDays).toBe(24);
		expect(data.restYearEndHalfDays).toBe(24);
	});
	it('a request that is not an absence yet is subtracted once for the year-end figure', () => {
		const fresh = buildRequestData({ ...base, balance: balance({ bookedHalfDays: 10, plannedHalfDays: 10, availableAfterPlannedHalfDays: 50 }), inBalance: false, absences: [A, B] });
		expect(fresh.restBeforeHalfDays).toBe(50);
		expect(fresh.restAfterHalfDays).toBe(32);
		expect(fresh.restYearEndHalfDays).toBe(32);
	});
});
