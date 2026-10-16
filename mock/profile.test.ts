import { describe, expect, it } from 'vitest';
import { createMockFetch } from './fetch.ts';

async function signedIn(options?: Parameters<typeof createMockFetch>[0]) {
	const mock = createMockFetch(options);
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

describe('profile mock (ADR-0019)', () => {
	it('edits the display name and keeps the handle read-only', async () => {
		const { call } = await signedIn();
		expect((await call('GET', '/api/v1/me/profile')).body).toMatchObject({ handle: 'admin', displayName: 'Admin Demo', emailVerified: false, mailAvailable: true });
		expect((await call('PATCH', '/api/v1/me/profile', { displayName: ' Neu ' })).body.displayName).toBe('Neu');
		expect((await call('PATCH', '/api/v1/me/profile', { displayName: '' })).status).toBe(400);
		expect((await call('PATCH', '/api/v1/me/profile', { displayName: 'x'.repeat(81) })).status).toBe(400);
		// unknown fields are ignored: the handle never changes
		expect((await call('PATCH', '/api/v1/me/profile', { displayName: 'A', handle: 'other' })).body).toMatchObject({ displayName: 'A', handle: 'admin' });
	});

	it('changes the e-mail only after the code, with attempt limit and removal', async () => {
		const { call } = await signedIn();
		expect((await call('PUT', '/api/v1/me/profile/email', { email: 'nope' })).status).toBe(400);
		expect((await call('PUT', '/api/v1/me/profile/email', { email: 'Neu@Example.test' })).status).toBe(202);
		expect((await call('GET', '/api/v1/me/profile')).body).toMatchObject({ email: null, pendingEmail: 'neu@example.test' });
		expect((await call('POST', '/api/v1/me/profile/email/verify', { code: 'x' })).body.error.code).toBe('invalid_code');
		const done = await call('POST', '/api/v1/me/profile/email/verify', { code: '123456' });
		expect(done.body).toMatchObject({ email: 'neu@example.test', emailVerified: true, pendingEmail: null });
		expect((await call('DELETE', '/api/v1/me/profile/email')).status).toBe(204);
		expect((await call('GET', '/api/v1/me/profile')).body).toMatchObject({ email: null, emailVerified: false });
		await call('PUT', '/api/v1/me/profile/email', { email: 'a@example.test' });
		for (let i = 0; i < 5; i++) await call('POST', '/api/v1/me/profile/email/verify', { code: 'bad' });
		expect((await call('POST', '/api/v1/me/profile/email/verify', { code: '123456' })).status).toBe(400);
	});

	it('answers 501 without mail and 403 for stale sessions', async () => {
		const nomail = await signedIn({ mailAvailable: false });
		expect((await nomail.call('GET', '/api/v1/me/profile')).body.mailAvailable).toBe(false);
		expect((await nomail.call('PUT', '/api/v1/me/profile/email', { email: 'a@example.test' })).status).toBe(501);
		const stale = await signedIn();
		await stale.call('POST', '/api/v1/mock/accounts', { staleSessions: true });
		expect((await stale.call('PUT', '/api/v1/me/profile/email', { email: 'a@example.test' })).body.error.code).toBe('reauth_required');
		expect((await stale.call('DELETE', '/api/v1/me/profile/email')).status).toBe(403);
	});

	it('tracks the onboarding flag per account; demo accounts count as skipped', async () => {
		const { call, login } = await signedIn();
		expect(login.account.onboardingState).toBe('skipped');
		expect((await call('PUT', '/api/v1/me/onboarding', { state: 'bogus' })).status).toBe(400);
		expect((await call('PUT', '/api/v1/me/onboarding', { state: 'completed' })).body.onboarding.state).toBe('completed');
		expect((await call('GET', '/api/v1/auth/session')).body.account.onboardingState).toBe('completed');
		expect((await call('PUT', '/api/v1/me/onboarding', { state: 'pending' })).body.onboarding.state).toBe('pending');
	});
});
