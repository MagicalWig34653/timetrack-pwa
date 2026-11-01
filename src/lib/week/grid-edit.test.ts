import { describe, expect, it } from 'vitest';
import type { PlanWeekDay } from '#lib/api/types.js';
import {
	blockId,
	blocksOf,
	breakBlock,
	type Brush,
	canMergeWithNext,
	copyClip,
	copyToDates,
	defaultBreak,
	eraseBlocks,
	eraseDays,
	mergeWithNext,
	moveBlocks,
	neighbourBounds,
	paintDays,
	parseBlockId,
	pasteClip,
	replaceBlock,
	resizeBlock,
	setBreakOn,
	setKindOn,
	setModeOn,
	splitBlock
} from './grid-edit.js';
import { type DayDraft, type DraftBlock, emptyDraft } from './plan-draft.js';

const date = (i: number) => `2026-10-${26 + i}`;
const week7 = (blocked: Record<number, PlanWeekDay['blockedBy']> = {}): PlanWeekDay[] =>
	Array.from({ length: 7 }, (_, i) => ({ date: date(i), weekday: i + 1, targetSeconds: i < 5 ? 27_720 : 0, plannedSeconds: null, blockedBy: blocked[i] ?? null, plan: null }));
const multi = (blocked: Record<number, PlanWeekDay['blockedBy']> = {}) => ({ days: week7(blocked), multi: true });
const legacy = (blocked: Record<number, PlanWeekDay['blockedBy']> = {}) => ({ days: week7(blocked), multi: false });
const week = (over: Record<number, Partial<DayDraft>> = {}): DayDraft[] => Array.from({ length: 7 }, (_, i) => ({ ...emptyDraft(date(i)), ...over[i] }));
const blk = (start: string, end: string, kind: DraftBlock['kind'] = 'office', extra: Partial<DraftBlock> = {}): DraftBlock => ({ start, end, kind, placeId: null, note: '', ...extra });
const day = (mode: DayDraft['mode'], blocks: DraftBlock[], extra: Partial<DayDraft> = {}): Partial<DayDraft> => ({ mode, blocks, ...extra });
const id = (i: number, n = 0) => blockId(date(i), n);
const times = (draft: DayDraft) => draft.blocks.map((b) => `${b.start}-${b.end} ${b.kind}`);
const brush: Brush = { kind: 'home', placeId: null, breakMinutes: null };
const range = (start: number, end: number) => ({ start, end });

describe('block ids', () => {
	it('addresses a block by day and position', () => {
		expect(parseBlockId(id(2, 3))).toEqual({ date: date(2), index: 3 });
		expect(blocksOf({ ...emptyDraft(date(0)), ...day('office', [blk('08:00', '12:00'), blk('', '13:00'), blk('13:00', '17:00')]) }).map((b) => b.id)).toEqual([id(0, 0), id(0, 2)]);
	});
});

