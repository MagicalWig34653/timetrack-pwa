import { describe, expect, it } from 'vitest';
import type { PlanWeekDay } from '#lib/api/types.js';
import { copyClip, copyToDates, defaultBreak, eraseDays, moveBlocks, paintDays, pasteClip, rangeOf, resizeBlock, setBreakOn, setModeOn, type Brush } from './grid-edit.js';
import { emptyDraft, type DayDraft } from './plan-draft.js';

const date = (i: number) => `2026-10-${26 + i}`;
const days = (blocked: Record<number, PlanWeekDay['blockedBy']> = {}): PlanWeekDay[] =>
	Array.from({ length: 7 }, (_, i) => ({ date: date(i), weekday: i + 1, targetSeconds: i < 5 ? 27_720 : 0, plannedSeconds: null, blockedBy: blocked[i] ?? null, plan: null }));
const week = (over: Record<number, Partial<DayDraft>> = {}): DayDraft[] => Array.from({ length: 7 }, (_, i) => ({ ...emptyDraft(date(i)), ...over[i] }));
const office = (start: string, end: string, extra: Partial<DayDraft> = {}): Partial<DayDraft> => ({ mode: 'office', start, end, breakMinutes: 30, ...extra });
const brush: Brush = { mode: 'home', placeId: null, breakMinutes: null };

describe('rangeOf', () => {
	it('is null for unplanned, off and time-less plans', () => {
		expect(rangeOf(emptyDraft(date(0)))).toBeNull();
		expect(rangeOf({ ...emptyDraft(date(0)), mode: 'off' })).toBeNull();
		expect(rangeOf({ ...emptyDraft(date(0)), mode: 'office' })).toBeNull();
		expect(rangeOf({ ...emptyDraft(date(0)), ...office('08:00', '16:30') })).toEqual({ start: 480, end: 990 });
	});
});

describe('paintDays', () => {
	it('paints the same range on several days with the automatic break', () => {
		const r = paintDays(week(), days(), [date(0), date(1)], { start: 480, end: 990 }, brush);
		expect(r.touched).toEqual([date(0), date(1)]);
		expect(r.drafts[0]).toMatchObject({ mode: 'home', start: '08:00', end: '16:30', breakMinutes: 30 });
		expect(r.drafts[2].mode).toBe('');
		expect(defaultBreak({ start: 480, end: 600 })).toBe(0);
	});
	it('replaces an existing plan, keeps its note and reports it', () => {
		const start = week({ 1: office('07:00', '15:00', { note: 'x' }) });
		const r = paintDays(start, days(), [date(1)], { start: 600, end: 660 }, brush);
		expect(r.replaced).toEqual([date(1)]);
		expect(r.drafts[1]).toMatchObject({ mode: 'home', start: '10:00', end: '11:00', note: 'x', breakMinutes: 0 });
	});
	it('skips blocked days and never mutates the input', () => {
		const start = week();
		const r = paintDays(start, days({ 2: 'holiday' }), [date(1), date(2)], { start: 480, end: 540 }, brush);
		expect(r.skipped).toEqual([date(2)]);
		expect(r.drafts[2].mode).toBe('');
		expect(start[1].mode).toBe('');
	});
	it('paints an off day without times', () => {
		const r = paintDays(week(), days(), [date(0)], { start: 480, end: 540 }, { ...brush, mode: 'off' });
		expect(r.drafts[0]).toMatchObject({ mode: 'off', start: '', end: '' });
	});
});

describe('eraseDays', () => {
	it('clears planned days only and skips blocked ones', () => {
		const start = week({ 0: office('08:00', '16:00'), 2: office('08:00', '16:00') });
		const r = eraseDays(start, days({ 2: 'vacation' }), [date(0), date(1), date(2)]);
		expect(r.touched).toEqual([date(0)]);
		expect(r.skipped).toEqual([date(2)]);
		expect(r.drafts[0].mode).toBe('');
		expect(r.drafts[2].mode).toBe('office');
	});
});

