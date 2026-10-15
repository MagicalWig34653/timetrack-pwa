import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { moduleStore } from './store.svelte.js';

async function signIn() {
	const options = await api.loginOptions();
	return api.loginVerify(options.challengeId, { id: 'mock-login' });
}

let mock: ReturnType<typeof createMockFetch>;

beforeEach(() => {
	moduleStore.reset();
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
});
afterEach(() => {
	vi.unstubAllGlobals();
	setCsrfToken(null);
	moduleStore.reset();
});

describe('module store', () => {
	it('treats every module as enabled before it is loaded', () => {
		expect(moduleStore.enabled('reports')).toBe(true);
		expect(moduleStore.statuses).toBeNull();
	});

	it('loads once per account and follows changes', async () => {
		const session = await signIn();
		setCsrfToken(session.csrfToken);
		await moduleStore.ensure(session.account.id);
		await moduleStore.ensure(session.account.id);
		expect(mock.calls.filter((c) => c.path === '/api/v1/modules')).toHaveLength(1);
		expect(moduleStore.enabled('reports')).toBe(true);
		moduleStore.set(await api.putMyModules({ reports: false }));
		expect(moduleStore.enabled('reports')).toBe(false);
		expect(moduleStore.enabled('planning')).toBe(true);
	});

	it('treats all modules as enabled when the server does not know the API (404)', async () => {
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }));
		await moduleStore.refresh();
		expect(moduleStore.loaded).toBe(true);
		expect(moduleStore.statuses).toBeNull();
		expect(moduleStore.enabled('mcp')).toBe(true);
	});

	it('keeps the last state when a refresh fails with a network error', async () => {
		const session = await signIn();
		setCsrfToken(session.csrfToken);
		moduleStore.set(await api.putMyModules({ planning: false }));
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('offline');
		});
		await moduleStore.refresh();
		expect(moduleStore.enabled('planning')).toBe(false);
	});

	it('refreshes itself when a call answers 404 module_disabled', async () => {
		const session = await signIn();
		setCsrfToken(session.csrfToken);
		await moduleStore.ensure(session.account.id);
		// switched off behind the store's back (e.g. in another tab)
		await api.putMyModules({ reports: false });
		expect(moduleStore.enabled('reports')).toBe(true);
		await expect(api.listLearningFields()).rejects.toMatchObject({ status: 404, code: 'module_disabled' });
		await vi.waitFor(() => expect(moduleStore.enabled('reports')).toBe(false));
	});
});
