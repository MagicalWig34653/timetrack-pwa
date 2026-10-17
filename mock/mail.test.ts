import { describe, expect, it } from 'vitest';
import { createMockFetch } from './fetch.ts';

async function signedIn(options?: Parameters<typeof createMockFetch>[0]) {
	const mock = createMockFetch(options);
	const call = async (method: string, path: string, body?: unknown, csrf?: string) => {
		const response = await mock.fetch(path, {
			method,
			headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : undefined };
	};
	const first = await call('POST', '/api/v1/auth/login/options', {});
	const login = await call('POST', '/api/v1/auth/login/verify', { challengeId: first.body.challengeId, credential: { id: 'mock-login' } });
	const csrf = login.body.csrfToken as string;
	return { get: (p: string) => call('GET', p), post: (p: string, b?: unknown) => call('POST', p, b ?? {}, csrf) };
}

describe('mail diagnosis mock', () => {
	it('reports a configured server without credentials', async () => {
		const { get } = await signedIn();
		const { status, body } = await get('/api/v1/admin/mail');
		expect(status).toBe(200);
		expect(body).toMatchObject({ configured: true, host: 'smtp.example.org', port: 587, tls: 'starttls', authConfigured: true, source: 'environment' });
		expect(JSON.stringify(body)).not.toMatch(/password|user"/i);
	});

	it('reports an unconfigured server and refuses check and test with 501', async () => {
		const { get, post } = await signedIn({ mailAvailable: false });
		expect((await get('/api/v1/admin/mail')).body).toMatchObject({ configured: false, hints: [{ code: 'not_configured' }] });
		expect((await post('/api/v1/admin/mail/check')).status).toBe(501);
		expect((await post('/api/v1/admin/mail/test', { to: 'a@example.org' })).status).toBe(501);
	});

	it('scripts the scenarios: all ok, tls, auth, sender', async () => {
		const { post } = await signedIn();
		const ids = (r: any) => r.body.steps.map((s: any) => `${s.id}:${s.status}`);
		expect(ids(await post('/api/v1/admin/mail/check'))).toEqual(['dns:ok', 'tcp:ok', 'tls:ok', 'ehlo:ok', 'auth:ok', 'mailFrom:ok']);
		await post('/api/v1/mock/mail', { scenario: 'tls' });
		expect(ids(await post('/api/v1/admin/mail/check'))).toEqual(['dns:ok', 'tcp:ok', 'tls:failed', 'ehlo:skipped', 'auth:skipped', 'mailFrom:skipped']);
		await post('/api/v1/mock/mail', { scenario: 'auth' });
		const auth = await post('/api/v1/admin/mail/check');
		expect(auth.body.ok).toBe(false);
		expect(auth.body.steps[4].problem.code).toBe('auth_rejected');
		await post('/api/v1/mock/mail', { scenario: 'sender' });
		expect((await post('/api/v1/admin/mail/check')).body.steps[5].problem.code).toBe('sender_rejected');
	});

	it('sends a test mail to the given or own verified address, with the documented errors', async () => {
		const { post } = await signedIn();
		expect((await post('/api/v1/admin/mail/test', { to: 'Other@Example.org' })).body).toMatchObject({ sent: true, to: 'other@example.org' });
		expect((await post('/api/v1/admin/mail/test', { to: 'nope' })).status).toBe(400);
		await post('/api/v1/mock/mail', { rateLimit: true });
		expect((await post('/api/v1/admin/mail/test', { to: 'a@example.org' })).status).toBe(429);
		expect((await post('/api/v1/admin/mail/check')).status).toBe(429);
	});

	it('answers 404 like an older server', async () => {
		const { get, post } = await signedIn();
		await post('/api/v1/mock/mail', { old: true });
		expect((await get('/api/v1/admin/mail')).status).toBe(404);
	});
});
