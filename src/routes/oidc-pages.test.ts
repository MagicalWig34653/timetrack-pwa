import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const navigateTo = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({
	url: new URL('http://localhost/login'),
	params: {} as Record<string, string>
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('#lib/browser.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('#lib/browser.js')>()), navigateTo }));
vi.mock('#lib/webauthn.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/webauthn.js')>()),
	isWebAuthnSupported: () => true,
	createPasskey: vi.fn(async () => ({ id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} })),
	getPasskey: vi.fn(async () => ({ id: 'mock-login', rawId: 'x', type: 'public-key', response: {} }))
}));

import LoginPage from './(public)/login/+page.svelte';
import InvitePage from './(public)/invite/[token]/+page.svelte';
import IdentitiesPage from './(app)/settings/identities/+page.svelte';
import MockIdpPage from './mock-idp/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

function useMock(oidc: boolean) {
	mock = createMockFetch({ oidc: oidc ? { name: 'Authentik' } : false });
	vi.stubGlobal('fetch', mock.fetch);
}

async function signInAsAdmin() {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
}

async function callback(flowUrl: string, outcome: string): Promise<string> {
	const flow = new URL(flowUrl, 'http://localhost').searchParams.get('flow');
	return (await mock.fetch(`/api/v1/auth/oidc/callback?flow=${flow}&outcome=${outcome}`)).headers.get('Location')!;
}

beforeEach(() => {
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
	navigateTo.mockReset();
	pageState.params = {};
	pageState.url = new URL('http://localhost/login');
});
afterEach(() => vi.unstubAllGlobals());

