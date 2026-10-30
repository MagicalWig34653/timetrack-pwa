import { describe, expect, it } from 'vitest';
import type { Absence, DayEvaluation, Segment } from '#lib/api/types.js';
import { aggregate, bucketKey, bucketLabel, clockText, presetRange, segmentFigures } from './aggregate.js';

const seg = (kind: Segment['kind'], start: string, end: string | null): Segment =>
	({ id: start, kind, startedAt: start, endedAt: end, rawStartedAt: start, rawEndedAt: end, source: 'manual', version: 1, voided: false, needsReview: false }) as Segment;
const day = (date: string, target: number, evaluated: number, raw = evaluated, extra: Partial<DayEvaluation> = {}): DayEvaluation =>
	({ date, targetSeconds: target, evaluatedWorkSeconds: evaluated, rawWorkSeconds: raw, creditSeconds: 0, deltaSeconds: evaluated - target, breakDeductionSeconds: 0, startAdjustSeconds: 0, endAdjustSeconds: 0, provisional: false, segmentIds: [], breakHints: [], ...extra }) as DayEvaluation;
const base = { absences: [] as Absence[], openingBalanceSeconds: 0, rounded: true, today: '2026-10-23', timeZone: 'Europe/Berlin' };

describe('buckets', () => {
	it('keys and labels', () => {
		expect(bucketKey('2026-10-22', 'week')).toBe('2026-10-19');
		expect(bucketKey('2026-10-22', 'month')).toBe('2026-10-01');
		expect(bucketLabel('2026-10-19', 'week')).toBe('KW 43');
		expect(bucketLabel('2026-10-01', 'month')).toBe('Okt 26');
		expect(bucketLabel('2026-10-05', 'day')).toBe('05.10.');
	});
});

describe('aggregate', () => {
	const days = [day('2026-10-19', 28800, 30600), day('2026-10-20', 28800, 27000), day('2026-10-26', 28800, 0)];
	it('sums per week, builds the cumulative balance and skips future days', () => {
		const data = aggregate({ ...base, days, openingBalanceSeconds: 3600, granularity: 'week' });
		expect(data.points).toHaveLength(1);
		expect(data.points[0]).toMatchObject({ key: '2026-10-19', targetSeconds: 57600, actualSeconds: 57600, deltaSeconds: 0, balanceSeconds: 3600, days: 2 });
		const perDay = aggregate({ ...base, days, openingBalanceSeconds: 3600, granularity: 'day' });
		expect(perDay.points.map((p) => p.balanceSeconds)).toEqual([5400, 3600]);
		expect(data.totals.deltaSeconds).toBe(0);
		expect(data.empty).toBe(false);
	});
	it('keeps today out of the balance and reports it separately', () => {
		const data = aggregate({ ...base, granularity: 'day', openingBalanceSeconds: 0, today: '2026-10-20', days: [day('2026-10-19', 28800, 30600), day('2026-10-20', 28800, 27000)] });
		expect(data.points.map((p) => p.balanceSeconds)).toEqual([1800, 1800]);
		expect(data.includesToday).toBe(false);
		expect(data.todayDeltaSeconds).toBe(-1800);
	});
	it('uses raw times when rounding is off', () => {
		const data = aggregate({ ...base, rounded: false, granularity: 'day', days: [day('2026-10-19', 28800, 30600, 29000)] });
		expect(data.points[0].actualSeconds).toBe(29000);
	});
	it('counts credit as time', () => {
		const data = aggregate({ ...base, granularity: 'day', days: [day('2026-10-19', 28800, 0, 0, { creditSeconds: 28800 })] });
		expect(data.points[0].deltaSeconds).toBe(0);
	});
	it('counts absence days incl. half days and average start/end', () => {
		const absences = [{ id: 'a', kind: 'vacation', status: 'approved', startDate: '2026-10-19', endDate: '2026-10-20', halfDayEnd: true, version: 1, countedHalfDays: 3 }] as Absence[];
		const withTimes = day('2026-10-21', 28800, 28800, 28800, { evaluatedStart: '2026-10-21T06:00:00Z', evaluatedEnd: '2026-10-21T14:00:00Z' });
		const data = aggregate({ ...base, absences, granularity: 'month', days: [day('2026-10-19', 28800, 0), day('2026-10-20', 28800, 0), withTimes] });
		expect(data.points[0].vacationDays).toBe(1.5);
		expect(data.totals.absenceDays).toBe(1.5);
		expect(data.points[0].avgStartMinutes).toBe(8 * 60);
		expect(data.points[0].avgEndMinutes).toBe(16 * 60);
	});
	it('reports empty data', () => {
		expect(aggregate({ ...base, granularity: 'week', days: [] }).empty).toBe(true);
		expect(aggregate({ ...base, granularity: 'week', days: [day('2026-10-24', 0, 0), day('2026-10-19', 0, 0)] }).empty).toBe(true);
	});
});

describe('segmentFigures', () => {
	it('sums kinds and gaps and ignores open segments', () => {
		const f = segmentFigures([
			seg('work', '2026-10-19T06:00:00Z', '2026-10-19T10:00:00Z'),
			seg('travel', '2026-10-19T10:30:00Z', '2026-10-19T11:00:00Z'),
			seg('work', '2026-10-19T12:00:00Z', null)
		]);
		expect(f).toMatchObject({ work: 14400, travel: 1800, school: 0, gaps: 1800 });
		expect(f.last).toBe('2026-10-19T11:00:00.000Z');
	});
});

describe('ranges', () => {
	it('presets', () => {
		expect(presetRange('w4', '2026-10-23')).toEqual({ from: '2026-09-28', to: '2026-10-23' });
		expect(presetRange('year', '2026-10-23')).toEqual({ from: '2026-01-01', to: '2026-10-23' });
		expect(clockText(485)).toBe('8:05');
	});
});
