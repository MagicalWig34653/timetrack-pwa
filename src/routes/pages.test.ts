import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({
	url: new URL('http://localhost/login'),
	params: {} as Record<string, string>
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('#lib/webauthn.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/webauthn.js')>()),
	isWebAuthnSupported: () => true,
	createPasskey: vi.fn(async () => ({ id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} })),
	getPasskey: vi.fn(async () => ({ id: 'mock-login', rawId: 'x', type: 'public-key', response: {} }))
}));

import LoginPage from './(public)/login/+page.svelte';
import InvitePage from './(public)/invite/[token]/+page.svelte';
import RecoverPage from './(public)/recover/+page.svelte';
import PasskeysPage from './(app)/settings/passkeys/+page.svelte';
import RecoveryManager from '#lib/components/app/RecoveryManager.svelte';
import InvitationsPage from './(app)/admin/invitations/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signInAsAdmin() {
	const { api } = await import('#lib/api/client.js');
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
}

beforeEach(() => {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('login page', () => {
	it('signs in with a passkey and navigates to the requested target', async () => {
		pageState.url = new URL('http://localhost/login?next=/settings/passkeys');
		render(LoginPage);
		await userEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/settings/passkeys', { replaceState: true }));
		expect(sessionStore.current?.account.handle).toBe('admin');
	});

	it('ignores external next targets', async () => {
		pageState.url = new URL('http://localhost/login?next=//evil.example');
		render(LoginPage);
		await userEvent.click(screen.getByRole('button', { name: 'Mit Passkey anmelden' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/', { replaceState: true }));
	});
});

describe('invite registration', () => {
	it('shows a German error for an invalid token', async () => {
		pageState.params = { token: 'nope' };
		render(InvitePage);
		expect(await screen.findByText(/ungültig, abgelaufen oder bereits verwendet/)).toBeInTheDocument();
	});

	it('registers with handle, display name and passkey, then continues to recovery setup', async () => {
		pageState.params = { token: 'demo-invite' };
		render(InvitePage);
		await userEvent.type(await screen.findByLabelText('Kontoname'), 'mia');
		await userEvent.type(screen.getByLabelText('Anzeigename'), 'Mia Muster');
		await userEvent.click(screen.getByRole('button', { name: /Passkey erstellen/ }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/setup/recovery', { replaceState: true }));
		expect(sessionStore.current?.account).toMatchObject({ handle: 'mia', role: 'member' });
	});

	it('rejects an invalid handle before calling the server', async () => {
		pageState.params = { token: 'demo-invite' };
		render(InvitePage);
		await userEvent.type(await screen.findByLabelText('Kontoname'), 'Ab');
		expect(screen.getByText(/Nur Kleinbuchstaben/)).toBeInTheDocument();
	});
});

describe('recovery flow', () => {
	it('completes with a recovery code and continues to the restricted passkey step', async () => {
		render(RecoverPage);
		await userEvent.type(screen.getByLabelText('Kontoname'), 'admin');
		await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
		await userEvent.type(await screen.findByLabelText('Recovery-Code'), 'AAAA-BBBB-CCCC');
		await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/recover/passkey', { replaceState: true }));
		expect(sessionStore.current?.recovery).toBe(true);
	});

	it('shows a generic German error for a wrong proof', async () => {
		render(RecoverPage);
		await userEvent.type(screen.getByLabelText('Kontoname'), 'unknown-user');
		await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
		await userEvent.type(await screen.findByLabelText('Recovery-Code'), 'x');
		await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('nicht angemeldet oder der Nachweis ist ungültig');
		expect(goto).not.toHaveBeenCalled();
	});
});

describe('passkey settings', () => {
	it('lists passkeys, adds one and warns before revoking the last one', async () => {
		await signInAsAdmin();
		render(PasskeysPage);
		expect(await screen.findByText('Demo-Passkey')).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText(/Name des neuen Passkeys/), 'Laptop');
		await userEvent.click(screen.getByRole('button', { name: 'Passkey hinzufügen' }));
		expect(await screen.findByText('Laptop')).toBeInTheDocument();
		expect(await screen.findByText('Passkey hinzugefügt.')).toBeInTheDocument();
	});

	it('renames a passkey', async () => {
		await signInAsAdmin();
		render(PasskeysPage);
		await screen.findByText('Demo-Passkey');
		await userEvent.click(screen.getByRole('button', { name: 'Umbenennen' }));
		const input = screen.getByLabelText('Name');
		await userEvent.clear(input);
		await userEvent.type(input, 'Schlüsselbund');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Schlüsselbund')).toBeInTheDocument();
	});
});

describe('recovery settings', () => {
	it('shows generated recovery codes once and hides them after confirmation', async () => {
		await signInAsAdmin();
		render(RecoveryManager);
		await userEvent.click(await screen.findByRole('button', { name: 'Neue Codes erzeugen' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Ja, neue Codes erzeugen' }));
		expect(await screen.findByText(/nur jetzt angezeigt/)).toBeInTheDocument();
		expect(screen.getAllByRole('listitem')).toHaveLength(8);
		const done = screen.getByRole('button', { name: 'Fertig' });
		expect(done).toBeDisabled();
		await userEvent.click(screen.getByRole('checkbox'));
		await userEvent.click(done);
		expect(screen.queryByText(/nur jetzt angezeigt/)).not.toBeInTheDocument();
	});

	it('hides the e-mail option when the server has no mail delivery', async () => {
		mock = createMockFetch({ mailAvailable: false });
		vi.stubGlobal('fetch', mock.fetch);
		await signInAsAdmin();
		render(RecoveryManager);
		expect(await screen.findByText(/E-Mail-Versand nicht eingerichtet/)).toBeInTheDocument();
		expect(screen.queryByLabelText('E-Mail-Adresse')).not.toBeInTheDocument();
	});

	it('validates the fallback password length locally', async () => {
		await signInAsAdmin();
		render(RecoveryManager);
		await screen.findByText('Rückfallpasswort');
		await userEvent.type(screen.getByLabelText('Neues Rückfallpasswort'), 'short');
		await userEvent.type(screen.getByLabelText('Passwort wiederholen'), 'short');
		await userEvent.click(screen.getAllByRole('button', { name: 'Speichern' })[0]);
		// validated by the component (German message), not by native browser validation
		expect(await screen.findByText(/mindestens 12 Zeichen lang/)).toBeInTheDocument();
	});
});

describe('admin invitations', () => {
	it('creates an invitation and shows the link once', async () => {
		await signInAsAdmin();
		render(InvitationsPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Einladung erstellen' }));
		const link = await screen.findByTestId('invite-link');
		expect(link.textContent).toMatch(/^http:\/\/localhost:?\d*\/invite\/[0-9a-f]{32}$/);
		await userEvent.click(screen.getByRole('button', { name: 'Fertig' }));
		expect(screen.queryByTestId('invite-link')).not.toBeInTheDocument();
	});

	it('revokes an open invitation', async () => {
		await signInAsAdmin();
		render(InvitationsPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Widerrufen' }));
		await waitFor(() => expect(screen.getByText('Widerrufen', { selector: '[data-slot=badge]' })).toBeInTheDocument());
	});
});
