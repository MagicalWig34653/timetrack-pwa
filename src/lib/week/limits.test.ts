import { describe, expect, it } from 'vitest';
import type { PlanWeekDay } from '#lib/api/types.js';
import { ADULT_PROFILE, requiredBreak, weekIssues } from './limits.js';
import { emptyDraft, type DayDraft } from './plan-draft.js';

const date = (i: number) => `2026-10-${26 + i}`;
const days = (blocked: Record<number, PlanWeekDay['blockedBy']> = {}): PlanWeekDay[] =>
	Array.from({ length: 7 }, (_, i) => ({ date: date(i), weekday: i + 1, targetSeconds: i < 5 ? 27_720 : 0, plannedSeconds: null, blockedBy: blocked[i] ?? null, plan: null }));
const week = (over: Record<number, Partial<DayDraft>> = {}): DayDraft[] => Array.from({ length: 7 }, (_, i) => ({ ...emptyDraft(date(i)), ...over[i] }));
const block = (start: string, end: string, breakMinutes: number): Partial<DayDraft> => ({ mode: 'office', blocks: [{ start, end, kind: 'office', placeId: null, note: '' }], breakMinutes });
const blk = (start: string, end: string, kind: DayDraft['blocks'][number]['kind'] = 'work') => ({ start, end, kind, placeId: null, note: '' });

describe('requiredBreak', () => {
	it('follows the thresholds of the adult profile', () => {
		expect(requiredBreak(6 * 60)).toBe(0);
		expect(requiredBreak(6 * 60 + 1)).toBe(30);
		expect(requiredBreak(9 * 60)).toBe(30);
		expect(requiredBreak(9 * 60 + 1)).toBe(45);
	});
	it('uses the selected minor profile thresholds', () => {
		const minor = { ...ADULT_PROFILE, id: 'jarbschg-minor-de' as const, maxDailySeconds: 8 * 3600, maxWeeklySeconds: 40 * 3600, maxWorkdaysPerWeek: 5, minimumRestSeconds: 12 * 3600, breakRules: [{ afterSeconds: 6 * 3600, requiredSeconds: 3600 }, { afterSeconds: 4.5 * 3600, requiredSeconds: 1800 }] };
		expect(requiredBreak(5 * 60, minor)).toBe(30);
		expect(requiredBreak(7 * 60, { ...minor, breakRules: [...minor.breakRules].reverse() })).toBe(60);
		const issues = weekIssues(days(), week({ 0: block('08:00', '17:00', 30), 1: block('04:00', '13:00', 30) }), () => minor);
		expect(issues).toContainEqual({ date: date(0), kind: 'daily_max', severity: 'warn', value: 8.5 * 60 });
		expect(issues).toContainEqual({ date: date(0), kind: 'break_short', severity: 'warn', value: 30 });
		expect(issues).toContainEqual({ date: date(1), kind: 'rest_short', severity: 'warn', value: 11 * 60 });
		const weekend = weekIssues(days(), week({ 5: block('08:00', '12:00', 0) }), () => ({ ...minor, restrictedWeekdays: [6, 7] }));
		expect(weekend).toContainEqual({ date: date(5), kind: 'weekend_work', severity: 'warn' });
	});
});

describe('weekIssues', () => {
	it('is quiet for a normal week', () => {
		expect(weekIssues(days(), week({ 0: block('08:00', '16:30', 30), 1: block('08:00', '16:30', 30) }))).toEqual([]);
	});
	it('flags over ten hours net and a missing break', () => {
		const issues = weekIssues(days(), week({ 0: block('06:00', '18:30', 30), 1: block('08:00', '15:00', 0) }));
		expect(issues).toContainEqual({ date: date(0), kind: 'daily_max', severity: 'warn', value: 12 * 60 });
		expect(issues).toContainEqual({ date: date(0), kind: 'break_short', severity: 'warn', value: 15 });
		expect(issues).toContainEqual({ date: date(1), kind: 'break_short', severity: 'warn', value: 30 });
	});
	it('flags a short rest between consecutive days only', () => {
		const issues = weekIssues(days(), week({ 0: block('12:00', '22:00', 30), 1: block('07:00', '11:00', 0), 3: block('07:00', '11:00', 0) }));
		expect(issues.filter((i) => i.kind === 'rest_short')).toEqual([{ date: date(1), kind: 'rest_short', severity: 'warn', value: 9 * 60 }]);
	});
	it('ignores blocked days and notes work on a non-working day', () => {
		const issues = weekIssues(days({ 0: 'holiday' }), week({ 0: block('00:00', '23:00', 0), 5: block('08:00', '10:00', 0) }));
		expect(issues).toEqual([{ date: date(5), kind: 'non_working', severity: 'info' }]);
	});
});

describe('weekIssues with block lists', () => {
	const adult = (blocks: DayDraft['blocks']) => week({ 0: { mode: 'office', blocks } });
	it('counts the sum of the blocks as net time and the gaps as breaks', () => {
		const issues = weekIssues(days(), adult([blk('06:00', '12:00'), blk('12:30', '18:30')]), () => ADULT_PROFILE, true);
		expect(issues).toContainEqual({ date: date(0), kind: 'daily_max', severity: 'warn', value: 12 * 60 });
	});
	it('leaves the adult break rule to the planning hints, other profiles keep break_short', () => {
		const blocks = [blk('08:00', '16:30')];
		expect(weekIssues(days(), adult(blocks), () => ADULT_PROFILE, true).some((i) => i.kind === 'break_short')).toBe(false);
		const minor = { ...ADULT_PROFILE, id: 'jarbschg-minor-de' as const, breakRules: [{ afterSeconds: 4.5 * 3600, requiredSeconds: 1800 }] };
		expect(weekIssues(days(), adult(blocks), () => minor, true)).toContainEqual({ date: date(0), kind: 'break_short', severity: 'warn', value: 30 });
	});
	it('does not count school time as working time for the break rule and the weekend rule', () => {
		const minor = { ...ADULT_PROFILE, id: 'jarbschg-minor-de' as const, breakRules: [{ afterSeconds: 4.5 * 3600, requiredSeconds: 1800 }], restrictedWeekdays: [1] };
		const schoolOnly = weekIssues(days(), adult([blk('08:00', '15:00', 'school')]), () => minor, true);
		expect(schoolOnly.some((i) => i.kind === 'break_short' || i.kind === 'weekend_work')).toBe(false);
	});
	it('takes the first start and the last end of the blocks for the rest time', () => {
		const week2 = week({ 0: { mode: 'office', blocks: [blk('08:00', '12:00'), blk('18:00', '22:00')] }, 1: { mode: 'office', blocks: [blk('06:00', '10:00')] } });
		expect(weekIssues(days(), week2, () => ADULT_PROFILE, true)).toContainEqual({ date: date(1), kind: 'rest_short', severity: 'warn', value: 8 * 60 });
	});
});
