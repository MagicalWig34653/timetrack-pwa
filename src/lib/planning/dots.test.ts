import { describe, expect, it } from 'vitest';
import type { DayInfo } from './calendar';
import { dotsOf } from './dots';

const info = (extra: Partial<DayInfo>): DayInfo => ({ date: '2026-12-24', holidays: [], schoolHolidays: [], absences: [], plan: null, evaluation: null, ...extra }) as DayInfo;

describe('dotsOf', () => {
	it('lists holidays, absences, plan and worked time in order; planned vacation is hollow', () => {
		const dots = dotsOf(
			info({
				holidays: [{ startDate: '2026-12-24', endDate: '2026-12-24', name: 'Heiligabend', kind: 'holiday', source: 'builtin' }],
				absences: [{ id: 'a', kind: 'vacation', status: 'planned' }, { id: 'b', kind: 'sick', status: 'approved' }] as DayInfo['absences'],
				plan: { mode: 'office' } as DayInfo['plan'],
				evaluation: { evaluatedWorkSeconds: 3600 } as DayInfo['evaluation']
			})
		);
		expect(dots.map((d) => d.kind)).toEqual(['holiday', 'vacation', 'sick', 'plan', 'worked']);
		expect(dots[1].hollow).toBe(true);
		expect(dots[2].hollow).toBe(false);
	});
	it('draws a half company day as a hollow holiday dot', () => {
		const half = { startDate: '2026-12-24', endDate: '2026-12-24', name: 'Heiligabend', kind: 'holiday', source: 'builtin', companyTreatment: 'half' } as const;
		expect(dotsOf(info({ holidays: [half] }))[0]).toMatchObject({ kind: 'holiday', hollow: true });
		expect(dotsOf(info({ holidays: [{ ...half, companyTreatment: 'full' }] }))[0].hollow).toBe(false);
	});
	it('respects legend filters', () => {
		const dots = dotsOf(info({ holidays: [{ startDate: '', endDate: '', name: 'X', kind: 'holiday', source: 'builtin' }] }), new Set(['holiday']));
		expect(dots).toEqual([]);
	});
});