describe('paintDays with block lists', () => {
	it('paints the same range on several days, one block per day, without a break', () => {
		const r = paintDays(week(), multi(), [date(0), date(1)], range(480, 990), brush);
		expect(r.touched).toEqual([date(0), date(1)]);
		expect(r.drafts[0]).toMatchObject({ mode: 'home', breakMinutes: 0 });
		expect(times(r.drafts[0])).toEqual(['08:00-16:30 home']);
		expect(r.drafts[2].mode).toBe('');
		expect(r.selection).toEqual([id(0), id(1)]);
		expect(defaultBreak({ start: 480, end: 600 })).toBe(0);
	});
	it('adds a second block next to an existing one: school and work on one day', () => {
		const start = week({ 0: day('office', [blk('08:00', '12:00', 'school')]) });
		const r = paintDays(start, multi(), [date(0)], range(13 * 60, 17 * 60), { ...brush, kind: 'work' });
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 school', '13:00-17:00 work']);
		expect(r.replaced).toEqual([]);
		expect(r.drafts[0].mode).toBe('office'); // the day mode stays
		expect(r.selection).toEqual([id(0, 1)]);
	});
	it('carves what it overlaps: trims, splits and removes, and reports it', () => {
		const start = week({ 0: day('office', [blk('08:00', '16:00')]) });
		const middle = paintDays(start, multi(), [date(0)], range(11 * 60, 12 * 60), { ...brush, kind: 'school' });
		expect(times(middle.drafts[0])).toEqual(['08:00-11:00 office', '11:00-12:00 school', '12:00-16:00 office']);
		expect(middle.replaced).toEqual([date(0)]);
		const covering = paintDays(start, multi(), [date(0)], range(7 * 60, 17 * 60), brush);
		expect(times(covering.drafts[0])).toEqual(['07:00-17:00 home']);
		const edge = paintDays(start, multi(), [date(0)], range(15 * 60, 18 * 60), brush);
		expect(times(edge.drafts[0])).toEqual(['08:00-15:00 office', '15:00-18:00 home']);
	});
	it('keeps the note and the mode of a rough plan, and starts a free day fresh', () => {
		const rough = paintDays(week({ 0: day('customer', [], { note: 'x' }) }), multi(), [date(0)], range(480, 540), brush);
		expect(rough.drafts[0]).toMatchObject({ mode: 'customer', note: 'x' });
		const free = paintDays(week({ 0: day('off', []) }), multi(), [date(0)], range(480, 540), brush);
		expect(free.drafts[0]).toMatchObject({ mode: 'home' });
		expect(free.replaced).toEqual([date(0)]);
	});
	it('the travel kind is painted as such and gives an office day', () => {
		const r = paintDays(week(), multi(), [date(0)], range(480, 540), { ...brush, kind: 'travel' });
		expect(r.drafts[0]).toMatchObject({ mode: 'office' });
		expect(r.drafts[0].blocks[0].kind).toBe('travel');
	});
	it('skips blocked days and never mutates the input', () => {
		const start = week();
		const r = paintDays(start, multi({ 2: 'holiday' }), [date(1), date(2)], range(480, 540), brush);
		expect(r.skipped).toEqual([date(2)]);
		expect(r.drafts[2].mode).toBe('');
		expect(start[1].mode).toBe('');
	});
	it('paints an off day without blocks', () => {
		const r = paintDays(week({ 0: day('office', [blk('08:00', '12:00')]) }), multi(), [date(0)], range(480, 540), { ...brush, kind: 'off' });
		expect(r.drafts[0]).toMatchObject({ mode: 'off', blocks: [] });
		expect(r.replaced).toEqual([date(0)]);
	});
	it('refuses the 33rd block', () => {
		const clockAt = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
		const many = Array.from({ length: 32 }, (_, i) => blk(clockAt(i * 40), clockAt(i * 40 + 30)));
		expect(many[31].end).toBe('21:10');
		const r = paintDays(week({ 0: day('office', many) }), multi(), [date(0)], range(22 * 60, 23 * 60), brush);
		expect(r.skipped).toEqual([date(0)]);
		expect(r.touched).toEqual([]);
	});
});

describe('paintDays on an older server', () => {
	it('replaces the day with one block and the automatic break', () => {
		const start = week({ 1: day('office', [blk('07:00', '15:00')], { note: 'x', breakMinutes: 30 }) });
		const r = paintDays(start, legacy(), [date(0), date(1)], range(480, 990), brush);
		expect(r.drafts[0]).toMatchObject({ mode: 'home', breakMinutes: 30, blocks: [{ start: '08:00', end: '16:30', kind: 'home' }] });
		expect(r.drafts[1]).toMatchObject({ mode: 'home', note: 'x', blocks: [{ start: '08:00', end: '16:30', kind: 'home' }] });
		expect(r.replaced).toEqual([date(1)]);
		expect(paintDays(week(), legacy(), [date(0)], range(600, 660), brush).drafts[0].breakMinutes).toBe(0);
	});
});

