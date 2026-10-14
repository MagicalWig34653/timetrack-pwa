import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '../src/lib/api/client.ts';
import type { McpScope } from '../src/lib/api/types.ts';
import { createMockFetch } from './fetch.ts';

let mock: ReturnType<typeof createMockFetch>;
let now = Date.parse('2026-10-15T10:00:00Z');

beforeEach(() => {
	now = Date.parse('2026-10-15T10:00:00Z');
	mock = createMockFetch({ now: () => now });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
});

async function signIn() {
	const options = await api.loginOptions();
	await api.loginVerify(options.challengeId, { id: 'mock-login' });
}

async function register(redirectUri = 'https://chatgpt.com/cb', name = 'ChatGPT') {
	const response = await mock.fetch('/oauth/register', {
		method: 'POST',
		body: JSON.stringify({ client_name: name, redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' })
	});
	return { response, body: await response.json() };
}

/** Registers a client, calls /oauth/authorize and returns the consent request id. */
async function startFlow(scope = 'time:read time:write', state = 'xyz'): Promise<string> {
	const { body } = await register();
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: body.client_id,
		redirect_uri: 'https://chatgpt.com/cb',
		code_challenge: 'abc',
		code_challenge_method: 'S256',
		scope,
		state,
		resource: 'https://tt.example/mcp'
	});
	const response = await mock.fetch(`/oauth/authorize?${params}`);
	expect(response.status).toBe(302);
	return new URL(response.headers.get('Location')!, 'http://localhost').searchParams.get('request')!;
}

describe('mock OAuth server', () => {
	it('registers public clients only with https or loopback redirects (max 5, name <= 100)', async () => {
		expect((await register()).response.status).toBe(201);
		expect((await register('http://127.0.0.1:8123/cb')).response.status).toBe(201);
		expect((await register('http://example.org/cb')).response.status).toBe(400);
		expect((await register('https://x.example/cb', 'n'.repeat(101))).response.status).toBe(400);
	});

	it('redirects /oauth/authorize to the consent page and refuses unknown clients or foreign redirect URIs', async () => {
		const id = await startFlow();
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect((await mock.fetch('/oauth/authorize?client_id=nope&redirect_uri=https://a.example')).status).toBe(400);
		const { body } = await register();
		const foreign = await mock.fetch(`/oauth/authorize?client_id=${body.client_id}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}`);
		expect(foreign.status).toBe(400);
	});

	it('answers PKCE/resource mistakes with an error redirect to the registered redirect URI', async () => {
		const { body } = await register();
		const base = { response_type: 'code', client_id: body.client_id, redirect_uri: 'https://chatgpt.com/cb', state: 's1', resource: 'https://tt.example/mcp' };
		const noPkce = await mock.fetch(`/oauth/authorize?${new URLSearchParams({ ...base, code_challenge: 'a', code_challenge_method: 'plain' })}`);
		expect(noPkce.headers.get('Location')).toBe('https://chatgpt.com/cb?error=invalid_request&state=s1');
		const badScope = await mock.fetch(`/oauth/authorize?${new URLSearchParams({ ...base, code_challenge: 'a', code_challenge_method: 'S256', scope: 'admin:all' })}`);
		expect(badScope.headers.get('Location')).toContain('error=invalid_scope');
	});
});

