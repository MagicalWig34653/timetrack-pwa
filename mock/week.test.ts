import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import { createMockFetch } from './fetch.ts';

// Wednesday 14.10.2026 11:30 Berlin = KW 42 (12.-18.10.). Seed: sick 28.-29.09. (KW 40), approved vacation 26.-30.10. (KW 44),
// plan with times for KW 42 and KW 43.
const NOW = Date.parse('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	mock = createMockFetch({ now: () => NOW });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	const options = await api.loginOptions();
	await api.loginVerify(options.challengeId, { id: 'mock-login' });
});
afterEach(() => vi.unstubAllGlobals());

const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: ApiError) => `${e.status}:${e.code}`);

describe('mock GET /time/weeks/{isoWeek}', () => {
	it('agrees with /time/days and /time/account for the running week', async () => {
		const week = await api.getTimeWeek('2026-W42');
		const days = await api.listDays('2026-10-12', '2026-10-18');
		expect(week.days).toHaveLength(7);
		expect(week.summary.workSeconds).toBe(days.reduce((s, d) => s + d.evaluatedWorkSeconds, 0));
		expect(week.summary.targetSeconds).toBe(days.reduce((s, d) => s + d.targetSeconds, 0));
		// days after today carry no balance and do not count into the balance
		expect(week.days.map((d) => d.isFuture)).toEqual([false, false, false, true, true, true, true]);
		expect(week.days[3].balanceSeconds).toBeNull();
		expect(week.summary.balanceSeconds).toBe(days.filter((d) => d.date <= '2026-10-14').reduce((s, d) => s + d.deltaSeconds, 0));
		expect(week.summary.targetToDateSeconds).toBe(3 * 27720);
		expect(week.days[2].isToday).toBe(true);
		expect(week.summary.provisional).toBe(true);
		const before = await api.getTimeAccount('2026-10-11');
		expect(week.summary.accountBalanceBeforeSeconds).toBe(before.balanceSeconds);
		expect(week.summary.accountBalanceAfterSeconds).toBe((await api.getTimeAccount('2026-10-18')).balanceSeconds);
		expect(week.summary.accountBalanceAsOf).toBe('2026-10-14');
	});

	it('reports plan hours and mode per day, and the plan total only when a plan exists', async () => {
		const week = await api.getTimeWeek('2026-W42');
		expect(week.days[0]).toMatchObject({ planMode: 'office', plannedSeconds: 8 * 3600, mark: 'work' });
		expect(week.summary.plannedSeconds).toBe((8 + 8 + 8 + 5.5 + 6) * 3600);
		const empty = await api.getTimeWeek('2026-W10');
		expect(empty.summary.plannedSeconds).toBeNull();
	});

	it('marks sick days, counts them and derives the day facts from segments', async () => {
		const sick = await api.getTimeWeek('2026-W40');
		expect(sick.days.filter((d) => d.mark === 'sick').map((d) => d.date)).toEqual(['2026-09-28', '2026-09-29']);
		expect(sick.summary.sickDays).toBe(2);
		expect(sick.days[0].absences).toEqual([{ kind: 'sick', status: 'recorded', halfDay: false }]);
		const worked = await api.getTimeWeek('2026-W41');
		const thursday = worked.days[3]; // school day with a travel segment
		expect(thursday.schoolSeconds).toBe(5.5 * 3600);
		expect(thursday.travelSeconds).toBe(45 * 60);
		const monday = await api.getTimeWeek('2026-W42');
		expect(monday.days[0].breakSeconds).toBe(40 * 60); // 12:10-12:50
		expect(monday.days[0].segmentsCount).toBe(2);
		expect(monday.summary.longestDay).toMatchObject({ date: '2026-10-12' });
		expect(monday.summary.averageStart).toMatch(/^\d\d:\d\d$/);
	});

	it('counts vacation days and rejects invalid weeks', async () => {
		const vacation = await api.getTimeWeek('2026-W44');
		expect(vacation.summary.vacationDays).toBe(5);
		expect(vacation.days.slice(0, 5).every((d) => d.mark === 'vacation')).toBe(true);
		expect(vacation.days.slice(5).every((d) => d.mark === 'off')).toBe(true);
		for (const bad of ['2026-W00', '2026-W54', '2027-W53', 'abc', '2026-42']) expect(await code(api.getTimeWeek(bad))).toBe('400:invalid_week');
	});

	it('does not leak between accounts', async () => {
		const empty = await api.getTimeWeek('2026-W42');
		expect(empty.summary.workSeconds).toBeGreaterThan(0);
		const other = createMockFetch({ now: () => NOW });
		vi.stubGlobal('fetch', other.fetch);
		setCsrfToken(null);
		const options = await api.loginOptions();
		await api.loginVerify(options.challengeId, { id: 'mock-login' });
		expect((await api.getTimeWeek('2026-W42')).summary.workSeconds).toBe(empty.summary.workSeconds);
	});
});