describe('eraseBlocks and eraseDays', () => {
	const start = week({ 0: day('office', [blk('08:00', '12:00', 'school'), blk('13:00', '17:00', 'work')]), 2: day('office', [blk('08:00', '16:00')]) });
	it('removes single blocks, a day without blocks has no plan any more', () => {
		const one = eraseBlocks(start, multi(), [id(0, 0)]);
		expect(times(one.drafts[0])).toEqual(['13:00-17:00 work']);
		expect(one.drafts[0].mode).toBe('office');
		const all = eraseBlocks(start, multi(), [id(0, 0), id(0, 1)]);
		expect(all.drafts[0]).toEqual(emptyDraft(date(0)));
	});
	it('skips blocked days', () => {
		const r = eraseBlocks(start, multi({ 2: 'vacation' }), [id(0, 1), id(2, 0)]);
		expect(r.touched).toEqual([date(0)]);
		expect(r.skipped).toEqual([date(2)]);
		expect(r.drafts[2].mode).toBe('office');
	});
	it('erases whole days, rough plans included', () => {
		const rough = week({ 1: day('home', []) });
		const r = eraseDays(rough, multi(), [date(0), date(1)]);
		expect(r.touched).toEqual([date(1)]);
		expect(r.drafts[1]).toEqual(emptyDraft(date(1)));
	});
});

describe('moveBlocks', () => {
	const start = week({ 0: day('office', [blk('08:00', '12:00', 'school'), blk('13:00', '17:00', 'work')]) });
	it('moves one block across days and time, the other stays', () => {
		const r = moveBlocks(start, multi(), [id(0, 1)], 2, 60, false);
		expect(r.ok).toBe(true);
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 school']);
		expect(times(r.drafts[2])).toEqual(['14:00-18:00 work']);
		expect(r.drafts[2].mode).toBe('office');
		expect(r.touched.sort()).toEqual([date(0), date(2)]);
		expect(r.selection).toEqual([id(2, 0)]);
	});
	it('moves within the day and keeps the day mode', () => {
		const lonely = week({ 0: day('customer', [blk('08:00', '12:00', 'work')]) });
		const r = moveBlocks(lonely, multi(), [id(0, 0)], 0, 60, false);
		expect(times(r.drafts[0])).toEqual(['09:00-13:00 work']);
		expect(r.drafts[0].mode).toBe('customer');
	});
	it('copies and keeps the source', () => {
		const r = moveBlocks(start, multi(), [id(0, 0)], 1, 0, true);
		expect(r.drafts[0].blocks).toHaveLength(2);
		expect(times(r.drafts[1])).toEqual(['08:00-12:00 school']);
	});
	it('moves a group by the same amount and stops at the day boundary without squeezing', () => {
		const r = moveBlocks(start, multi(), [id(0, 0), id(0, 1)], 0, 8 * 60, false);
		// the group may move by 6:59 at most (17:00 -> 23:59); the gap between the blocks stays
		expect(times(r.drafts[0])).toEqual(['14:59-18:59 school', '19:59-23:59 work']);
	});
	it('trims a block the moved one lands on and reports it', () => {
		const s = week({ 0: day('office', [blk('08:00', '12:00')]), 1: day('home', [blk('09:00', '13:00', 'home')]) });
		const r = moveBlocks(s, multi(), [id(0, 0)], 1, 0, false);
		expect(r.replaced).toEqual([date(1)]);
		expect(times(r.drafts[1])).toEqual(['08:00-12:00 office', '12:00-13:00 home']);
		expect(r.drafts[1].mode).toBe('home');
		expect(r.drafts[0]).toEqual(emptyDraft(date(0)));
	});
	it('is all-or-nothing when a target is blocked or outside the week', () => {
		expect(moveBlocks(start, multi({ 1: 'holiday' }), [id(0, 0)], 1, 0, false)).toMatchObject({ ok: false, skipped: [date(0)] });
		expect(moveBlocks(start, multi(), [id(0, 0)], -1, 0, false).ok).toBe(false);
		expect(moveBlocks(start, multi(), [id(0, 0)], 7, 0, false).ok).toBe(false);
	});
	it('does nothing for a zero delta', () => {
		expect(moveBlocks(start, multi(), [id(0, 0)], 0, 0, false).touched).toEqual([]);
	});
	it('on an older server the whole day moves and replaces the target', () => {
		const s = week({ 0: day('office', [blk('08:00', '16:00')], { breakMinutes: 30, note: 'n' }), 1: day('home', [blk('09:00', '12:00', 'home')]) });
		const r = moveBlocks(s, legacy(), [id(0, 0)], 1, 60, false);
		expect(r.drafts[0].mode).toBe('');
		expect(r.drafts[1]).toMatchObject({ mode: 'office', breakMinutes: 30, note: 'n', blocks: [{ start: '09:00', end: '17:00', kind: 'office' }] });
		expect(r.replaced).toEqual([date(1)]);
	});
});