describe('moveBlocks', () => {
	const start = week({ 0: office('08:00', '16:00') });
	it('moves across days and time', () => {
		const r = moveBlocks(start, days(), [date(0)], 2, 60, false);
		expect(r.ok).toBe(true);
		expect(r.drafts[0].mode).toBe('');
		expect(r.drafts[2]).toMatchObject({ date: date(2), mode: 'office', start: '09:00', end: '17:00' });
		expect(r.touched.sort()).toEqual([date(0), date(2)]);
	});
	it('copies and keeps the source', () => {
		const r = moveBlocks(start, days(), [date(0)], 1, 0, true);
		expect(r.drafts[0].mode).toBe('office');
		expect(r.drafts[1]).toMatchObject({ date: date(1), start: '08:00' });
	});
	it('is all-or-nothing when a target is blocked or outside the week', () => {
		expect(moveBlocks(start, days({ 1: 'holiday' }), [date(0)], 1, 0, false)).toMatchObject({ ok: false, skipped: [date(0)] });
		expect(moveBlocks(start, days(), [date(0)], -1, 0, false).ok).toBe(false);
		expect(moveBlocks(start, days(), [date(0)], 7, 0, false).ok).toBe(false);
	});
	it('overwrites an occupied target and reports it', () => {
		const s = week({ 0: office('08:00', '16:00'), 1: { mode: 'home', start: '09:00', end: '12:00' } });
		const r = moveBlocks(s, days(), [date(0)], 1, 0, false);
		expect(r.replaced).toEqual([date(1)]);
		expect(r.drafts[1].mode).toBe('office');
	});
	it('moves a multi-selection together, also onto each other', () => {
		const s = week({ 0: office('08:00', '16:00'), 1: { mode: 'home', start: '09:00', end: '12:00' } });
		const r = moveBlocks(s, days(), [date(0), date(1)], 1, 0, false);
		expect(r.drafts[0].mode).toBe('');
		expect(r.drafts[1].mode).toBe('office');
		expect(r.drafts[2].mode).toBe('home');
		expect(r.replaced).toEqual([]);
	});
	it('does nothing for a zero delta', () => {
		expect(moveBlocks(start, days(), [date(0)], 0, 0, false).touched).toEqual([]);
	});
});

describe('single-field edits', () => {
	const s = week({ 0: office('08:00', '16:00'), 1: office('09:00', '13:00') });
	it('resizes a block', () => {
		expect(resizeBlock(s, date(0), { start: 480, end: 1020 }).drafts[0].end).toBe('17:00');
		expect(resizeBlock(s, date(3), { start: 480, end: 1020 }).touched).toEqual([]);
	});
	it('changes the mode; off drops the times', () => {
		const r = setModeOn(s, days(), [date(0), date(1), date(2)], 'school');
		expect(r.drafts[0].mode).toBe('school');
		expect(r.drafts[2].mode).toBe('');
		const off = setModeOn(s, days(), [date(0)], 'off');
		expect(off.drafts[0]).toMatchObject({ mode: 'off', start: '', end: '', breakMinutes: 0 });
	});
	it('sets the break only on timed blocks', () => {
		const r = setBreakOn(s, [date(0), date(4)], 45);
		expect(r.touched).toEqual([date(0)]);
		expect(r.drafts[0].breakMinutes).toBe(45);
	});
	it('copies one day onto other days', () => {
		const r = copyToDates(s, days({ 3: 'sick' }), date(0), [date(1), date(2), date(3)]);
		expect(r.touched).toEqual([date(1), date(2)]);
		expect(r.replaced).toEqual([date(1)]);
		expect(r.skipped).toEqual([date(3)]);
		expect(r.drafts[2]).toMatchObject({ date: date(2), start: '08:00' });
	});
});

describe('clipboard', () => {
	const s = week({ 1: office('08:00', '16:00'), 3: { mode: 'home', start: '09:00', end: '12:00' } });
	it('keeps the relative shape on paste', () => {
		const clip = copyClip(s, [date(3), date(1)]);
		expect(clip.map((c) => c.offset)).toEqual([0, 2]);
		const r = pasteClip(week(), days(), clip, date(0));
		expect(r.drafts[0]).toMatchObject({ mode: 'office', date: date(0) });
		expect(r.drafts[2]).toMatchObject({ mode: 'home', date: date(2) });
	});
	it('skips blocked and out-of-week targets', () => {
		const clip = copyClip(s, [date(1), date(3)]);
		const r = pasteClip(week(), days({ 6: 'holiday' }), clip, date(5));
		expect(r.touched).toEqual([date(5)]);
		expect(r.skipped.length).toBe(1);
	});
	it('an empty selection copies nothing', () => {
		expect(copyClip(s, [date(0)])).toEqual([]);
	});
});
