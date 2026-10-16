import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import AccountsPage from './(app)/admin/accounts/+page.svelte';
import PrivacyPage from './(app)/settings/privacy/+page.svelte';
import LoginPage from './(public)/login/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signIn() {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	const login = await api.loginOptions();
	sessionStore.set(await api.loginVerify(login.challengeId, { id: 'mock-login' }));
}

const hook = (body: unknown) => mock.fetch('/api/v1/mock/accounts', { method: 'POST', body: JSON.stringify(body) });
const row = (handle: string) => document.querySelector(`[data-handle="${handle}"]`) as HTMLElement;

beforeEach(() => {
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
	pageState.url = new URL('http://localhost/');
});
afterEach(() => vi.unstubAllGlobals());

describe('/admin/accounts', () => {
	it('lists accounts with role, state, activity and passkeys; the own row offers no actions', async () => {
		await signIn();
		await hook({ add: [{ handle: 'ben', displayName: 'Ben Beispiel', passkeys: 2, disabled: true }] });
		render(AccountsPage);
		await screen.findByTestId('account-list');
		expect(screen.getByTestId('accounts-count')).toHaveTextContent('3 Konten');
		const own = row('admin');
		expect(within(own).getByText('Du')).toBeInTheDocument();
		expect(within(own).getByText('Administrator')).toBeInTheDocument();
		expect(within(own).queryByTestId('act-delete')).toBeNull();
		expect(within(own).getByText(/1 Passkey/)).toBeInTheDocument();
		const ben = row('ben');
		expect(within(ben).getByText('Deaktiviert')).toBeInTheDocument();
		expect(within(ben).getByText('2 Passkeys', { exact: false })).toBeInTheDocument();
		expect(within(ben).getByText('Noch keine Aktivität', { exact: false })).toBeInTheDocument();
		expect(within(ben).getByTestId('act-reactivate')).toBeInTheDocument();
	});

	it('disables a member after confirmation and reactivates it', async () => {
		await signIn();
		render(AccountsPage);
		await screen.findByTestId('account-list');
		await userEvent.click(within(row('lena')).getByTestId('act-disable'));
		expect(await screen.findByText('Konto „lena“ deaktivieren?')).toBeInTheDocument();
		await userEvent.click(screen.getByTestId('confirm-submit'));
		await waitFor(() => expect(screen.getByTestId('accounts-notice')).toHaveTextContent('Konto „lena“ ist deaktiviert.'));
		expect(row('lena')).toHaveAttribute('data-state', 'disabled');
		await userEvent.click(within(row('lena')).getByTestId('act-reactivate'));
		await waitFor(() => expect(row('lena')).toHaveAttribute('data-state', 'active'));
		expect(screen.getByTestId('accounts-notice')).toHaveTextContent('wieder aktiv');
	});

	it('changes the role and asks for a fresh login when the server requires it', async () => {
		await signIn();
		render(AccountsPage);
		await screen.findByTestId('account-list');
		await hook({ staleSessions: true });
		await userEvent.click(within(row('lena')).getByTestId('act-role'));
		await userEvent.click(await screen.findByTestId('confirm-submit'));
		const notice = await screen.findByTestId('reauth');
		expect(notice).toHaveTextContent('Frische Anmeldung nötig');
		expect(row('lena')).toHaveAttribute('data-role', 'member');
		await userEvent.click(within(notice).getByRole('button', { name: 'Abmelden und neu anmelden' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login?next=%2Fadmin%2Faccounts'));
		expect(sessionStore.current).toBeNull();
	});

	it('promotes a member to administrator with a fresh session', async () => {
		await signIn();
		render(AccountsPage);
		await screen.findByTestId('account-list');
		await userEvent.click(within(row('lena')).getByTestId('act-role'));
		await userEvent.click(await screen.findByTestId('confirm-submit'));
		await waitFor(() => expect(row('lena')).toHaveAttribute('data-role', 'admin'));
		expect(screen.getByTestId('accounts-notice')).toHaveTextContent('Rolle von „lena“ ist jetzt: Administrator.');
	});

	it('revokes sessions of an account', async () => {
		await signIn();
		render(AccountsPage);
		await screen.findByTestId('account-list');
		await userEvent.click(within(row('lena')).getByTestId('act-sessions'));
		await userEvent.click(await screen.findByTestId('confirm-submit'));
		await waitFor(() => expect(screen.getByTestId('accounts-notice')).toHaveTextContent('Die Sitzungen von „lena“ sind beendet.'));
		expect(mock.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/sessions'))).toBe(true);
	});

	it('deletes only after typing the handle, explains an incomplete deletion and allows the retry', async () => {
		await signIn();
		render(AccountsPage);
		await screen.findByTestId('account-list');
		await hook({ failDeletion: true });
		await userEvent.click(within(row('lena')).getByTestId('act-delete'));
		const submit = await screen.findByTestId('confirm-submit');
		expect(screen.getByText(/Das Konto wird mit allen Daten unwiderruflich gelöscht/)).toBeInTheDocument();
		expect(submit).toBeDisabled();
		await userEvent.type(screen.getByTestId('confirm-handle'), 'len');
		expect(submit).toBeDisabled();
		await userEvent.type(screen.getByTestId('confirm-handle'), 'a');
		expect(submit).toBeEnabled();
		await userEvent.click(submit);
		expect(await screen.findByTestId('confirm-warning')).toHaveTextContent('noch nicht vollständig gelöscht');
		expect(screen.getByTestId('confirm-error')).toHaveTextContent('Der Vorgang kann wiederholt werden');
		expect(row('lena')).toHaveAttribute('data-state', 'disabled');
		await userEvent.click(screen.getByTestId('confirm-submit'));
		await waitFor(() => expect(screen.getByTestId('accounts-notice')).toHaveTextContent('Konto „lena“ wurde gelöscht.'));
		expect(row('lena')).toBeNull();
	});

	it('shows a refused action as an error inside the dialog', async () => {
		await signIn();
		await hook({ add: [{ handle: 'plain' }] });
		render(AccountsPage);
		await screen.findByTestId('account-list');
		// switch the stub to a failing list call
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403 }));
		await userEvent.click(within(row('lena')).getByTestId('act-sessions'));
		await userEvent.click(await screen.findByTestId('confirm-submit'));
		expect(await screen.findByTestId('confirm-error')).toHaveTextContent('Dafür fehlt dir die Berechtigung.');
	});
});

describe('/settings/privacy', () => {
	it('downloads the export ZIP under the server file name', async () => {
		await signIn();
		const create = vi.fn(() => 'blob:x');
		(URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
		(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => undefined;
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		render(PrivacyPage);
		await userEvent.click(screen.getByTestId('export-button'));
		await waitFor(() => expect(screen.getByTestId('export-done')).toHaveTextContent('timetrack-export-admin.zip'));
		expect(create).toHaveBeenCalledTimes(1);
		expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/zip');
		expect(click).toHaveBeenCalled();
		click.mockRestore();
	});

	it('refuses the last admin and explains it', async () => {
		await signIn();
		render(PrivacyPage);
		await userEvent.click(screen.getByTestId('delete-open'));
		await userEvent.type(await screen.findByTestId('confirm-handle'), 'admin');
		await userEvent.click(screen.getByTestId('confirm-submit'));
		expect(await screen.findByTestId('confirm-error')).toHaveTextContent('letzte aktive Administrator');
		expect(goto).not.toHaveBeenCalled();
	});

	it('asks for a fresh login when the session is too old', async () => {
		await signIn();
		await hook({ add: [{ handle: 'zed', role: 'admin' }], staleSessions: true });
		render(PrivacyPage);
		await userEvent.click(screen.getByTestId('delete-open'));
		await userEvent.type(await screen.findByTestId('confirm-handle'), 'admin');
		await userEvent.click(screen.getByTestId('confirm-submit'));
		expect(await screen.findByTestId('reauth')).toBeInTheDocument();
	});

	it('deletes the account after the typed confirmation and leaves for the login page', async () => {
		await signIn();
		await hook({ add: [{ handle: 'zed', role: 'admin' }] });
		render(PrivacyPage);
		await userEvent.click(screen.getByTestId('delete-open'));
		expect(await screen.findByText(/unwiderruflich gelöscht/)).toBeInTheDocument();
		const submit = screen.getByTestId('confirm-submit');
		expect(submit).toBeDisabled();
		await userEvent.type(screen.getByTestId('confirm-handle'), 'admin');
		await userEvent.click(submit);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login?deleted=1', expect.objectContaining({ replaceState: true })));
		expect(sessionStore.current).toBeNull();
		await expect(api.currentSession()).rejects.toMatchObject({ status: 401 });
	});

	it('tells the user to ask an administrator when the deletion stays incomplete', async () => {
		await signIn();
		await hook({ add: [{ handle: 'zed', role: 'admin' }], failDeletion: true });
		render(PrivacyPage);
		await userEvent.click(screen.getByTestId('delete-open'));
		await userEvent.type(await screen.findByTestId('confirm-handle'), 'admin');
		await userEvent.click(screen.getByTestId('confirm-submit'));
		expect(await screen.findByTestId('delete-incomplete')).toHaveTextContent('Bitte einen Administrator bitten, den Vorgang abzuschließen.');
		expect(goto).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole('button', { name: 'Zur Anmeldung' }));
		expect(goto).toHaveBeenCalledWith('/login?deleted=1', expect.anything());
	});
});

describe('login after deletion', () => {
	it('shows the goodbye notice', () => {
		pageState.url = new URL('http://localhost/login?deleted=1');
		render(LoginPage);
		expect(screen.getByTestId('login-deleted')).toHaveTextContent('Auf Wiedersehen');
	});
});
