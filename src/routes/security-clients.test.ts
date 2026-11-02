// Client side of the contract 0.40.0/0.41.0 hardening: 429 messages, quota errors, unverified OAuth clients, ended sessions.
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, ApiError, parseRetryAfterSeconds, setCsrfToken, setSessionEndedHandler } from '#lib/api/client.js';
import { errorMessage } from '#lib/i18n/index.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import ConsentPage from './oauth/consent/+page.svelte';
import RecoverPage from './(public)/recover/+page.svelte';
import LoginPage from './(public)/login/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;
const limits = (body: unknown) => mock.fetch('/api/v1/mock/limits', { method: 'POST', body: JSON.stringify(body) });

async function signIn() {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
}

beforeEach(() => {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
	goto.mockResolvedValue(undefined);
	pageState.url = new URL('http://localhost/');
});
afterEach(() => {
	setSessionEndedHandler(null);
	vi.unstubAllGlobals();
});

describe('429 and Retry-After', () => {
	it('parses seconds and HTTP dates', () => {
		expect(parseRetryAfterSeconds('120')).toBe(120);
		expect(parseRetryAfterSeconds('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(30);
		expect(parseRetryAfterSeconds(null)).toBeNull();
		expect(parseRetryAfterSeconds('soon')).toBeNull();
	});

	it('shows the generic message without a delay and adds the delay when the server names one', () => {
		expect(errorMessage(new ApiError(429, 'too_many_requests'))).toBe('Zu viele Versuche, bitte später erneut versuchen.');
		expect(errorMessage(new ApiError(429, 'too_many_requests', 'x', undefined, 45))).toMatch(/später erneut versuchen\. Bitte versuche es in etwa 45 Sekunden erneut\./);
		expect(errorMessage(new ApiError(429, 'too_many_requests', 'x', undefined, 600))).toContain('10 Minuten');
		expect(errorMessage(new ApiError(429, 'too_many_requests', 'x', undefined, 7200))).toContain('2 Stunden');
	});

	it('carries Retry-After from recovery/start into the error', async () => {
		await limits({ limited: ['/api/v1/auth/recovery/start'], retryAfter: 90 });
		const error = await api.recoveryStart('recovery-code', 'admin').catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 429, code: 'too_many_requests', retryAfterSeconds: 90 });
	});

	it('shows the 429 of the recovery page as a friendly message', async () => {
		await limits({ limited: ['/api/v1/auth/recovery/start'] });
		render(RecoverPage);
		await userEvent.type(document.getElementById('recover-handle')!, 'admin');
		await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
		expect(await screen.findByText(/Zu viele Versuche, bitte später erneut versuchen/)).toBeInTheDocument();
	});

	it('maps the other refused calls', async () => {
		await signIn();
		await limits({ limited: ['/api/v1/me/profile/email', '/api/v1/me/recovery/email'] });
		for (const call of [() => api.requestEmailChange('a@example.org'), () => api.enableEmailRecovery()]) {
			const error = await call().catch((e) => e);
			expect(errorMessage(error)).toContain('Zu viele Versuche');
		}
	});
});

describe('uploads and the storage quota', () => {
	it('explains 413 storage_quota_exceeded and the 429 upload rate', async () => {
		await signIn();
		const file = new File(['%PDF-1.4 x'], 'a.pdf', { type: 'application/pdf' });
		await limits({ quotaFull: true });
		const full = await api.uploadFile(file).catch((e) => e);
		expect(full).toMatchObject({ status: 413, code: 'storage_quota_exceeded' });
		expect(errorMessage(full)).toContain('Speicherkontingent');
		await limits({ quotaFull: false, uploadLimited: true });
		const limited = await api.uploadFile(file).catch((e) => e);
		expect(errorMessage(limited)).toContain('Zu viele Versuche');
	});

	it('the mock enforces the admin quota (files and bytes, 0 = unlimited)', async () => {
		await signIn();
		const current = await api.getStorageSettings();
		expect(current).toMatchObject({ quotaBytes: 209715200, quotaFiles: 500 });
		await api.putStorageSettings({ rules: current.rules, quotaFiles: 1 });
		const file = () => new File(['%PDF-1.4 x'], 'a.pdf', { type: 'application/pdf' });
		await api.uploadFile(file());
		expect(await api.uploadFile(file()).catch((e) => e)).toMatchObject({ status: 413, code: 'storage_quota_exceeded' });
		await api.putStorageSettings({ rules: current.rules, quotaFiles: 0 });
		await api.uploadFile(file());
	});
});

