import { describe, expect, it } from 'vitest';
import type { StatisticsBucket, TimeStatistics } from '#lib/api/types.js';
import { fromStatistics } from './source.js';

const bucket = (from: string, to: string, extra: Partial<StatisticsBucket> = {}): StatisticsBucket => ({
	label: from, from, to, days: 7, targetSeconds: 100, targetToDateSeconds: 100, actualSeconds: 90, creditSeconds: 10, evaluatedWorkSeconds: 90, rawWorkSeconds: 85, roundingSeconds: 5,
	deltaSeconds: 0, overtimeSeconds: 0, undertimeSeconds: 0, balanceSeconds: null, balanceAsOf: null, kindSeconds: { work: 80, school: 5, travel: 5 },
	absences: { vacation: 1, sick: 0.5, excused: 0, holiday: 0, school: 0 }, absenceDays: 1.5, breakSeconds: 30, breakDeductionSeconds: 0, workDays: 5, provisional: false, ...extra
});
const stats = (buckets: StatisticsBucket[]): TimeStatistics => ({
	from: '2026-10-05', to: '2026-10-25', granularity: 'week', basis: 'evaluated', timezone: 'Europe/Berlin', openingBalanceSeconds: 50, buckets,
	totals: { targetSeconds: 300, targetToDateSeconds: 200, actualSeconds: 180, creditSeconds: 20, deltaSeconds: 0, overtimeSeconds: 0, undertimeSeconds: 0, breakSeconds: 60, breakDeductionSeconds: 0, kindSeconds: { work: 160, school: 10, travel: 10 }, absenceDays: 3 }
});

describe('fromStatistics', () => {
	it('maps buckets, carries the balance over gaps and drops future buckets', () => {
		const s = stats([bucket('2026-10-05', '2026-10-11', { balanceSeconds: 70 }), bucket('2026-10-12', '2026-10-18'), bucket('2026-10-19', '2026-10-25')]);
		const data = fromStatistics(s, s, '2026-10-14');
		expect(data.points.map((p) => p.key)).toEqual(['2026-10-05', '2026-10-12']);
		expect(data.points[0]).toMatchObject({ actualSeconds: 100, targetSeconds: 100, balanceSeconds: 70, vacationDays: 1, sickDays: 0.5, workSeconds: 80, breakSeconds: 30 });
		expect(data.points[1].balanceSeconds).toBe(70);
		expect(data.totals).toMatchObject({ actualSeconds: 200, targetSeconds: 200, absenceDays: 3 });
		expect(data.empty).toBe(false);
		expect(data.openingBalanceSeconds).toBe(50);
	});
	it('is empty without Soll and time', () => {
		const s = stats([bucket('2026-10-05', '2026-10-11')]);
		s.totals.targetToDateSeconds = 0;
		s.totals.actualSeconds = 0;
		s.totals.creditSeconds = 0;
		expect(fromStatistics(s, s, '2026-10-30').empty).toBe(true);
	});
});