describe('mock plan weeks', () => {
	it('returns seven days with targets, planned hours and totals', async () => {
		const week = await api.getPlanWeek('2026-W43');
		expect(week.days).toHaveLength(7);
		expect(week.totals.targetSeconds).toBe(138600);
		expect(week.days[0]).toMatchObject({ targetSeconds: 27720, plannedSeconds: 8 * 3600, blockedBy: null });
		expect(week.days[4].plan?.mode).toBe('off');
		expect(week.totals.plannedSeconds).toBe(4 * 8 * 3600);
	});

	it('blocks holidays and absences but keeps a stored plan', async () => {
		await api.putPlanDay('2026-10-27', { mode: 'office', plannedStart: '08:00', plannedEnd: '16:00', plannedBreakMinutes: 30 });
		const week = await api.getPlanWeek('2026-W44');
		expect(week.days[0]).toMatchObject({ blockedBy: 'vacation', targetSeconds: 0, plannedSeconds: null });
		expect(week.days[1]).toMatchObject({ blockedBy: 'vacation', plannedSeconds: 0 });
		expect(week.days[1].plan?.plannedSeconds).toBe(7.5 * 3600);
		const holiday = await api.getPlanWeek('2026-W53'); // 31.12.2026 is no holiday; New Year 2027 is outside
		expect(holiday.days.every((d) => d.blockedBy === null || d.blockedBy === 'holiday')).toBe(true);
	});

	it('writes a week in one go, replaces on request and validates before storing anything', async () => {
		const day = (date: string, extra: object = {}) => ({ date, mode: 'office' as const, plannedStart: '09:00', plannedEnd: '17:00', plannedBreakMinutes: 60, ...extra });
		const saved = await api.putPlanWeek('2026-W45', { days: [day('2026-11-02'), day('2026-11-03'), day('2026-11-04', { mode: 'off', plannedStart: '08:00', plannedEnd: '12:00' })] });
		expect(saved.days[0].plannedSeconds).toBe(7 * 3600);
		expect(saved.days[2].plan).toMatchObject({ mode: 'off', plannedStart: null, plannedSeconds: null });
		const replaced = await api.putPlanWeek('2026-W45', { replace: true, days: [day('2026-11-05')] });
		expect(replaced.days.filter((d) => d.plan).map((d) => d.date)).toEqual(['2026-11-05']);
		// invalid second entry: nothing changes
		expect(await code(api.putPlanWeek('2026-W45', { replace: true, days: [day('2026-11-02'), day('2026-11-03', { plannedEnd: '08:00' })] }))).toBe('400:plan_time_invalid');
		expect((await api.getPlanWeek('2026-W45')).days.filter((d) => d.plan).map((d) => d.date)).toEqual(['2026-11-05']);
		expect(await code(api.putPlanWeek('2026-W45', { days: [day('2026-11-09')] }))).toBe('400:week_day_invalid');
		expect(await code(api.putPlanWeek('2026-W45', { days: [day('2026-11-02'), day('2026-11-02')] }))).toBe('400:week_day_invalid');
		expect(await code(api.putPlanWeek('2026-W45', { days: [day('2026-11-02', { plannedStart: '09:00', plannedEnd: undefined })] }))).toBe('400:plan_time_invalid');
		expect(await code(api.putPlanWeek('2026-W45', { days: [day('2026-11-02', { plannedBreakMinutes: 601 })] }))).toBe('400:plan_break_invalid');
		expect(await code(api.putPlanWeek('2026-W99', { days: [] }))).toBe('400:invalid_week');
	});

	it('keeps old single-day clients working', async () => {
		const plain = await api.putPlanDay('2026-11-10', { mode: 'home' });
		expect(plain).toMatchObject({ mode: 'home', plannedStart: null, plannedSeconds: null });
		expect(await code(api.putPlanDay('2026-11-10', { mode: 'home', plannedBreakMinutes: 15 }))).toBe('400:plan_break_invalid');
	});
});
