import { afterEach, describe, expect, it } from 'vitest';
import { api } from '#lib/api/client.js';
import { daySource } from './source.js';

// The fallback source (server without GET /time/statistics) must not turn failed required queries into plausible charts.
const original = { ...api };
afterEach(() => Object.assign(api, original));

const query = { from: '2026-10-05', to: '2026-10-11', granularity: 'week' as const, rounded: true, today: '2026-10-11', timeZone: 'Europe/Berlin' };
const failure = (status: number) => async () => {
	throw Object.assign(new Error('failed'), { status });
};
const day = (date: string, segmentIds: string[] = []) => ({ date, segmentIds, segments: segmentIds.length ? undefined : [] });
function stub(overrides: Record<string, unknown>) {
	Object.assign(api, { listDays: async () => [day('2026-10-05')], listSegments: async () => [], listAbsences: async () => [], getTimeAccount: async () => ({ balanceSeconds: 3600 }), ...overrides });
}

describe('daySource', () => {
	it('fails when absences cannot be loaded instead of charting none', async () => {
		stub({ listAbsences: failure(500) });
		await expect(daySource.load(query)).rejects.toThrow();
	});
	it('fails when required segments cannot be loaded', async () => {
		stub({ listDays: async () => [day('2026-10-05', ['a'])], listSegments: failure(500) });
		await expect(daySource.load(query)).rejects.toThrow();
	});
	it('does not need the segment query when the days embed their segments', async () => {
		stub({ listSegments: failure(500) });
		await expect(daySource.load(query)).resolves.toBeTruthy();
	});
	it('marks the balance unavailable when the account endpoint is missing', async () => {
		stub({ getTimeAccount: failure(404) });
		expect((await daySource.load(query)).balanceAvailable).toBe(false);
	});
	it('surfaces other account errors', async () => {
		stub({ getTimeAccount: failure(500) });
		await expect(daySource.load(query)).rejects.toThrow();
	});
	it('reports the balance when the account answers', async () => {
		stub({});
		const data = await daySource.load(query);
		expect(data.balanceAvailable).toBe(true);
		expect(data.openingBalanceSeconds).toBe(3600);
	});
});