describe('login with OIDC', () => {
	it('shows no provider button when OIDC is disabled', async () => {
		useMock(false);
		render(LoginPage);
		await waitFor(() => expect(mock.calls.some((c) => c.path.endsWith('/auth/oidc/config'))).toBe(true));
		expect(screen.queryByRole('button', { name: /^Mit Authentik/ })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeInTheDocument();
	});

	it('keeps the passkey login working when the config call fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 501 })));
		render(LoginPage);
		expect(screen.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeEnabled();
	});

	it('shows a secondary provider button below the passkey button and starts the flow', async () => {
		useMock(true);
		render(LoginPage);
		const oidcButton = await screen.findByRole('button', { name: 'Mit Authentik anmelden' });
		const passkeyButton = screen.getByRole('button', { name: 'Mit Passkey anmelden' });
		expect(passkeyButton.compareDocumentPosition(oidcButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		await userEvent.click(oidcButton);
		await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(expect.stringMatching(/^\/mock-idp\?flow=/)));
	});

	it('explains oidc_not_linked in German and cleans the URL, keeping other parameters', async () => {
		useMock(true);
		pageState.url = new URL('http://localhost/login?oidc_error=oidc_not_linked&next=/vacation');
		render(LoginPage);
		expect(await screen.findByRole('alert')).toHaveTextContent(/per Einladung.*Einstellungen/);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login?next=%2Fvacation', { replaceState: true }));
	});

	it.each([
		['oidc_state_invalid', /abgelaufen/],
		['oidc_token_invalid', /gültige Bestätigung/],
		['oidc_identity_taken', /anderen Timetrack-Konto/],
		['oidc_invite_invalid', /Einladung/],
		['oidc_reauth_required', /frische Anmeldung/],
		['oidc_failed', /fehlgeschlagen/],
		['unknown_code', /fehlgeschlagen/]
	])('shows a German message for %s', async (code, pattern) => {
		useMock(true);
		pageState.url = new URL(`http://localhost/login?oidc_error=${code}`);
		render(LoginPage);
		expect(await screen.findByRole('alert')).toHaveTextContent(pattern);
	});
});

describe('invite with OIDC', () => {
	it('offers registering with the provider only when enabled, passing the invite token', async () => {
		useMock(false);
		pageState.params = { token: 'demo-invite' };
		const view = render(InvitePage);
		await screen.findByLabelText('Kontoname');
		expect(screen.queryByRole('button', { name: /Stattdessen mit/ })).not.toBeInTheDocument();
		view.unmount();

		useMock(true);
		render(InvitePage);
		await userEvent.click(await screen.findByRole('button', { name: 'Stattdessen mit Authentik registrieren' }));
		await waitFor(() => expect(navigateTo).toHaveBeenCalled());
		expect(mock.calls.some((c) => c.path.endsWith('/auth/oidc/start'))).toBe(true);
	});

	it('completes the registration after the provider round trip and then prompts for a passkey', async () => {
		useMock(true);
		const { authorizationUrl } = await api.oidcStart('register', 'demo-invite');
		const location = await callback(authorizationUrl, 'user1');
		pageState.params = { token: 'demo-invite' };
		pageState.url = new URL(location, 'http://localhost');
		render(InvitePage);
		await userEvent.type(await screen.findByLabelText('Kontoname'), 'mia');
		await userEvent.type(screen.getByLabelText('Anzeigename'), 'Mia Muster');
		await userEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
		expect(await screen.findByRole('heading', { name: 'Passkey einrichten' })).toBeInTheDocument();
		expect(sessionStore.current?.account.handle).toBe('mia');
		await userEvent.click(screen.getByRole('button', { name: 'Passkey einrichten' }));
		expect(goto).toHaveBeenCalledWith('/settings/passkeys');
	});

	it('shows a German message when the pending registration is gone', async () => {
		useMock(true);
		pageState.params = { token: 'demo-invite' };
		pageState.url = new URL('http://localhost/invite/demo-invite?oidc=stale');
		render(InvitePage);
		await userEvent.type(await screen.findByLabelText('Kontoname'), 'mia');
		await userEvent.type(screen.getByLabelText('Anzeigename'), 'Mia');
		await userEvent.click(screen.getByRole('button', { name: 'Konto anlegen' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(/abgelaufen oder wurde bereits abgeschlossen/);
	});
});

describe('identities settings', () => {
	it('shows the success banner for ?linked=1 and lists the identity with the e-mail marked as hint', async () => {
		useMock(true);
		await signInAsAdmin();
		const { authorizationUrl } = await api.oidcStart('link');
		await callback(authorizationUrl, 'user1');
		pageState.url = new URL('http://localhost/settings/identities?linked=1');
		render(IdentitiesPage);
		expect(await screen.findByText('Das externe Konto wurde verknüpft.')).toBeInTheDocument();
		expect(await screen.findByText('Authentik')).toBeInTheDocument();
		expect(screen.getByText(/nur Hinweis/)).toBeInTheDocument();
		expect(screen.getByText(/noch nicht genutzt/)).toBeInTheDocument();
	});

	it('starts linking from the button', async () => {
		useMock(true);
		await signInAsAdmin();
		pageState.url = new URL('http://localhost/settings/identities');
		render(IdentitiesPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Konto verknüpfen' }));
		await waitFor(() => expect(navigateTo).toHaveBeenCalled());
	});

	it('asks to log in again when the server requires a fresh session', async () => {
		useMock(true);
		await signInAsAdmin();
		await mock.fetch('/api/v1/mock/oidc', { method: 'POST', body: JSON.stringify({ staleSessions: true }) });
		pageState.url = new URL('http://localhost/settings/identities');
		render(IdentitiesPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Konto verknüpfen' }));
		expect(await screen.findByText('Frische Anmeldung nötig')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Abmelden und neu anmelden' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login?next=%2Fsettings%2Fidentities'));
	});

	it('shows the reauth hint for ?oidc_error=oidc_reauth_required', async () => {
		useMock(true);
		await signInAsAdmin();
		pageState.url = new URL('http://localhost/settings/identities?oidc_error=oidc_reauth_required');
		render(IdentitiesPage);
		expect(await screen.findByText('Frische Anmeldung nötig')).toBeInTheDocument();
	});

	it('unlinks after confirmation', async () => {
		useMock(true);
		await signInAsAdmin();
		const { authorizationUrl } = await api.oidcStart('link');
		await callback(authorizationUrl, 'user1');
		pageState.url = new URL('http://localhost/settings/identities');
		render(IdentitiesPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Verknüpfung entfernen' }));
		await userEvent.click(screen.getByRole('button', { name: 'Verknüpfung endgültig entfernen' }));
		expect(await screen.findByText('Die Verknüpfung wurde entfernt.')).toBeInTheDocument();
		expect(await screen.findByText('Noch kein externes Konto verknüpft.')).toBeInTheDocument();
	});

	it('explains last_login_method (OIDC-only account)', async () => {
		useMock(true);
		const { authorizationUrl } = await api.oidcStart('register', 'demo-invite');
		const pendingId = new URL(await callback(authorizationUrl, 'user1'), 'http://localhost').searchParams.get('oidc')!;
		sessionStore.set(await api.oidcRegister({ pendingId, handle: 'only-oidc', displayName: 'Only' }));
		pageState.url = new URL('http://localhost/settings/identities');
		render(IdentitiesPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Verknüpfung entfernen' }));
		await userEvent.click(screen.getByRole('button', { name: 'Verknüpfung endgültig entfernen' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('letzte Anmeldemethode');
	});

	it('hides linking when the server has no OIDC but lists existing identities', async () => {
		useMock(false);
		await signInAsAdmin();
		pageState.url = new URL('http://localhost/settings/identities');
		render(IdentitiesPage);
		expect(await screen.findByText(/keine externe Anmeldung eingerichtet/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Konto verknüpfen' })).not.toBeInTheDocument();
	});
});

describe('mock IdP page', () => {
	it('offers outcomes that point to the callback', () => {
		vi.stubEnv('VITE_MOCK', '1');
		pageState.url = new URL('http://localhost/mock-idp?flow=abc&purpose=login&name=Authentik');
		render(MockIdpPage);
		expect(screen.getByRole('link', { name: /Demo-Nutzer 1/ })).toHaveAttribute('href', '/api/v1/auth/oidc/callback?flow=abc&outcome=user1');
		expect(screen.getByRole('link', { name: 'oidc_failed' })).toHaveAttribute('href', expect.stringContaining('outcome=error%3Aoidc_failed'));
		expect(screen.queryByRole('link', { name: 'oidc_not_linked' })).not.toBeInTheDocument();
		vi.unstubAllEnvs();
	});
});
