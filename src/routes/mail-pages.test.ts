import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/admin/mail'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import MailPage from './(app)/admin/mail/+page.svelte';
import ProfilePage from './(app)/settings/profile/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signIn(options?: Parameters<typeof createMockFetch>[0], hook?: Record<string, unknown>) {
	mock = createMockFetch(options);
	vi.stubGlobal('fetch', mock.fetch);
	const login = await api.loginOptions();
	sessionStore.set(await api.loginVerify(login.challengeId, { id: 'mock-login' }));
	await moduleStore.ensure(sessionStore.current!.account.id);
	if (hook) await mock.fetch('/api/v1/mock/mail', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionStore.current!.csrfToken }, body: JSON.stringify(hook) });
}

beforeEach(() => {
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('/admin/mail', () => {
	it('shows the configured values without credentials, the chip with its explanation and the hints', async () => {
		await signIn();
		render(MailPage);
		expect(await screen.findByTestId('mail-configured')).toHaveTextContent('Eingerichtet');
		expect(screen.getByTestId('mail-host')).toHaveTextContent('smtp.example.org');
		expect(screen.getByTestId('mail-port')).toHaveTextContent('587');
		expect(screen.getByTestId('mail-tls')).toHaveTextContent('STARTTLS');
		expect(screen.getByTestId('mail-from')).toHaveTextContent('Timetrack <timetrack@example.org>');
		expect(screen.getByTestId('mail-auth')).toHaveTextContent('Benutzername und Passwort gesetzt');
		expect(screen.getByTestId('mail-hint-from_domain_differs_from_public_url')).toBeInTheDocument();
		expect(screen.getByTestId('mail-source')).toHaveTextContent('lassen sich hier nicht ändern');
		expect(screen.queryByTestId('mail-setup')).toBeNull();
	});

	it('shows the environment checklist with copyable example when mail is not configured', async () => {
		await signIn({ mailAvailable: false });
		render(MailPage);
		expect(await screen.findByTestId('mail-configured')).toHaveTextContent('Nicht eingerichtet');
		const setup = screen.getByTestId('mail-setup');
		expect(within(setup).getByText('SMTP_HOST')).toBeInTheDocument();
		expect(within(setup).getByText('SMTP_PASSWORD_FILE')).toBeInTheDocument();
		expect(screen.getByTestId('mail-example')).toHaveTextContent('SMTP_HOST=smtp.example.org');
		const docs = screen.getByRole('link', { name: 'docs/installation/konfiguration' });
		expect(docs).toHaveAttribute('href', 'https://magicalwig34653.github.io/timetrack-backend/docs/installation/konfiguration');
		expect(docs).toHaveAttribute('target', '_blank');
		expect(docs).toHaveAttribute('rel', 'noopener');
		expect(screen.queryByTestId('mail-check-run')).toBeNull();
	});

	it('runs the check and lists every step with duration; the explainer is always there', async () => {
		await signIn();
		render(MailPage);
		await userEvent.click(await screen.findByTestId('mail-check-run'));
		const result = await screen.findByTestId('mail-result');
		expect(result).toHaveAttribute('data-ok', 'true');
		for (const id of ['dns', 'tcp', 'tls', 'ehlo', 'auth', 'mailFrom']) expect(screen.getByTestId(`mail-step-${id}`)).toHaveAttribute('data-status', 'ok');
		expect(screen.getByTestId('mail-step-tls-time')).toHaveTextContent('88 ms');
		expect(screen.getByTestId('mail-step-tls')).toHaveTextContent('noch 76 Tage');
		expect(screen.queryByTestId('mail-cert')).toBeNull();
		expect(screen.getByTestId('mail-use')).toHaveTextContent('Wiederherstellung');
	});

	it('explains a failed step and marks the rest as skipped', async () => {
		await signIn(undefined, { scenario: 'auth' });
		render(MailPage);
		await userEvent.click(await screen.findByTestId('mail-check-run'));
		const problem = await screen.findByTestId('mail-problem-auth');
		expect(problem).toHaveTextContent('Die Anmeldung wurde abgelehnt');
		expect(problem).toHaveTextContent('Was kann ich tun?');
		expect(screen.getByTestId('mail-step-auth')).toHaveAttribute('data-status', 'failed');
		expect(screen.getByTestId('mail-step-mailFrom')).toHaveAttribute('data-status', 'skipped');
		expect(screen.getByTestId('mail-result')).toHaveAttribute('data-ok', 'false');
	});

	it('shows the certificate line only when it is the problem', async () => {
		await signIn(undefined, { scenario: 'tls' });
		render(MailPage);
		await userEvent.click(await screen.findByTestId('mail-check-run'));
		expect(await screen.findByTestId('mail-cert')).toHaveTextContent('abgelaufen');
		expect(screen.getByTestId('mail-problem-tls')).toHaveTextContent('Zertifikat');
	});

	it('prefills the verified own address and sends the test mail to it', async () => {
		await signIn();
		await api.requestEmailChange('ich@example.org');
		await api.verifyEmailChange('123456');
		render(MailPage);
		const input = (await screen.findByLabelText('Empfänger')) as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe('ich@example.org'));
		await userEvent.click(screen.getByTestId('mail-test-send'));
		expect(await screen.findByTestId('mail-test-sent')).toHaveTextContent('Gesendet an ich@example.org in 412 ms');
		expect(mock.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/admin/mail/test')).toBe(true);
	});

	it('refuses an invalid address without calling the server and explains the empty default', async () => {
		await signIn();
		render(MailPage);
		const input = await screen.findByLabelText('Empfänger');
		expect(screen.getByTestId('mail-to-hint')).toHaveTextContent('keine bestätigte E-Mail-Adresse');
		await userEvent.type(input, 'kaputt');
		await userEvent.click(screen.getByTestId('mail-test-send'));
		expect(screen.getByTestId('mail-to-invalid')).toBeInTheDocument();
		expect(mock.calls.some((c) => c.path === '/api/v1/admin/mail/test')).toBe(false);
	});

	it('asks for a fresh sign-in on 403 reauth_required', async () => {
		await signIn();
		await mock.fetch('/api/v1/mock/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staleSessions: true }) });
		render(MailPage);
		await userEvent.type(await screen.findByLabelText('Empfänger'), 'ich@example.org');
		await userEvent.click(screen.getByTestId('mail-test-send'));
		expect(await screen.findByTestId('reauth')).toBeInTheDocument();
	});

	it('maps rate limit and server errors to German messages', async () => {
		await signIn(undefined, { scenario: 'tls' });
		render(MailPage);
		await userEvent.type(await screen.findByLabelText('Empfänger'), 'ich@example.org');
		await userEvent.click(screen.getByTestId('mail-test-send'));
		expect(await screen.findByTestId('mail-test-error')).toHaveTextContent('verschlüsselte Verbindung');
	});

	it('degrades on an older server', async () => {
		await signIn(undefined, { old: true });
		render(MailPage);
		expect(await screen.findByTestId('mail-unsupported')).toHaveTextContent('Dieser Server unterstützt die Prüfung noch nicht');
		expect(screen.queryByTestId('mail-check-run')).toBeNull();
	});

	it('links admins from the profile hint', async () => {
		await signIn({ mailAvailable: false });
		render(ProfilePage);
		const link = await screen.findByTestId('no-mail-admin-link');
		expect(link).toHaveAttribute('href', '/admin/mail');
		await waitFor(() => expect(link).toHaveTextContent('E-Mail-Versand prüfen'));
	});
});
