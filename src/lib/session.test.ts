import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';

let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('signing out (review finding 6)', () => {
	it('keeps the session and reports the failure when the server never confirmed the end of the session', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
			if ((init.method ?? 'GET').toUpperCase() === 'DELETE' && String(input).endsWith('/auth/session')) throw new TypeError('Failed to fetch');
			return mock.fetch(input, init);
		});
		await expect(sessionStore.signOut()).rejects.toBeDefined();
		expect(sessionStore.current).not.toBeNull();
	});
	it('clears the local session once the server ended it', async () => {
		await sessionStore.signOut();
		expect(sessionStore.current).toBeNull();
	});
	it('treats an already ended session (401) as signed out', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
			if ((init.method ?? 'GET').toUpperCase() === 'DELETE' && String(input).endsWith('/auth/session')) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
			return mock.fetch(input, init);
		});
		await sessionStore.signOut();
		expect(sessionStore.current).toBeNull();
	});
});
