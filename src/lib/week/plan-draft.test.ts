import { describe, expect, it } from 'vitest';
import type { PlanWeek, PlanWeekDay, TimeWeekSummary } from '#lib/api/types.js';
import {
	clearWeek,
	copyWeek,
	type DayDraft,
	draftFromDay,
	draftProblem,
	emptyDraft,
	entryFromDraft,
	fallbackWindow,
	formatClock,
	parseClock,
	plannedSecondsOf,
	sameForWorkdays,
	standardWeek,
	suggestWindow,
	weekRequest,
	weekTotals,
	withMode
} from './plan-draft.js';

const MONDAY = '2026-10-26';
const date = (i: number) => `2026-10-${26 + i}`;
const day = (i: number, extra: Partial<PlanWeekDay> = {}): PlanWeekDay => ({
	date: date(i),
	weekday: i + 1,
	targetSeconds: i < 5 ? 27_720 : 0,
	plannedSeconds: null,
	blockedBy: null,
	plan: null,
	...extra
});
const week = (overrides: Record<number, Partial<PlanWeekDay>> = {}) => Array.from({ length: 7 }, (_, i) => day(i, overrides[i]));
const empty = (days: PlanWeekDay[]) => days.map((d) => emptyDraft(d.date));
const summary = (extra: Partial<TimeWeekSummary> = {}): TimeWeekSummary => ({
	targetSeconds: 138_600, targetToDateSeconds: 138_600, workSeconds: 138_600, creditSeconds: 0, balanceSeconds: 0, plannedSeconds: null,
	accountBalanceBeforeSeconds: 0, accountBalanceAfterSeconds: 0, accountBalanceAsOf: MONDAY, vacationDays: 0, sickDays: 0, schoolDays: 0, holidayDays: 0,
	workDays: 5, travelSeconds: 0, breakSeconds: 5 * 2700, averageStart: '08:07', averageEnd: '16:41', longestDay: null, provisional: false, ...extra
});

describe('clock helpers', () => {
	it('parses strict HH:mm only', () => {
		expect(parseClock('08:15')).toBe(495);
		expect(parseClock('8:15')).toBeNull();
		expect(parseClock('24:00')).toBeNull();
		expect(parseClock('08:60')).toBeNull();
		expect(formatClock(495)).toBe('08:15');
	});
});

describe('planned seconds of a draft (mirrors the server rule)', () => {
	const base: DayDraft = { ...emptyDraft(MONDAY), mode: 'office', start: '08:00', end: '16:30', breakMinutes: 30 };
	it('is end - start - break', () => expect(plannedSecondsOf(base)).toBe(8 * 3600));
	it('is never negative', () => expect(plannedSecondsOf({ ...base, end: '08:30', breakMinutes: 60 })).toBe(0));
	it('is null without usable times, for off and for unplanned', () => {
		expect(plannedSecondsOf({ ...base, end: '07:00' })).toBeNull();
		expect(plannedSecondsOf({ ...base, start: '' })).toBeNull();
		expect(plannedSecondsOf({ ...base, mode: 'off' })).toBeNull();
		expect(plannedSecondsOf({ ...base, mode: '' })).toBeNull();
	});
	it('reports the reason a row cannot be saved', () => {
		expect(draftProblem(base)).toBeNull();
		expect(draftProblem({ ...base, end: '07:00' })).toBe('end_before_start');
		expect(draftProblem({ ...base, end: '' })).toBe('times_required');
		expect(draftProblem({ ...base, breakMinutes: 601 })).toBe('break_invalid');
		expect(draftProblem({ ...base, start: '', end: '', breakMinutes: 0 })).toBeNull();
		expect(draftProblem({ ...base, mode: 'off', end: '07:00' })).toBeNull();
	});
});

describe('suggested working window', () => {
	it('averages the last weeks rounded to 15 minutes and takes the usual break', () => {
		const suggestion = suggestWindow([summary(), summary({ averageStart: '08:25', averageEnd: '17:05' })], 27_720);
		expect(suggestion).toEqual({ start: '08:15', end: '17:00', breakMinutes: 45, source: 'history' });
	});
	it('uses a half hour break when the gaps were not real breaks', () => {
		expect(suggestWindow([summary({ breakSeconds: 600 })], 27_720).breakMinutes).toBe(30);
	});
	it('ignores weeks without work and falls back to 08:00 plus the target', () => {
		const suggestion = suggestWindow([summary({ workDays: 0, averageStart: null, averageEnd: null })], 27_720);
		expect(suggestion).toEqual({ start: '08:00', end: '16:15', breakMinutes: 30, source: 'fallback' });
		expect(fallbackWindow(4 * 3600)).toMatchObject({ start: '08:00', end: '12:00', breakMinutes: 0 });
	});
});

