import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import { createMockFetch } from './fetch.ts';

// Wednesday 14.10.2026. Seed: taken 07.-09.09., approved 26.-30.10. (5 days), planned 23.-25.11. (2,5 days).
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

describe('mock GET /vacation/suggestions', () => {
	it('returns the budget and ranked, non-overlapping suggestions', async () => {
		const result = await api.getVacationSuggestions({ limit: 100 });
		expect(result.from).toBe('2026-10-14');
		expect(result.to).toBe('2027-12-31');
		expect(result.budget).toEqual({ entitlementDays: 30, takenDays: 8, plannedDays: 2.5, remainingDays: 19.5 });
		const list = result.suggestions;
		expect(list.length).toBeGreaterThan(5);
		for (let i = 1; i < list.length; i++) {
			const [a, b] = [list[i - 1], list[i]];
			expect(a.efficiency >= b.efficiency).toBe(true);
		}
		const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
		for (let i = 1; i < sorted.length; i++) expect(sorted[i].start > sorted[i - 1].end).toBe(true);
		expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
		for (const s of list) expect(s.id).toMatch(/^[0-9a-f]{16}$/);
	});

	it('finds the Ascension bridge day 2027 with the holiday and one vacation day', async () => {
		const result = await api.getVacationSuggestions({ from: '2027-05-01', to: '2027-05-31', limit: 5 });
		const bridge = result.suggestions.find((s) => s.start === '2027-05-06');
		expect(bridge).toMatchObject({ kind: 'bridge', end: '2027-05-09', vacationDates: ['2027-05-07'], vacationDaysNeeded: 1, totalDaysOff: 4, efficiency: 4, fitsBudget: true });
		expect(bridge!.holidays).toEqual([{ date: '2027-05-06', name: 'Christi Himmelfahrt' }]);
	});

	it('marks windows that touch existing vacation and plan days instead of hiding them', async () => {
		const result = await api.getVacationSuggestions({ from: '2026-10-14', to: '2026-11-08', limit: 100 });
		const window = result.suggestions.find((s) => s.conflicts.some((c) => c.type === 'already_vacation'));
		expect(window).toBeDefined();
		const conflicting = window!.conflicts.map((c) => c.type);
		expect(conflicting).toContain('already_vacation');
		// already booked days are not vacation days of the suggestion again
		for (const c of window!.conflicts.filter((x) => x.type === 'already_vacation')) expect(window!.vacationDates).not.toContain(c.date);
	});

	it('flags a suggestion that exceeds the remaining budget', async () => {
		const result = await api.getVacationSuggestions({ from: '2026-11-02', to: '2026-12-31', maxVacationDays: 60, minDaysOff: 20, limit: 5 });
		const big = result.suggestions.find((s) => s.vacationDaysNeeded > 19.5);
		if (big) {
			expect(big.fitsBudget).toBe(false);
			expect(big.remainingAfter).toBeLessThan(0);
		}
	});

	it('validates the query like the backend', async () => {
		expect(await code(api.getVacationSuggestions({ from: '2026-10-14', to: '2026-10-01' }))).toBe('400:invalid');
		expect(await code(api.getVacationSuggestions({ maxVacationDays: 0 }))).toBe('400:invalid');
		expect(await code(api.getVacationSuggestions({ limit: 101 }))).toBe('400:invalid');
		expect(await code(api.getVacationSuggestions({ from: '2026-01-01', to: '2028-12-31' }))).toBe('400:range_too_large');
	});

	it('respects maxVacationDays and minDaysOff', async () => {
		const result = await api.getVacationSuggestions({ maxVacationDays: 2, minDaysOff: 6, limit: 100 });
		for (const s of result.suggestions) {
			expect(s.vacationDaysNeeded).toBeLessThanOrEqual(2);
			expect(s.totalDaysOff).toBeGreaterThanOrEqual(6);
		}
	});

	it('does not change data and is not affected by bookings made afterwards', async () => {
		const before = await api.getVacationSuggestions({ from: '2027-05-01', to: '2027-05-31' });
		await api.createAbsence({ kind: 'vacation', startDate: '2027-05-07', endDate: '2027-05-07', status: 'planned' });
		const after = await api.getVacationSuggestions({ from: '2027-05-01', to: '2027-05-31' });
		expect(before.suggestions.some((s) => s.start === '2027-05-06')).toBe(true);
		expect(after.suggestions.some((s) => s.start === '2027-05-06' && s.vacationDates.includes('2027-05-07'))).toBe(false);
		expect(after.budget.plannedDays).toBe(before.budget.plannedDays + 1);
	});
});