describe('resizing', () => {
	const s = week({ 0: day('office', [blk('08:00', '12:00'), blk('13:00', '17:00')]) });
	it('changes one block', () => {
		const r = resizeBlock(s, id(0, 0), range(8 * 60, 12 * 60 + 30));
		expect(times(r.drafts[0])).toEqual(['08:00-12:30 office', '13:00-17:00 office']);
		expect(resizeBlock(s, id(3, 0), range(480, 600)).touched).toEqual([]);
	});
	it('knows the free space around a block', () => {
		expect(neighbourBounds(s, id(0, 0))).toEqual({ start: 0, end: 13 * 60 });
		expect(neighbourBounds(s, id(0, 1))).toEqual({ start: 12 * 60, end: 23 * 60 + 59 });
	});
});

describe('kind, mode and break', () => {
	const s = week({ 0: day('office', [blk('08:00', '12:00'), blk('13:00', '17:00')]), 1: day('office', [blk('09:00', '13:00')], { breakMinutes: 0 }) });
	it('changes the kind of single blocks, the mode of the day stays', () => {
		const r = setKindOn(s, multi(), [id(0, 1)], 'school');
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 office', '13:00-17:00 school']);
		expect(r.drafts[0].mode).toBe('office');
	});
	it('on an older server the kind is the day mode', () => {
		const r = setKindOn(s, legacy(), [id(1, 0)], 'school');
		expect(r.drafts[1]).toMatchObject({ mode: 'school', blocks: [{ kind: 'school' }] });
	});
	it('changes the mode of days; off drops the blocks', () => {
		const r = setModeOn(s, multi(), [date(0), date(1), date(2)], 'school');
		expect(r.drafts[0].mode).toBe('school');
		expect(r.drafts[0].blocks.map((b) => b.kind)).toEqual(['office', 'office']);
		expect(r.drafts[2].mode).toBe('');
		expect(setModeOn(s, multi(), [date(0)], 'off').drafts[0]).toMatchObject({ mode: 'off', blocks: [], breakMinutes: 0 });
	});
	it('sets the legacy break only on planned days', () => {
		const r = setBreakOn(s, [id(0, 0), id(4, 0)], 45);
		expect(r.touched).toEqual([date(0)]);
		expect(r.drafts[0].breakMinutes).toBe(45);
	});
});

describe('splitting, breaks and merging', () => {
	const s = week({ 0: day('office', [blk('08:00', '17:00', 'work', { note: 'n', placeId: 'p' })]) });
	it('splits a block in two that keep kind, place and note', () => {
		const r = splitBlock(s, multi(), id(0), 12 * 60);
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 work', '12:00-17:00 work']);
		expect(r.drafts[0].blocks.every((b) => b.note === 'n' && b.placeId === 'p')).toBe(true);
		expect(r.selection).toEqual([id(0, 0), id(0, 1)]);
	});
	it('splits with a gap: a planned break', () => {
		const r = splitBlock(s, multi(), id(0), 12 * 60, 30);
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 work', '12:30-17:00 work']);
	});
	it('inserts a break in the middle, rounded to five minutes', () => {
		const r = breakBlock(s, multi(), id(0), 45);
		expect(times(r.drafts[0])).toEqual(['08:00-12:10 work', '12:55-17:00 work']);
	});
	it('refuses pieces under five minutes and does nothing on an older server', () => {
		expect(splitBlock(s, multi(), id(0), 8 * 60 + 4).touched).toEqual([]);
		expect(splitBlock(s, multi(), id(0), 16 * 60 + 58).touched).toEqual([]);
		expect(splitBlock(s, legacy(), id(0), 12 * 60).touched).toEqual([]);
		expect(breakBlock(week({ 0: day('office', [blk('08:00', '08:30')]) }), multi(), id(0), 30).touched).toEqual([]);
	});
	it('merges a block with the next of the same kind and place, closing the gap', () => {
		const split = splitBlock(s, multi(), id(0), 12 * 60, 30).drafts;
		expect(canMergeWithNext(split, id(0, 0))).toBe(true);
		expect(canMergeWithNext(split, id(0, 1))).toBe(false);
		const r = mergeWithNext(split, multi(), id(0, 0));
		expect(times(r.drafts[0])).toEqual(['08:00-17:00 work']);
		const mixed = setKindOn(split, multi(), [id(0, 1)], 'school').drafts;
		expect(canMergeWithNext(mixed, id(0, 0))).toBe(false);
		expect(mergeWithNext(mixed, multi(), id(0, 0)).touched).toEqual([]);
	});
});