describe('editing a day', () => {
	const history = suggestWindow([summary()], 27_720);
	it('prefills times when a working mode is chosen and clears them for off', () => {
		const filled = withMode(emptyDraft(MONDAY), 'home', history, 27_720);
		expect(filled).toMatchObject({ mode: 'home', start: '08:00', end: '16:45' });
		expect(withMode(filled, 'off', history, 27_720)).toMatchObject({ mode: 'off', start: '', end: '', breakMinutes: 0 });
		expect(withMode({ ...filled, start: '09:00', end: '17:00' }, 'customer', history, 27_720)).toMatchObject({ mode: 'customer', start: '09:00', end: '17:00' });
	});
});

describe('quick actions', () => {
	const days = week({ 2: { blockedBy: 'vacation', plan: { date: date(2), mode: 'office', plannedStart: '08:00', plannedEnd: '12:00' } } });
	const fallback = fallbackWindow(27_720);
	it('standard week plans every unblocked workday and leaves blocked days alone', () => {
		const drafts = standardWeek(days, days.map(draftFromDay), fallback);
		expect(drafts.map((d) => d.mode)).toEqual(['office', 'office', 'office', 'office', 'office', '', '']);
		expect(drafts[2]).toMatchObject({ start: '08:00', end: '12:00' }); // untouched stored plan of the blocked day
		expect(drafts[0]).toMatchObject({ start: '08:00', end: '16:15', breakMinutes: 30 });
	});
	it('same-for-workdays copies the first planned day onto the other workdays', () => {
		const start = empty(days);
		start[0] = { ...start[0], mode: 'customer', start: '07:00', end: '15:30', breakMinutes: 30, note: 'bleibt' };
		start[1] = { ...start[1], note: 'Notiz' };
		const result = sameForWorkdays(days, start);
		expect(result.map((d) => d.mode)).toEqual(['customer', 'customer', '', 'customer', 'customer', '', '']);
		expect(result[1]).toMatchObject({ start: '07:00', end: '15:30', note: 'Notiz' });
		expect(result[5].mode).toBe('');
	});
	it('same-for-workdays does nothing when no day is planned', () => {
		expect(sameForWorkdays(days, empty(days))).toEqual(empty(days));
	});
	it('copies the last week day by day and keeps blocked days', () => {
		const previous: PlanWeek = {
			week: '2026-W43', from: '2026-10-19', to: '2026-10-25', totals: { targetSeconds: 0, plannedSeconds: 0, differenceSeconds: 0 },
			days: week({ 0: { plan: { date: '2026-10-19', mode: 'home', plannedStart: '09:00', plannedEnd: '17:00', plannedBreakMinutes: 60, note: 'x', placeId: null } } })
		};
		const drafts = copyWeek(previous, days, empty(days));
		expect(drafts[0]).toMatchObject({ date: date(0), mode: 'home', start: '09:00', breakMinutes: 60 });
		expect(drafts[1].mode).toBe('');
		expect(drafts[2]).toEqual(emptyDraft(date(2)));
	});
	it('clears everything except blocked days', () => {
		const filled = standardWeek(days, days.map(draftFromDay), fallback);
		const cleared = clearWeek(days, filled);
		expect(cleared.filter((d) => d.mode !== '').map((d) => d.date)).toEqual([date(2)]);
	});
});

describe('totals and request', () => {
	const days = week({ 2: { blockedBy: 'holiday', targetSeconds: 0 } });
	it('sums planned hours of unblocked days against the server target', () => {
		const drafts = standardWeek(week(), empty(days), fallbackWindow(27_720));
		const totals = weekTotals(days, drafts);
		expect(totals.targetSeconds).toBe(4 * 27_720);
		expect(totals.plannedSeconds).toBe(4 * 27_900); // 08:00-16:15 minus 30 min = 7:45 per day, blocked day does not count
		expect(totals.differenceSeconds).toBe(totals.plannedSeconds - totals.targetSeconds);
	});
	it('builds a replacing request with planned rows only, times only for working modes', () => {
		const drafts = empty(days);
		drafts[0] = { ...drafts[0], mode: 'office', start: '08:00', end: '16:00', breakMinutes: 30, note: ' Büro ' };
		drafts[1] = { ...drafts[1], mode: 'off', start: '08:00', end: '16:00' };
		drafts[3] = { ...drafts[3], mode: 'home' };
		expect(weekRequest(drafts)).toEqual({
			replace: true,
			days: [
				{ date: date(0), mode: 'office', placeId: null, note: 'Büro', plannedStart: '08:00', plannedEnd: '16:00', plannedBreakMinutes: 30 },
				{ date: date(1), mode: 'off', placeId: null, note: null },
				{ date: date(3), mode: 'home', placeId: null, note: null }
			]
		});
		expect(entryFromDraft(emptyDraft(MONDAY))).toBeNull();
	});
});
