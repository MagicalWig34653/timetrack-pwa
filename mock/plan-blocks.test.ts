import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import type { PlanTimeBlock } from '#lib/api/types.js';
import { planHintsOf } from '#lib/week/plan-draft.js';
import { createMockFetch } from './fetch.ts';
import { createPlanningMock, normalizePlanBody } from './planning.ts';
import { planHints } from './plan-blocks.ts';

// Plan blocks of contract 0.35.0 (package P13): the mock must validate and derive like the backend, so the PWA tests that
// run against it say something about the real server.
// Wednesday 14.10.2026 11:30 Berlin = KW 42.
const NOW = Date.parse('2026-10-14T09:30:00Z');

beforeEach(async () => {
	const mock = createMockFetch({ now: () => NOW });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	const options = await api.loginOptions();
	await api.loginVerify(options.challengeId, { id: 'mock-login' });
});
afterEach(() => vi.unstubAllGlobals());

const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: ApiError) => `${e.status}:${e.code}`);
const block = (start: string, end: string, kind: PlanTimeBlock['kind'] = 'work', extra: Partial<PlanTimeBlock> = {}): PlanTimeBlock => ({ start, end, kind, ...extra });
const DAY = '2026-11-10';

describe('mock plan blocks: writing', () => {
	it('stores the full list and derives the old fields and the seconds from it', async () => {
		const saved = await api.putPlanDay(DAY, { mode: 'office', blocks: [block('08:00', '12:00', 'school', { note: 'Mathe' }), block('13:00', '17:00')] });
		expect(saved).toMatchObject({ plannedStart: '08:00', plannedEnd: '17:00', plannedBreakMinutes: 60, plannedSeconds: 8 * 3600, planHints: [] });
		expect(saved.blocks).toEqual([block('08:00', '12:00', 'school', { placeId: null, note: 'Mathe' }), block('13:00', '17:00', 'work', { placeId: null, note: null })]);
		expect((await api.listPlanDays(DAY, DAY))[0].blocks).toHaveLength(2);
	});

	it('lets the list win over the old fields and keeps a shared boundary', async () => {
		const saved = await api.putPlanDay(DAY, { mode: 'home', plannedStart: '06:00', plannedEnd: '07:00', blocks: [block('09:00', '10:00'), block('10:00', '11:00', 'travel')] });
		expect(saved).toMatchObject({ plannedStart: '09:00', plannedEnd: '11:00', plannedBreakMinutes: 0, plannedSeconds: 7200 });
	});

	it('mode off takes no blocks, a rough day takes an empty list', async () => {
		expect(await code(api.putPlanDay(DAY, { mode: 'off', blocks: [block('08:00', '09:00')] }))).toBe('400:plan_blocks_invalid');
		expect(await api.putPlanDay(DAY, { mode: 'off', blocks: [] })).toMatchObject({ blocks: [], plannedSeconds: null });
		expect(await api.putPlanDay(DAY, { mode: 'home', blocks: [] })).toMatchObject({ blocks: [], plannedStart: null, plannedSeconds: null });
	});

	it('reports each rule with its own code', async () => {
		const put = (blocks: unknown[], mode: 'office' | 'off' = 'office') => code(api.putPlanDay(DAY, { mode, blocks: blocks as PlanTimeBlock[] }));
		expect(await put([block('12:00', '08:00')])).toBe('400:plan_time_invalid');
		expect(await put([block('08:00', '08:00')])).toBe('400:plan_time_invalid');
		expect(await put([block('8:00', '09:00')])).toBe('400:plan_time_invalid');
		expect(await put([block('08:00', '09:00', 'nap' as never)])).toBe('400:plan_kind_invalid');
		expect(await put([block('08:00', '09:00', 'work', { note: 'x'.repeat(201) })])).toBe('400:plan_note_invalid');
		expect(await put([block('08:00', '10:00'), block('09:59', '12:00')])).toBe('400:plan_blocks_overlap');
		expect(await put([block('13:00', '14:00'), block('08:00', '09:00')])).toBe('400:plan_blocks_overlap'); // wrong order
		const many = Array.from({ length: 33 }, (_, i) => block(`${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, `${String(Math.floor((i + 1) / 2)).padStart(2, '0')}:${(i + 1) % 2 ? '30' : '00'}`));
		expect(await put(many)).toBe('400:plan_blocks_invalid');
		expect(await put(many.slice(0, 32))).toBe('ok');
	});

	it('converts an old window write into blocks, the break as a gap in the middle', async () => {
		const withBreak = await api.putPlanDay(DAY, { mode: 'customer', plannedStart: '08:00', plannedEnd: '17:00', plannedBreakMinutes: 60 });
		expect(withBreak.blocks).toEqual([block('08:00', '12:00', 'customer', { placeId: null, note: null }), block('13:00', '17:00', 'customer', { placeId: null, note: null })]);
		expect(withBreak.plannedSeconds).toBe(8 * 3600);
		expect((await api.putPlanDay(DAY, { mode: 'home', plannedStart: '08:00', plannedEnd: '12:00' })).blocks).toHaveLength(1);
		// a break as long as the window cannot be shown as a positive block: the old value stays, 0 seconds
		const extreme = await api.putPlanDay(DAY, { mode: 'home', plannedStart: '08:00', plannedEnd: '09:00', plannedBreakMinutes: 60 });
		expect(extreme).toMatchObject({ blocks: [], plannedSeconds: 0, plannedBreakMinutes: 60 });
	});

	it('writes a week atomically with blocks', async () => {
		const day = (date: string, blocks: PlanTimeBlock[]) => ({ date, mode: 'office' as const, blocks });
		const saved = await api.putPlanWeek('2026-W46', { days: [day('2026-11-09', [block('08:00', '12:00', 'school'), block('13:00', '17:00')]), day('2026-11-10', [block('09:00', '10:00')])] });
		expect(saved.days[0].plannedSeconds).toBe(8 * 3600);
		expect(saved.days[0].plan?.blocks).toHaveLength(2);
		expect(saved.totals.plannedSeconds).toBe(9 * 3600);
		// the second entry is invalid: nothing of the first is stored
		expect(await code(api.putPlanWeek('2026-W46', { replace: true, days: [day('2026-11-09', [block('08:00', '09:00')]), day('2026-11-10', [block('10:00', '09:00')])] }))).toBe('400:plan_time_invalid');
		expect((await api.getPlanWeek('2026-W46')).days[0].plan?.blocks).toHaveLength(2);
	});
});

describe('mock plan hints agree with the PWA rule', () => {
	const cases: PlanTimeBlock[][] = [
		[],
		[block('08:00', '12:00'), block('12:30', '16:30')],
		[block('08:00', '16:30')],
		[block('08:00', '13:00', 'school'), block('13:00', '17:00')],
		[block('08:00', '12:00'), block('12:10', '17:00')],
		[block('06:00', '11:00'), block('11:30', '16:30')],
		[block('06:00', '11:00'), block('11:45', '16:45')],
		[block('08:00', '11:00'), block('11:10', '14:00')]
	];
	it.each(cases.map((blocks, i) => [i, blocks] as const))('case %i', (_i, blocks) => {
		const draft = blocks.map((b) => ({ start: b.start, end: b.end, kind: b.kind, placeId: null, note: '' }));
		expect(planHintsOf(draft)).toEqual(planHints(blocks));
	});
	it('reports them on the written day', async () => {
		const day = await api.putPlanDay(DAY, { mode: 'office', blocks: [block('08:00', '16:30')] });
		expect(day.planHints).toEqual(['planned_break_short', 'planned_work_stretch_long']);
	});
});

describe('mock plan blocks: week overview', () => {
	it('lists the blocks, the hints and the difference to the actual time per day', async () => {
		// Monday 12.10.2026 has evaluated work time in the seed; plan it as two blocks of 4 hours
		await api.putPlanDay('2026-10-12', { mode: 'office', blocks: [block('08:00', '12:00', 'school'), block('13:00', '17:00')] });
		const week = await api.getTimeWeek('2026-W42');
		const monday = week.days[0];
		expect(monday.planBlocks).toHaveLength(2);
		expect(monday.plannedSeconds).toBe(8 * 3600);
		expect(monday.planActualDifferenceSeconds).toBe(monday.workSeconds + monday.creditSeconds - 8 * 3600);
		// no plan: no blocks and no difference; future days: no difference
		expect(week.days.find((d) => d.date === '2026-10-14' && d.planBlocks === null)?.planActualDifferenceSeconds ?? null).toBeNull();
		const future = week.days.find((d) => d.isFuture && d.plannedSeconds !== null);
		expect(future?.planActualDifferenceSeconds).toBeNull();
		expect(future?.planBlocks?.length).toBeGreaterThan(0);
		expect(Array.isArray(week.days[1].planHints)).toBe(true);
	});

	it('a blocked day keeps the stored blocks but has no difference', async () => {
		await api.putPlanDay('2026-10-27', { mode: 'office', blocks: [block('08:00', '12:00')] }); // approved vacation
		const week = await api.getTimeWeek('2026-W44');
		expect(week.days[1]).toMatchObject({ plannedSeconds: 0, planActualDifferenceSeconds: null });
		expect(week.days[1].planBlocks).toHaveLength(1);
	});
});

describe('mock plan blocks: share views', () => {
	it('shows start, end and kind only, never places or notes', () => {
		const ids = { a: 'a', b: 'b' };
		const planning = createPlanningMock({
			clock: () => NOW,
			modelsOf: () => [],
			evaluateFor: () => ({ evaluatedWorkSeconds: 0 }),
			findByHandle: (h) => (h === 'b' ? { id: ids.b, displayName: 'B' } : undefined),
			displayNameOf: () => 'A'
		});
		const call = (accountId: string, method: string, path: string, body?: unknown) => planning.handle(accountId, { method, path: `/api/v1${path}`, body })!;
		call(ids.a, 'PUT', '/plan/days/2026-10-12', {
			mode: 'office',
			note: 'Tagesnotiz',
			placeId: '11111111-1111-4111-8111-111111111111',
			blocks: [block('08:00', '12:00', 'school', { note: 'Geheim', placeId: '22222222-2222-4222-8222-222222222222' }), block('13:00', '17:00')]
		});
		const created = call(ids.a, 'POST', '/shares', { recipientHandle: 'b', scopes: { plan: true } });
		const view = call(ids.b, 'GET', `/shares/incoming/${(created.body as { id: string }).id}/view?from=2026-10-12&to=2026-10-12`).body as { plan: { blocks: unknown[] }[] };
		expect(view.plan[0].blocks).toEqual([block('08:00', '12:00', 'school'), block('13:00', '17:00')]);
		const text = JSON.stringify(view);
		expect(text).not.toContain('Geheim');
		expect(text).not.toContain('Tagesnotiz');
		expect(text).not.toContain('2222');
		expect(text).not.toContain('1111');
	});
});

describe('normalizePlanBody', () => {
	it('keeps the old rules for window writes', () => {
		expect(normalizePlanBody({ mode: 'office', plannedStart: '08:00' })).toEqual({ error: 'plan_time_invalid' });
		expect(normalizePlanBody({ mode: 'office', plannedBreakMinutes: 5 })).toEqual({ error: 'plan_break_invalid' });
		expect(normalizePlanBody({ mode: 'weekend' })).toEqual({ error: 'bad_request' });
	});
});
