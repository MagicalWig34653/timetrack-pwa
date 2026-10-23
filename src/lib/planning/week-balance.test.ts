import { describe, expect, it } from 'vitest';
import type { DayEvaluation } from '#lib/api/types.js';
import { weekBalance, weekBalanceTone } from './week-balance.js';

const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const day = (date: string, target: number, worked: number, credit = 0): DayEvaluation =>
	({ date, targetSeconds: target, evaluatedWorkSeconds: worked, creditSeconds: credit, deltaSeconds: worked + credit - target, rawWorkSeconds: worked, breakDeductionSeconds: 0, startAdjustSeconds: 0, endAdjustSeconds: 0, provisional: false, segmentIds: [], breakHints: [] }) as DayEvaluation;
const evaluations = (target: number, worked: number) => WEEK.map((d, i) => day(d, i < 5 ? target : 0, i < 5 ? worked : 0));

describe('weekBalance', () => {
	it('is the final difference of a completed week', () => {
		const result = weekBalance(WEEK, evaluations(27720, 29760), '2026-10-20');
		expect(result).toEqual({ state: 'done', targetSeconds: 138600, actualSeconds: 148800, deltaSeconds: 10200 });
		expect(weekBalanceTone(result!)).toBe('positive');
	});
	it('warns only for a completed week under Soll', () => {
		const done = weekBalance(WEEK, evaluations(27720, 25000), '2026-10-20')!;
		expect(weekBalanceTone(done)).toBe('warning');
		const open = weekBalance(WEEK, evaluations(27720, 25000), '2026-10-14')!;
		expect(open.state).toBe('open');
		expect(weekBalanceTone(open)).toBe('neutral');
	});
	it('treats the running week as open until Sunday is over', () => {
		expect(weekBalance(WEEK, evaluations(27720, 0), '2026-10-18')!.state).toBe('open');
		expect(weekBalance(WEEK, evaluations(27720, 0), '2026-10-19')!.state).toBe('done');
	});
	it('is null for uncovered weeks and weeks without Soll and time', () => {
		expect(weekBalance(WEEK, evaluations(1, 1).slice(0, 6), '2026-10-20')).toBeNull();
		expect(weekBalance(WEEK, WEEK.map((d) => day(d, 0, 0)), '2026-10-20')).toBeNull();
		expect(weekBalance([], [], '2026-10-20')).toBeNull();
	});
	it('counts credits as time', () => {
		const days = WEEK.map((d, i) => day(d, i < 5 ? 28800 : 0, 0, i < 5 ? 28800 : 0));
		expect(weekBalance(WEEK, days, '2026-10-30')!.deltaSeconds).toBe(0);
	});
});
