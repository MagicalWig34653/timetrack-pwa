import { describe, expect, it } from 'vitest';
import type { PlanWeek, PlanWeekDay, TimeWeekSummary } from '#lib/api/types.js';
import {
	blocksFromWindow,
	blocksProblem,
	breakMinutesOf,
	clearWeek,
	copyWeek,
	type DayDraft,
	type DraftBlock,
	draftFromDay,
	draftProblem,
	emptyDraft,
	entryFromDraft,
	fallbackWindow,
	formatClock,
	parseClock,
	planHintsOf,
	planHintsOfDay,
	plannedSecondsOf,
	sameForWorkdays,
	standardWeek,
	suggestWindow,
	weekRequest,
	weekTotals,
	withMode
} from './plan-draft.js';

const MONDAY = '2026-10-26';
const blk = (start: string, end: string, kind: DraftBlock['kind'] = 'office', extra: Partial<DraftBlock> = {}): DraftBlock => ({ start, end, kind, placeId: null, note: '', ...extra });
/** a day with one window, like a plan of an older server */
const win = (mode: DayDraft['mode'], start: string, end: string, breakMinutes = 0, extra: Partial<DayDraft> = {}): DayDraft => ({ ...emptyDraft(MONDAY), mode, blocks: mode === '' || mode === 'off' ? [] : [blk(start, end, mode)], breakMinutes, ...extra });
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
	const base = win('office', '08:00', '16:30', 30);
	it('is end - start - break (legacy window)', () => expect(plannedSecondsOf(base)).toBe(8 * 3600));
	it('is never negative', () => expect(plannedSecondsOf(win('office', '08:00', '08:30', 60))).toBe(0));
	it('is the sum of the block durations with block lists, gaps do not count', () => {
		const split: DayDraft = { ...base, breakMinutes: 0, blocks: [blk('08:00', '12:00', 'school'), blk('13:00', '17:00', 'work')] };
		expect(plannedSecondsOf(split)).toBe(8 * 3600);
		expect(breakMinutesOf(split)).toBe(60);
	});
	it('is null without usable times, for off and for unplanned', () => {
		expect(plannedSecondsOf(win('office', '08:00', '07:00'))).toBeNull();
		expect(plannedSecondsOf({ ...base, blocks: [blk('', '12:00')] })).toBeNull();
		expect(plannedSecondsOf({ ...base, mode: 'off' })).toBeNull();
		expect(plannedSecondsOf({ ...base, mode: '' })).toBeNull();
	});
	it('reports the reason a row cannot be saved', () => {
		expect(draftProblem(base)).toBeNull();
		expect(draftProblem(win('office', '08:00', '07:00'))).toBe('end_before_start');
		expect(draftProblem({ ...base, blocks: [blk('08:00', '')] })).toBe('times_required');
		expect(draftProblem({ ...base, breakMinutes: 601 })).toBe('break_invalid');
		expect(draftProblem({ ...base, blocks: [], breakMinutes: 0 })).toBeNull();
		expect(draftProblem({ ...win('off', '08:00', '07:00'), blocks: [blk('08:00', '07:00')] })).toBeNull();
	});
	it('rejects overlapping blocks and too many blocks, lets a shared boundary and gaps pass', () => {
		expect(blocksProblem([blk('08:00', '12:00'), blk('12:00', '16:00')])).toBeNull();
		expect(blocksProblem([blk('08:00', '12:00'), blk('13:00', '16:00')])).toBeNull();
		expect(blocksProblem([blk('08:00', '12:01'), blk('12:00', '16:00')])).toBe('blocks_overlap');
		// the order in the list does not matter, only the times
		expect(blocksProblem([blk('13:00', '16:00'), blk('08:00', '12:00')])).toBeNull();
		expect(blocksProblem(Array.from({ length: 33 }, (_, i) => blk(`${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, `${String(Math.floor((i + 1) / 2)).padStart(2, '0')}:${(i + 1) % 2 ? '30' : '00'}`)))).toBe('too_many_blocks');
		expect(blocksProblem([blk('08:00', '09:00', 'work', { note: 'x'.repeat(201) })])).toBe('note_too_long');
	});
	it('splits a window with a break into two blocks around a gap, like the server', () => {
		expect(blocksFromWindow(480, 990, 30, 'office')).toEqual([blk('08:00', '12:00'), blk('12:30', '16:30')]);
		expect(blocksFromWindow(480, 720, 0, 'school')).toEqual([blk('08:00', '12:00', 'school')]);
	});
});

describe('planning hints of a block list (mirror of the backend rule)', () => {
	it('is quiet for a normal day with a half hour break', () => {
		expect(planHintsOf([blk('08:00', '12:00'), blk('12:30', '16:30')])).toEqual([]);
	});
	it('flags a missing break and a long stretch', () => {
		expect(planHintsOf([blk('08:00', '16:30')])).toEqual(['planned_break_short', 'planned_work_stretch_long']);
	});
	it('does not count school as work and counts only gaps of 15 minutes as breaks', () => {
		expect(planHintsOf([blk('08:00', '13:00', 'school'), blk('13:00', '17:00', 'work')])).toEqual([]);
		expect(planHintsOf([blk('08:00', '12:00'), blk('12:10', '17:00')])).toEqual(['planned_break_short', 'planned_work_stretch_long', 'planned_break_part_short']);
		expect(planHintsOf([blk('08:00', '11:00'), blk('11:10', '14:00')])).toEqual(['planned_break_part_short']);
	});
	it('needs 45 minutes of break above nine hours of work', () => {
		expect(planHintsOf([blk('06:00', '11:00'), blk('11:30', '16:30')])).toEqual(['planned_break_short']);
		expect(planHintsOf([blk('06:00', '11:00'), blk('11:45', '16:45')])).toEqual([]);
	});
	it('judges a legacy window with its break as two blocks', () => {
		expect(planHintsOfDay(win('office', '08:00', '16:30', 30))).toEqual([]);
		expect(planHintsOfDay(win('office', '08:00', '16:30', 0))).toEqual(['planned_break_short', 'planned_work_stretch_long']);
		expect(planHintsOfDay(win('off', '', ''))).toEqual([]);
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
		const filled = withMode(emptyDraft(MONDAY), 'home', history, 27_720, false);
		expect(filled).toMatchObject({ mode: 'home', blocks: [{ start: '08:00', end: '16:45', kind: 'home' }], breakMinutes: 45 });
		expect(withMode(filled, 'off', history, 27_720, false)).toMatchObject({ mode: 'off', blocks: [], breakMinutes: 0 });
		expect(withMode({ ...filled, blocks: [blk('09:00', '17:00', 'home')] }, 'customer', history, 27_720, false)).toMatchObject({ mode: 'customer', blocks: [{ start: '09:00', end: '17:00', kind: 'customer' }] });
	});
	it('with block lists the prefill has a gap and a mode change keeps the kinds of the blocks', () => {
		const filled = withMode(emptyDraft(MONDAY), 'home', history, 27_720, true);
		expect(filled.breakMinutes).toBe(0);
		expect(filled.blocks).toHaveLength(2);
		expect(breakMinutesOf(filled)).toBe(45);
		const changed = withMode({ ...filled, blocks: [blk('08:00', '12:00', 'school'), blk('13:00', '17:00', 'work')] }, 'customer', history, 27_720, true);
		expect(changed.mode).toBe('customer');
		expect(changed.blocks.map((b) => b.kind)).toEqual(['school', 'work']);
	});
});

describe('quick actions', () => {
	const days = week({ 2: { blockedBy: 'vacation', plan: { date: date(2), mode: 'office', plannedStart: '08:00', plannedEnd: '12:00' } } });
	const fallback = fallbackWindow(27_720);
	it('standard week plans every unblocked workday and leaves blocked days alone', () => {
		const drafts = standardWeek(days, days.map(draftFromDay), fallback, false);
		expect(drafts.map((d) => d.mode)).toEqual(['office', 'office', 'office', 'office', 'office', '', '']);
		expect(drafts[2].blocks).toMatchObject([{ start: '08:00', end: '12:00' }]); // untouched stored plan of the blocked day
		expect(drafts[0]).toMatchObject({ blocks: [{ start: '08:00', end: '16:15' }], breakMinutes: 30 });
		// with block lists the break is a gap between two blocks
		expect(standardWeek(days, days.map(draftFromDay), fallback, true)[0]).toMatchObject({ breakMinutes: 0, blocks: [{ start: '08:00', end: '11:55' }, { start: '12:25', end: '16:15' }] });
	});
	it('same-for-workdays copies the first planned day onto the other workdays', () => {
		const start = empty(days);
		start[0] = { ...start[0], mode: 'customer', blocks: [blk('07:00', '15:30', 'customer')], breakMinutes: 30, note: 'bleibt' };
		start[1] = { ...start[1], note: 'Notiz' };
		const result = sameForWorkdays(days, start);
		expect(result.map((d) => d.mode)).toEqual(['customer', 'customer', '', 'customer', 'customer', '', '']);
		expect(result[1]).toMatchObject({ blocks: [{ start: '07:00', end: '15:30' }], note: 'Notiz' });
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
		expect(drafts[0]).toMatchObject({ date: date(0), mode: 'home', blocks: [{ start: '09:00', end: '17:00', kind: 'home' }], breakMinutes: 60 });
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
		const drafts = standardWeek(week(), empty(days), fallbackWindow(27_720), false);
		const totals = weekTotals(days, drafts);
		expect(totals.targetSeconds).toBe(4 * 27_720);
		expect(totals.plannedSeconds).toBe(4 * 27_900); // 08:00-16:15 minus 30 min = 7:45 per day, blocked day does not count
		expect(totals.differenceSeconds).toBe(totals.plannedSeconds - totals.targetSeconds);
	});
	it('builds a replacing request with planned rows only, times only for working modes', () => {
		const drafts = empty(days);
		drafts[0] = { ...drafts[0], mode: 'office', blocks: [blk('08:00', '16:00')], breakMinutes: 30, note: ' Büro ' };
		drafts[1] = { ...drafts[1], mode: 'off', blocks: [blk('08:00', '16:00')] };
		drafts[3] = { ...drafts[3], mode: 'home' };
		expect(weekRequest(drafts, false)).toEqual({
			replace: true,
			days: [
				{ date: date(0), mode: 'office', placeId: null, note: 'Büro', plannedStart: '08:00', plannedEnd: '16:00', plannedBreakMinutes: 30 },
				{ date: date(1), mode: 'off', placeId: null, note: null },
				{ date: date(3), mode: 'home', placeId: null, note: null }
			]
		});
		expect(entryFromDraft(emptyDraft(MONDAY))).toBeNull();
	});
	it('sends the full block list with block lists (chronological), none for a free day', () => {
		const drafts = empty(days);
		drafts[0] = { ...drafts[0], mode: 'office', blocks: [blk('13:00', '17:00', 'work', { note: ' Kundentermin ' }), blk('08:00', '12:00', 'school', { placeId: 'p1' })], note: 'Tag' };
		drafts[1] = { ...drafts[1], mode: 'off', blocks: [blk('08:00', '16:00')] };
		drafts[3] = { ...drafts[3], mode: 'home' };
		expect(weekRequest(drafts, true)).toEqual({
			replace: true,
			days: [
				{
					date: date(0),
					mode: 'office',
					placeId: null,
					note: 'Tag',
					blocks: [
						{ start: '08:00', end: '12:00', kind: 'school', placeId: 'p1', note: null },
						{ start: '13:00', end: '17:00', kind: 'work', placeId: null, note: 'Kundentermin' }
					]
				},
				{ date: date(1), mode: 'off', placeId: null, note: null, blocks: [] },
				{ date: date(3), mode: 'home', placeId: null, note: null, blocks: [] }
			]
		});
	});
	it('reads blocks from a plan day and falls back to the window of an older server', () => {
		const withBlocks = day(0, { plan: { date: date(0), mode: 'office', blocks: [{ start: '08:00', end: '12:00', kind: 'school', placeId: null, note: 'Mathe' }, { start: '13:00', end: '17:00', kind: 'work' }], plannedStart: '08:00', plannedEnd: '17:00', plannedBreakMinutes: 60 } });
		expect(draftFromDay(withBlocks)).toMatchObject({ breakMinutes: 0, blocks: [{ kind: 'school', note: 'Mathe' }, { kind: 'work', note: '' }] });
		const legacy = day(0, { plan: { date: date(0), mode: 'home', plannedStart: '08:00', plannedEnd: '16:00', plannedBreakMinutes: 30, placeId: 'q' } });
		expect(draftFromDay(legacy)).toMatchObject({ mode: 'home', breakMinutes: 30, blocks: [{ start: '08:00', end: '16:00', kind: 'home', placeId: 'q' }] });
		const off = day(0, { plan: { date: date(0), mode: 'off', plannedStart: null, plannedEnd: null } });
		expect(draftFromDay(off).blocks).toEqual([]);
	});
});