describe('mock consent requests', () => {
	it('requires a session and exposes client name, redirect host and the requested scopes', async () => {
		const id = await startFlow();
		await expect(api.getOAuthRequest(id)).rejects.toMatchObject({ status: 401 });
		await signIn();
		expect(await api.getOAuthRequest(id)).toMatchObject({ id, clientName: 'ChatGPT', redirectHost: 'chatgpt.com', scopes: ['time:read', 'time:write'] });
	});

	it('answers 404 for unknown and expired requests', async () => {
		await signIn();
		await expect(api.getOAuthRequest('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
		const id = await startFlow();
		now += 11 * 60_000;
		await expect(api.getOAuthRequest(id)).rejects.toMatchObject({ status: 404 });
		await expect(api.decideOAuthRequest(id, true, ['time:read'])).rejects.toMatchObject({ status: 404 });
	});

	it('approves a subset of the requested scopes, builds the redirect with code and state and creates a grant', async () => {
		await signIn();
		const id = await startFlow();
		const { redirectUrl } = await api.decideOAuthRequest(id, true, ['time:read']);
		const url = new URL(redirectUrl);
		expect(url.origin + url.pathname).toBe('https://chatgpt.com/cb');
		expect(url.searchParams.get('code')).toBeTruthy();
		expect(url.searchParams.get('state')).toBe('xyz');
		expect(await api.listOAuthGrants()).toMatchObject([{ clientName: 'ChatGPT', scopes: ['time:read'], lastUsedAt: null }]);
	});

	it('refuses scopes beyond the request and empty approvals', async () => {
		await signIn();
		const id = await startFlow();
		await expect(api.decideOAuthRequest(id, true, ['time:read', 'reports:write'])).rejects.toMatchObject({ status: 400 });
		await expect(api.decideOAuthRequest(id, true, [])).rejects.toMatchObject({ status: 400 });
		expect(await api.listOAuthGrants()).toEqual([]);
	});

	it('denies with error=access_denied, creates no grant, and decides only once (409)', async () => {
		await signIn();
		const id = await startFlow();
		const { redirectUrl } = await api.decideOAuthRequest(id, false);
		expect(new URL(redirectUrl).searchParams.get('error')).toBe('access_denied');
		expect(new URL(redirectUrl).searchParams.get('state')).toBe('xyz');
		expect(await api.listOAuthGrants()).toEqual([]);
		await expect(api.decideOAuthRequest(id, true, ['time:read'])).rejects.toMatchObject({ status: 409 });
		await expect(api.getOAuthRequest(id)).rejects.toMatchObject({ status: 409 });
	});

	it('revokes grants and answers 404 for unknown ids', async () => {
		await signIn();
		await api.decideOAuthRequest(await startFlow(), true, ['time:read']);
		const [grant] = await api.listOAuthGrants();
		await api.revokeOAuthGrant(grant.id);
		expect(await api.listOAuthGrants()).toEqual([]);
		await expect(api.revokeOAuthGrant(grant.id)).rejects.toMatchObject({ status: 404 });
	});
});

describe('mock personal API tokens', () => {
	const scopes: McpScope[] = ['time:read', 'reports:read'];

	it('creates a token with the plaintext only in the response, lists it without the secret and revokes it', async () => {
		await signIn();
		const created = await api.createApiToken({ name: 'Laptop', scopes, expiresInDays: 30 });
		expect(created.token).toMatch(/^ttp_[A-Za-z0-9]{43}$/);
		expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(30 * 86_400_000);
		const listed = await api.listApiTokens();
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain(created.token);
		await api.revokeApiToken(created.id);
		expect(await api.listApiTokens()).toEqual([]);
		await expect(api.revokeApiToken(created.id)).rejects.toMatchObject({ status: 404 });
	});

	it('validates name, scopes and the expiry range 1..365', async () => {
		await signIn();
		for (const bad of [
			{ name: '', scopes, expiresInDays: 30 },
			{ name: 'x'.repeat(81), scopes, expiresInDays: 30 },
			{ name: 'ok', scopes: [], expiresInDays: 30 },
			{ name: 'ok', scopes: ['admin' as McpScope], expiresInDays: 30 },
			{ name: 'ok', scopes, expiresInDays: 0 },
			{ name: 'ok', scopes, expiresInDays: 366 }
		]) {
			await expect(api.createApiToken(bad)).rejects.toMatchObject({ status: 400 });
		}
		expect(await api.listApiTokens()).toEqual([]);
	});

	it('demands a fresh session for creating (403 reauth_required)', async () => {
		await signIn();
		await mock.fetch('/api/v1/mock/oidc', { method: 'POST', body: JSON.stringify({ staleSessions: true }) });
		const error = await api.createApiToken({ name: 'Laptop', scopes, expiresInDays: 30 }).catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 403, code: 'reauth_required' });
	});
});
