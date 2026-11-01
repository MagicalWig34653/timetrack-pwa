import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import { createMockFetch } from './fetch.ts';

const NOW = Date.parse('2026-10-14T09:30:00Z');
beforeEach(async () => {
	const mock = createMockFetch({ now: () => NOW });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	const opts = await api.loginOptions();
	await api.loginVerify(opts.challengeId, { id: 'mock-login' });
});
afterEach(() => vi.unstubAllGlobals());

const base = { region: 'DE-ST', annualEntitlementHalfDays: 60 };
const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: ApiError) => `${e.status}:${e.code}`);

describe('mock company days (contract 0.32.0)', () => {
	it('lists 24.12. and 31.12. with none by default', async () => {
		const settings = await api.getVacationSettings();
		expect(settings.companyDays).toEqual([
			{ month: 12, day: 24, treatment: 'none', name: 'Heiligabend' },
			{ month: 12, day: 31, treatment: 'none', name: 'Silvester' }
		]);
		expect((await api.listHolidays(2026)).some((h) => h.startDate === '2026-12-24')).toBe(false);
	});

	it('keeps the rules on a PUT without the field and replaces them with it', async () => {
		await api.putVacationSettings({ ...base, companyDays: [{ month: 12, day: 24, treatment: 'half' }] });
		await api.putVacationSettings({ ...base });
		expect((await api.getVacationSettings()).companyDays?.find((d) => d.day === 24)?.treatment).toBe('half');
		await api.putVacationSettings({ ...base, companyDays: [] });
		expect((await api.getVacationSettings()).companyDays?.find((d) => d.day === 24)?.treatment).toBe('none');
	});

	it('rejects invalid rules with 400', async () => {
		const put = (companyDays: unknown) => code(api.putVacationSettings({ ...base, companyDays } as never));
		expect(await put([{ month: 2, day: 29, treatment: 'full' }])).toMatch(/^400/);
		expect(await put([{ month: 6, day: 1, treatment: 'full' }, { month: 6, day: 1, treatment: 'half' }])).toMatch(/^400/);
		expect(await put([{ month: 6, day: 1, treatment: 'weird' }])).toMatch(/^400/);
		expect(await put(Array.from({ length: 13 }, (_, i) => ({ month: 1, day: i + 1, treatment: 'full' })))).toMatch(/^400/);
		expect(await put([{ month: 6, day: 1, treatment: 'full', name: 'x'.repeat(81) }])).toMatch(/^400/);
	});

	it('lists treated days as holidays with companyTreatment', async () => {
		await api.putVacationSettings({ ...base, companyDays: [{ month: 12, day: 24, treatment: 'half' }, { month: 12, day: 31, treatment: 'full' }, { month: 6, day: 12, treatment: 'full', name: 'Ausflug' }] });
		const list = await api.listHolidays(2026);
		expect(list.find((h) => h.startDate === '2026-12-24')).toMatchObject({ name: 'Heiligabend', kind: 'holiday', companyTreatment: 'half' });
		expect(list.find((h) => h.startDate === '2026-12-31')).toMatchObject({ name: 'Silvester', companyTreatment: 'full' });
		expect(list.find((h) => h.startDate === '2026-06-12')).toMatchObject({ name: 'Ausflug', companyTreatment: 'full' });
	});

	it('halves the target on a half day, zeroes it on a full day, and shows names in the week', async () => {
		await api.putVacationSettings({ ...base, companyDays: [{ month: 12, day: 24, treatment: 'half' }, { month: 12, day: 31, treatment: 'full' }] });
		const before = (await api.getTimeWeek('2026-W52')).days.find((d) => d.date === '2026-12-21')!;
		const week = await api.getTimeWeek('2026-W52');
		const half = week.days.find((d) => d.date === '2026-12-24')!;
		expect(half).toMatchObject({ mark: 'work', holidayName: 'Heiligabend', companyDayTreatment: 'half' });
		expect(half.targetSeconds).toBe(Math.round(before.targetSeconds / 2));
		const full = (await api.getTimeWeek('2026-W53')).days.find((d) => d.date === '2026-12-31')!;
		expect(full).toMatchObject({ mark: 'holiday', targetSeconds: 0, holidayName: 'Silvester', companyDayTreatment: 'full' });
		expect(before).toMatchObject({ holidayName: null, companyDayTreatment: null });
	});

	it('counts vacation on a half day as one half day and on a full day as none', async () => {
		await api.putVacationSettings({ ...base, companyDays: [{ month: 12, day: 24, treatment: 'half' }, { month: 12, day: 31, treatment: 'full' }] });
		const half = await api.createAbsence({ kind: 'vacation', startDate: '2026-12-24', endDate: '2026-12-24', status: 'planned' });
		expect(half.countedHalfDays).toBe(1);
		const full = await api.createAbsence({ kind: 'vacation', startDate: '2026-12-31', endDate: '2026-12-31', status: 'planned' });
		expect(full.countedHalfDays).toBe(0);
	});
});