describe('the dialog result', () => {
	const s = week({ 0: day('office', [blk('08:00', '12:00', 'school'), blk('13:00', '17:00', 'work')]) });
	it('replaces one block and can move it to another day, setting the day mode', () => {
		const r = replaceBlock(s, multi(), id(0, 1), date(2), blk('14:00', '18:00', 'customer', { note: 'K' }), { mode: 'customer' });
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 school']);
		expect(times(r.drafts[2])).toEqual(['14:00-18:00 customer']);
		expect(r.drafts[2].mode).toBe('customer');
		expect(r.touched.sort()).toEqual([date(0), date(2)]);
	});
	it('adds a block to a day', () => {
		const r = replaceBlock(s, multi(), null, date(0), blk('18:00', '20:00', 'travel'));
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 school', '13:00-17:00 work', '18:00-20:00 travel']);
	});
	it('writes the day note on an older server', () => {
		const r = replaceBlock(week(), legacy(), null, date(0), blk('08:00', '12:00', 'home', { note: 'N' }), { mode: 'home', breakMinutes: 15, dayNote: 'N' });
		expect(r.drafts[0]).toMatchObject({ mode: 'home', breakMinutes: 15, note: 'N' });
	});
	it('refuses a blocked day', () => {
		expect(replaceBlock(s, multi({ 2: 'sick' }), null, date(2), blk('08:00', '09:00')).skipped).toEqual([date(2)]);
	});
});

describe('copying a whole day', () => {
	const s = week({ 0: day('office', [blk('08:00', '12:00', 'school'), blk('13:00', '17:00', 'work')], { note: 'x' }), 1: day('home', [blk('09:00', '13:00', 'home')]) });
	it('copies every block to other days', () => {
		const r = copyToDates(s, multi({ 3: 'sick' }), date(0), [date(1), date(2), date(3)]);
		expect(r.touched).toEqual([date(1), date(2)]);
		expect(r.replaced).toEqual([date(1)]);
		expect(r.skipped).toEqual([date(3)]);
		expect(times(r.drafts[2])).toEqual(['08:00-12:00 school', '13:00-17:00 work']);
		expect(r.drafts[2].date).toBe(date(2));
	});
});

describe('clipboard', () => {
	const s = week({ 1: day('office', [blk('08:00', '12:00', 'school'), blk('13:00', '16:00', 'work')]), 3: day('home', [blk('09:00', '12:00', 'home')]) });
	it('keeps the relative shape on paste', () => {
		const clip = copyClip(s, [id(3, 0), id(1, 1), id(1, 0)]);
		expect(clip.map((c) => c.offset)).toEqual([0, 0, 2]);
		const r = pasteClip(week(), multi(), clip, date(0));
		expect(times(r.drafts[0])).toEqual(['08:00-12:00 school', '13:00-16:00 work']);
		expect(times(r.drafts[2])).toEqual(['09:00-12:00 home']);
		expect(r.drafts[2].date).toBe(date(2));
	});
	it('skips blocked and out-of-week targets', () => {
		const clip = copyClip(s, [id(1, 0), id(3, 0)]);
		const r = pasteClip(week(), multi({ 6: 'holiday' }), clip, date(5));
		expect(r.touched).toEqual([date(5)]);
		expect(r.skipped.length).toBe(1);
	});
	it('an empty selection copies nothing', () => {
		expect(copyClip(s, [id(0, 0)])).toEqual([]);
	});
});
