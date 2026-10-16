import { describe, expect, it } from 'vitest';
import { createMockFetch } from './fetch.ts';

async function signedIn() {
	const mock = createMockFetch();
	let csrf = '';
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await mock.fetch(path, {
			method,
			headers: { 'Content-Type': 'application/json', ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : undefined };
	};
	const opts = await call('POST', '/api/v1/auth/login/options', {});
	const login = await call('POST', '/api/v1/auth/login/verify', { challengeId: opts.body.challengeId, credential: { id: 'mock-login' } });
	csrf = login.body.csrfToken;
	return { call, login: login.body };
}

describe('preferences mock (ADR-0020)', () => {
	it('returns the defaults, also inside the session, and merges patches', async () => {
		const { call, login } = await signedIn();
		expect(login.account.preferences).toEqual({ accent: 'blue', colorScheme: 'system' });
		expect((await call('GET', '/api/v1/me/preferences')).body).toEqual({ accent: 'blue', colorScheme: 'system' });
		const teal = await call('PATCH', '/api/v1/me/preferences', { accent: 'teal' });
		expect(teal.body).toMatchObject({ accent: 'teal', colorScheme: 'system' });
		expect(teal.body.updatedAt).toBeTruthy();
		expect((await call('PATCH', '/api/v1/me/preferences', { colorScheme: 'dark' })).body).toMatchObject({ accent: 'teal', colorScheme: 'dark' });
		expect((await call('GET', '/api/v1/auth/session')).body.account.preferences).toMatchObject({ accent: 'teal', colorScheme: 'dark' });
	});

	it('keeps the custom colour only for accent custom and normalises it', async () => {
		const { call } = await signedIn();
		expect((await call('PATCH', '/api/v1/me/preferences', { accent: 'custom' })).status).toBe(400);
		expect((await call('PATCH', '/api/v1/me/preferences', { accent: 'custom', accentCustomHex: '#12345' })).status).toBe(400);
		expect((await call('PATCH', '/api/v1/me/preferences', { accent: 'green', accentCustomHex: '#112233' })).status).toBe(400);
		const custom = await call('PATCH', '/api/v1/me/preferences', { accent: 'custom', accentCustomHex: '#12ab9f' });
		expect(custom.body).toMatchObject({ accent: 'custom', accentCustomHex: '#12AB9F' });
		expect((await call('PATCH', '/api/v1/me/preferences', { accent: 'orange' })).body).toMatchObject({ accent: 'orange', accentCustomHex: null });
	});

	it('refuses unknown keys, wrong values and an empty body', async () => {
		const { call } = await signedIn();
		for (const body of [{}, { theme: 'x' }, { accent: 'red' }, { colorScheme: 'auto' }, { accent: 'blue', appIcon: 'x' }]) {
			expect((await call('PATCH', '/api/v1/me/preferences', body)).status, JSON.stringify(body)).toBe(400);
		}
		expect((await call('GET', '/api/v1/me/preferences')).body).toEqual({ accent: 'blue', colorScheme: 'system' });
	});
});
