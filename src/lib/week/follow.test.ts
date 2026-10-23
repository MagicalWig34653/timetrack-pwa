import { describe, expect, it } from 'vitest';
import type { PlanWeek, PlanWeekDay } from '#lib/api/types.js';
import { followEntries } from './follow.js';
import { emptyDraft, type DayDraft } from './plan-draft.js';

const date = (i: number) => `2026-11-${String(2 + i).padStart(2, '0')}`;
const target = (extra: Record<number, Partial<PlanWeekDay>> = {}): PlanWeek => ({
	week: '2026-W45',
	from: date(0),
	to: date(6),
	totals: { targetSeconds: 0, plannedSeconds: 0, differenceSeconds: 0 },
	days: Array.from({ length: 7 }, (_, i) => ({ date: date(i), weekday: i + 1, targetSeconds: 0, plannedSeconds: null, blockedBy: null, plan: null, ...extra[i] }))
});
const source: DayDraft[] = Array.from({ length: 7 }, (_, i) => ({ ...emptyDraft(`2026-10-${26 + i}`), ...(i < 3 ? { mode: 'office' as const, start: '08:00', end: '16:30', breakMinutes: 30 } : {}) }));

describe('followEntries', () => {
	it('maps weekday to weekday with the target dates', () => {
		const r = followEntries(source, target(), true);
		expect(r.entries.map((e) => e.date)).toEqual([date(0), date(1), date(2)]);
		expect(r.entries[0]).toMatchObject({ mode: 'office', plannedStart: '08:00', plannedEnd: '16:30', plannedBreakMinutes: 30 });
	});
	it('skips blocked target days', () => {
		const r = followEntries(source, target({ 1: { blockedBy: 'holiday' } }), true);
		expect(r.entries.map((e) => e.date)).toEqual([date(0), date(2)]);
		expect(r.skippedBlocked).toBe(1);
	});
	it('keeps existing plans unless overwrite is set', () => {
		const existing = { date: date(0), mode: 'home' as const };
		const keep = followEntries(source, target({ 0: { plan: existing } }), false);
		expect(keep.entries.map((e) => e.date)).toEqual([date(1), date(2)]);
		expect(keep.skippedExisting).toBe(1);
		expect(followEntries(source, target({ 0: { plan: existing } }), true).entries).toHaveLength(3);
	});
});
