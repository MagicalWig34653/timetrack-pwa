import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from './zone.svelte.js';

let mock: ReturnType<typeof createMockFetch>;
let zone: string | null = 'Europe/Berlin';

const login = async () => {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
};

beforeEach(async () => {
	mock = createMockFetch();
	zone = 'Europe/Berlin';
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
		if ((init.method ?? 'GET').toUpperCase() === 'GET' && String(input).endsWith('/work-models')) {
			if (zone === null) throw new TypeError('Failed to fetch');
			return new Response(JSON.stringify([{ id: 'm1', validFrom: '2026-01-01', validTo: null, timezone: zone }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		return mock.fetch(input, init);
	});
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	await login();
});
afterEach(() => vi.unstubAllGlobals());

describe('time zone of the account (review finding 7)', () => {
	it('loads the zone again after another sign-in without a page reload', async () => {
		expect(await zoneStore.ensure()).toBe('Europe/Berlin');
		await sessionStore.signOut();
		zone = 'America/New_York';
		await login();
		expect(await zoneStore.ensure()).toBe('America/New_York');
	});
	it('asks again after a failed first query', async () => {
		zone = null;
		expect(await zoneStore.ensure()).toBe('Europe/Berlin');
		zone = 'Asia/Tokyo';
		expect(await zoneStore.ensure()).toBe('Asia/Tokyo');
	});
	it('follows a changed work model after invalidate()', async () => {
		expect(await zoneStore.ensure()).toBe('Europe/Berlin');
		zone = 'Europe/London';
		await api.createWorkModel({ validFrom: '2026-11-01', weeklyTargetSeconds: 144000, workdays: [1, 2, 3, 4, 5] }).catch(() => undefined);
		zoneStore.invalidate();
		expect(await zoneStore.ensure()).toBe('Europe/London');
	});
});
