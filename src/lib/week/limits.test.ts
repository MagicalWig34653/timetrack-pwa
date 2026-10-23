import { describe, expect, it } from 'vitest';
import type { PlanWeekDay } from '#lib/api/types.js';
import { requiredBreak, weekIssues } from './limits.js';
import { emptyDraft, type DayDraft } from './plan-draft.js';

const date = (i: number) => `2026-10-${26 + i}`;
const days = (blocked: Record<number, PlanWeekDay['blockedBy']> = {}): PlanWeekDay[] =>
	Array.from({ length: 7 }, (_, i) => ({ date: date(i), weekday: i + 1, targetSeconds: i < 5 ? 27_720 : 0, plannedSeconds: null, blockedBy: blocked[i] ?? null, plan: null }));
const week = (over: Record<number, Partial<DayDraft>> = {}): DayDraft[] => Array.from({ length: 7 }, (_, i) => ({ ...emptyDraft(date(i)), ...over[i] }));
const block = (start: string, end: string, breakMinutes: number): Partial<DayDraft> => ({ mode: 'office', start, end, breakMinutes });

describe('requiredBreak', () => {
	it('follows the thresholds of the adult profile', () => {
		expect(requiredBreak(6 * 60)).toBe(0);
		expect(requiredBreak(6 * 60 + 1)).toBe(30);
		expect(requiredBreak(9 * 60)).toBe(30);
		expect(requiredBreak(9 * 60 + 1)).toBe(45);
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
