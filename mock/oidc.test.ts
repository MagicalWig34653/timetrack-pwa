import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '../src/lib/api/client.ts';
import { createMockFetch } from './fetch.ts';

let mock: ReturnType<typeof createMockFetch>;

beforeEach(() => {
	mock = createMockFetch({ oidc: { name: 'Test-IdP' } });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
});

async function signIn() {
	const options = await api.loginOptions();
	await api.loginVerify(options.challengeId, { id: 'mock-login' });
}

/** Runs one provider round trip like the browser: start, then the callback GET; returns the redirect location. */
async function roundTrip(purpose: 'login' | 'link' | 'register', outcome: string, inviteToken?: string): Promise<string> {
	const { authorizationUrl } = await api.oidcStart(purpose, inviteToken);
	const flow = new URL(authorizationUrl, 'http://localhost').searchParams.get('flow');
	const response = await mock.fetch(`/api/v1/auth/oidc/callback?flow=${flow}&outcome=${outcome}`);
	expect(response.status).toBe(302);
	return response.headers.get('Location')!;
}

describe('mock OIDC', () => {
	it('is disabled by default and reports the provider name when enabled', async () => {
		expect(await api.oidcConfig()).toEqual({ enabled: true, name: 'Test-IdP' });
		vi.stubGlobal('fetch', createMockFetch().fetch);
		expect(await api.oidcConfig()).toEqual({ enabled: false });
		await expect(api.oidcStart('login')).rejects.toMatchObject({ status: 404 });
	});

	it('start points to the in-app mock IdP page', async () => {
		const { authorizationUrl } = await api.oidcStart('login');
		expect(authorizationUrl).toMatch(/^\/mock-idp\?flow=/);
	});

	it('refuses login with an unlinked identity (oidc_not_linked, no account created)', async () => {
		const before = mock.state.accounts.size;
		expect(await roundTrip('login', 'user1')).toBe('/login?oidc_error=oidc_not_linked');
		expect(mock.state.accounts.size).toBe(before);
	});

	it('flows are single use (oidc_state_invalid)', async () => {
		const { authorizationUrl } = await api.oidcStart('login');
		const flow = new URL(authorizationUrl, 'http://localhost').searchParams.get('flow');
		await mock.fetch(`/api/v1/auth/oidc/callback?flow=${flow}&outcome=user1`);
		const again = await mock.fetch(`/api/v1/auth/oidc/callback?flow=${flow}&outcome=user1`);
		expect(again.headers.get('Location')).toBe('/login?oidc_error=oidc_state_invalid');
	});

	it('simulates provider error outcomes', async () => {
		for (const code of ['oidc_token_invalid', 'oidc_failed', 'oidc_state_invalid']) {
			expect(await roundTrip('login', `error:${code}`)).toBe(`/login?oidc_error=${code}`);
		}
	});

	it('links an identity for a signed-in account, then logs in with it', async () => {
		await signIn();
		expect(await api.listIdentities()).toEqual([]);
		expect(await roundTrip('link', 'user1')).toBe('/settings/identities?linked=1');
		const [identity] = await api.listIdentities();
		expect(identity).toMatchObject({ providerName: 'Test-IdP', emailHint: 'demo@mock-idp.example', lastUsedAt: null });
		expect(identity).not.toHaveProperty('sub');
		await api.logout();
		expect(await roundTrip('login', 'user1')).toBe('/');
		await api.currentSession();
		expect((await api.listIdentities())[0].lastUsedAt).not.toBeNull();
	});

	it('refuses to link an identity that belongs to another account (oidc_identity_taken)', async () => {
		await signIn();
		expect(await roundTrip('link', 'user2')).toBe('/login?oidc_error=oidc_identity_taken');
	});

	it('requires a session for link and a fresh one (reauth_required)', async () => {
		await expect(api.oidcStart('link')).rejects.toMatchObject({ status: 401 });
		await signIn();
		await roundTrip('link', 'user1');
		const id = (await api.listIdentities())[0].id;
		await mock.fetch('/api/v1/mock/oidc', { method: 'POST', body: JSON.stringify({ staleSessions: true }) });
		await expect(api.oidcStart('link')).rejects.toMatchObject({ status: 403, code: 'reauth_required' });
		await expect(api.unlinkIdentity(id)).rejects.toMatchObject({ status: 403, code: 'reauth_required' });
		await signIn(); // a new session is fresh again
		await api.unlinkIdentity(id);
		expect(await api.listIdentities()).toEqual([]);
	});

	it('registers with an invitation: pending id, then account without passkey, last_login_method protects the identity', async () => {
		const location = await roundTrip('register', 'user1', 'demo-invite');
		const pendingId = new URL(location, 'http://localhost').searchParams.get('oidc')!;
		expect(location).toMatch(/^\/invite\/demo-invite\?oidc=/);
		await expect(api.oidcRegister({ pendingId, handle: 'Bad Handle', displayName: 'X' })).rejects.toMatchObject({ status: 400 });
		await expect(api.oidcRegister({ pendingId, handle: 'admin', displayName: 'X' })).rejects.toMatchObject({ code: 'handle_taken' });
		const session = await api.oidcRegister({ pendingId, handle: 'oidc-mia', displayName: 'Mia' });
		expect(session.account).toMatchObject({ handle: 'oidc-mia', role: 'member' });
		expect(mock.state.passkeys.filter((p) => p.accountId === session.account.id)).toHaveLength(0);
		// invitation and pending id are consumed
		await expect(api.oidcRegister({ pendingId, handle: 'oidc-mia2', displayName: 'Mia' })).rejects.toMatchObject({ status: 404 });
		await expect(api.oidcStart('register', 'demo-invite')).rejects.toMatchObject({ status: 404 });
		// the only login method cannot be removed
		const [identity] = await api.listIdentities();
		const error = await api.unlinkIdentity(identity.id).catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 409, code: 'last_login_method' });
	});

	it('register callback refuses an unknown invitation and an already linked identity', async () => {
		await expect(api.oidcStart('register', 'nope')).rejects.toMatchObject({ status: 404 });
		expect(await roundTrip('register', 'user2', 'demo-invite')).toBe('/login?oidc_error=oidc_identity_taken');
	});
});