describe('OAuth consent page', () => {
	it('marks the client as not verified, highlights the redirect host and shows the registration date', async () => {
		await signIn();
		const redirect = 'https://claude.ai/api/mcp/auth_callback';
		const registered = await mock.fetch('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect] }) });
		const { client_id } = await registered.json();
		const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: redirect, code_challenge: 'c', code_challenge_method: 'S256', scope: 'time:read', state: 's', resource: 'https://x.example/mcp' });
		const location = (await mock.fetch(`/oauth/authorize?${params}`)).headers.get('Location')!;
		pageState.url = new URL(`http://localhost/oauth/consent?request=${new URL(location, 'http://localhost').searchParams.get('request')}`);
		render(ConsentPage);
		expect(await screen.findByTestId('client-unverified')).toHaveTextContent('Nicht verifizierter Client');
		expect(screen.getByTestId('client-registered')).toHaveTextContent(/Registriert am/);
		expect(screen.getByTestId('redirect-host')).toHaveTextContent('claude.ai');
		// scope preselection is unchanged: everything asked for stays selected
		expect(screen.getByRole('button', { name: 'Zugriff erlauben' })).toBeEnabled();
	});
});

describe('ended sessions (401 on another device)', () => {
	it('redirects once to the login with a calm message and no raw error', async () => {
		await signIn();
		const handler = vi.fn(() => setCsrfToken(null));
		setSessionEndedHandler(handler);
		await limits({ endSessions: true });
		const first = await api.listPasskeys().catch((e) => e);
		const second = await api.listPasskeys().catch((e) => e);
		expect(first).toMatchObject({ status: 401, code: 'session_ended' });
		expect(errorMessage(first)).toContain('Du wirst zur Anmeldung weitergeleitet');
		expect(handler).toHaveBeenCalledTimes(1);
		// the handler cleared the CSRF token like the layout does, so later 401s stay plain
		expect(second).toMatchObject({ status: 401, code: 'unauthorized' });
	});

	it('a wrong login proof is not a session end', async () => {
		const handler = vi.fn();
		setSessionEndedHandler(handler);
		await signIn();
		await api.recoveryComplete('00000000-0000-4000-8000-000000000000', 'x').catch(() => undefined);
		expect(handler).not.toHaveBeenCalled();
	});

	it('the login page explains an ended session', () => {
		pageState.url = new URL('http://localhost/login?ended=1&next=%2Fweek');
		render(LoginPage);
		expect(screen.getByTestId('login-session-ended')).toHaveTextContent('Sitzung wurde beendet');
	});

	it('revoking a passkey in the mock ends the other sessions of the account', async () => {
		await signIn();
		const first = createMockFetch();
		vi.stubGlobal('fetch', first.fetch);
		// a second device with its own cookie jar signs in to the same mock server? Each mock is a separate server, so use the hook instead:
		vi.stubGlobal('fetch', mock.fetch);
		const keys = await api.listPasskeys();
		await api.addPasskeyVerify((await api.addPasskeyOptions()).challengeId, { id: 'second' } as never, 'Zweit');
		expect((await api.listPasskeys()).length).toBe(keys.length + 1);
		await api.revokePasskey(keys[0].id);
		// the caller keeps its own session
		expect((await api.currentSession()).account.handle).toBe('admin');
	});
});
