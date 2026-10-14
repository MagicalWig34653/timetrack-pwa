import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const navigateTo = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/oauth/consent'), params: {} as Record<string, string> }));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('#lib/browser.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('#lib/browser.js')>()), navigateTo }));

import ConsentPage from './oauth/consent/+page.svelte';
import ApiTokensPage from './(app)/settings/api-tokens/+page.svelte';
import ConnectionsPage from './(app)/settings/connections/+page.svelte';
import McpHelpPage from './(app)/settings/mcp-help/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signInAsAdmin() {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
}

/** Registers a client and runs /oauth/authorize; returns the consent request id. */
async function startFlow(scope: string, redirectUri = 'https://claude.ai/api/mcp/auth_callback'): Promise<string> {
	const registered = await mock.fetch('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri] }) });
	const { client_id } = await registered.json();
	const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: redirectUri, code_challenge: 'c', code_challenge_method: 'S256', scope, state: 's1', resource: 'https://x.example/mcp' });
	const response = await mock.fetch(`/oauth/authorize?${params}`);
	return new URL(response.headers.get('Location')!, 'http://localhost').searchParams.get('request')!;
}

const decisions = () => mock.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/decision'));

beforeEach(async () => {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
	navigateTo.mockReset();
	pageState.url = new URL('http://localhost/oauth/consent');
	await signInAsAdmin();
});
afterEach(() => vi.unstubAllGlobals());

describe('consent page', () => {
	async function open(scope: string) {
		const id = await startFlow(scope);
		pageState.url = new URL(`http://localhost/oauth/consent?request=${id}`);
		render(ConsentPage);
		await screen.findByRole('button', { name: 'Zugriff erlauben' });
		return id;
	}

	it('shows client, redirect host, signed-in account and all requested scopes preselected, and never decides on its own', async () => {
		await open('time:read time:write reports:read');
		expect(screen.getByText(/Claude möchte auf dein Timetrack-Konto zugreifen/)).toBeInTheDocument();
		expect(screen.getByTestId('redirect-host')).toHaveTextContent('Du wirst zu claude.ai weitergeleitet.');
		expect(screen.getByTestId('signed-in-as')).toHaveTextContent('Angemeldet als Admin Demo');
		for (const name of ['Zeiten lesen', 'Zeiten schreiben', 'Berichtsheft lesen']) {
			expect(screen.getByRole('checkbox', { name: new RegExp(name) })).toBeChecked();
		}
		expect(screen.getByText('Zeitbuchungen, Tagesübersichten und Zeitkonto lesen')).toBeInTheDocument();
		expect(screen.getByText(/jederzeit unter Einstellungen \/ Verbindungen widerrufen/)).toBeInTheDocument();
		await new Promise((r) => setTimeout(r, 30));
		expect(decisions()).toHaveLength(0);
		expect(navigateTo).not.toHaveBeenCalled();
		expect(await api.listOAuthGrants()).toEqual([]);
	});

	it('highlights write scopes and warns only while a write scope is selected', async () => {
		await open('time:read time:write');
		const write = screen.getByRole('checkbox', { name: /Zeiten schreiben/ }).closest('label')!;
		const read = screen.getByRole('checkbox', { name: /Zeiten lesen/ }).closest('label')!;
		expect(write).toHaveAttribute('data-write', 'true');
		expect(within(write).getByText('Schreibzugriff')).toBeInTheDocument();
		expect(read).not.toHaveAttribute('data-write');
		expect(within(read).queryByText('Schreibzugriff')).not.toBeInTheDocument();
		expect(screen.getByTestId('write-warning')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('checkbox', { name: /Zeiten schreiben/ }));
		expect(screen.queryByTestId('write-warning')).not.toBeInTheDocument();
	});

	it('sends only the remaining scopes on approve and then leaves for the redirect URL', async () => {
		await open('time:read time:write');
		await userEvent.click(screen.getByRole('checkbox', { name: /Zeiten schreiben/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Zugriff erlauben' }));
		await waitFor(() => expect(navigateTo).toHaveBeenCalledTimes(1));
		const url = new URL(navigateTo.mock.calls[0][0]);
		expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
		expect(url.searchParams.get('code')).toBeTruthy();
		expect(url.searchParams.get('state')).toBe('s1');
		expect(decisions()).toHaveLength(1);
		expect(await api.listOAuthGrants()).toMatchObject([{ scopes: ['time:read'] }]);
	});

	it('disables approving without any scope', async () => {
		await open('time:read');
		await userEvent.click(screen.getByRole('checkbox', { name: /Zeiten lesen/ }));
		expect(screen.getByRole('button', { name: 'Zugriff erlauben' })).toBeDisabled();
		expect(screen.getByText(/Wähle mindestens einen Zugriff aus/)).toBeInTheDocument();
	});

	it('denies without scopes and follows the error redirect', async () => {
		await open('time:read');
		await userEvent.click(screen.getByRole('button', { name: 'Ablehnen' }));
		await waitFor(() => expect(navigateTo).toHaveBeenCalled());
		expect(new URL(navigateTo.mock.calls[0][0]).searchParams.get('error')).toBe('access_denied');
		expect(await api.listOAuthGrants()).toEqual([]);
	});

	it('explains expired or invalid requests (404) and already decided ones (409)', async () => {
		pageState.url = new URL('http://localhost/oauth/consent?request=00000000-0000-4000-8000-000000000000');
		const first = render(ConsentPage);
		expect(await screen.findByText(/abgelaufen, ungültig oder gehört zu einem anderen Konto/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Zugriff erlauben' })).not.toBeInTheDocument();
		first.unmount();

		const id = await startFlow('time:read');
		await api.decideOAuthRequest(id, false);
		pageState.url = new URL(`http://localhost/oauth/consent?request=${id}`);
		render(ConsentPage);
		expect(await screen.findByRole('heading', { name: 'Bereits entschieden' })).toBeInTheDocument();
	});

	it('handles a 409 on the decision itself (decided in another tab)', async () => {
		const id = await open('time:read');
		await api.decideOAuthRequest(id, false);
		await userEvent.click(screen.getByRole('button', { name: 'Zugriff erlauben' }));
		expect(await screen.findByRole('heading', { name: 'Bereits entschieden' })).toBeInTheDocument();
		expect(navigateTo).not.toHaveBeenCalled();
	});

	it('reports a missing request parameter', async () => {
		render(ConsentPage);
		expect(await screen.findByText(/Dieser Link ist unvollständig/)).toBeInTheDocument();
	});

	it('"Anderes Konto verwenden" signs out and returns to the login with the consent URL as next', async () => {
		const id = await open('time:read');
		await userEvent.click(screen.getByRole('button', { name: 'Anderes Konto verwenden' }));
		await waitFor(() => expect(goto).toHaveBeenCalled());
		expect(goto.mock.calls[0][0]).toBe(`/login?next=${encodeURIComponent(`/oauth/consent?request=${id}`)}`);
		expect(sessionStore.current).toBeNull();
		expect(decisions()).toHaveLength(0);
	});
});

describe('API tokens page', () => {
	async function createToken(name: string) {
		await userEvent.click(await screen.findByRole('button', { name: 'Neues Token' }));
		await userEvent.type(screen.getByLabelText('Name'), name);
		await userEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }));
	}

	it('creates a read-only token by default, shows the secret once and lists it without it', async () => {
		render(ApiTokensPage);
		await createToken('Laptop');
		const secret = (await screen.findByTestId('token-value')).textContent!;
		expect(secret).toMatch(/^ttp_/);
		expect(screen.getByText(/nur jetzt angezeigt/)).toBeInTheDocument();
		const [token] = await api.listApiTokens();
		expect(token.scopes).toEqual(['time:read', 'schedule:read', 'reports:read', 'documents:read']);
		expect(Date.parse(token.expiresAt) - Date.parse(token.createdAt)).toBe(30 * 86_400_000);
		await userEvent.click(screen.getByRole('button', { name: 'Ich habe es gespeichert' }));
		expect(screen.queryByTestId('token-value')).not.toBeInTheDocument();
		expect(within(screen.getByTestId('token-list')).getByText('Laptop')).toBeInTheDocument();
		expect(document.body.textContent).not.toContain(secret);
	});

	it('presets switch the scope set and the expiry is selectable', async () => {
		render(ApiTokensPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Neues Token' }));
		await userEvent.click(screen.getByRole('button', { name: 'Lesen und schreiben' }));
		expect(screen.getByRole('checkbox', { name: /Zeiten schreiben/ })).toBeChecked();
		await userEvent.click(screen.getByRole('button', { name: 'Nur lesen' }));
		expect(screen.getByRole('checkbox', { name: /Zeiten schreiben/ })).not.toBeChecked();
		expect(screen.getByRole('checkbox', { name: /Zeiten lesen/ })).toBeChecked();
		await userEvent.selectOptions(screen.getByLabelText('Gültigkeit'), '90 Tage');
		await userEvent.type(screen.getByLabelText('Name'), 'Skript');
		await userEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }));
		await screen.findByTestId('token-value');
		const [token] = await api.listApiTokens();
		expect(Date.parse(token.expiresAt) - Date.parse(token.createdAt)).toBe(90 * 86_400_000);
	});

	it('requires a name and at least one scope', async () => {
		render(ApiTokensPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Neues Token' }));
		await userEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }));
		expect(screen.getByText('Bitte gib einen Namen an.')).toBeInTheDocument();
		expect(await api.listApiTokens()).toEqual([]);
		for (const box of screen.getAllByRole('checkbox')) if ((box as HTMLInputElement).checked) await userEvent.click(box);
		await userEvent.type(screen.getByLabelText('Name'), 'x');
		await userEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }));
		expect(screen.getByText('Wähle mindestens einen Zugriff aus.', { selector: 'p' })).toBeInTheDocument();
	});

	it('asks to log in again on reauth_required', async () => {
		render(ApiTokensPage);
		await mock.fetch('/api/v1/mock/oidc', { method: 'POST', body: JSON.stringify({ staleSessions: true }) });
		await createToken('Laptop');
		const alert = await screen.findByTestId('reauth');
		expect(alert).toHaveTextContent('frischen Anmeldung');
		await userEvent.click(within(alert).getByRole('button', { name: 'Abmelden und neu anmelden' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login?next=%2Fsettings%2Fapi-tokens'));
		expect(screen.queryByTestId('token-value')).not.toBeInTheDocument();
	});

	it('revokes only after confirmation', async () => {
		await api.createApiToken({ name: 'Alt', scopes: ['time:read'], expiresInDays: 30 });
		render(ApiTokensPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Widerrufen' }));
		expect(await api.listApiTokens()).toHaveLength(1);
		await userEvent.click(screen.getByRole('button', { name: 'Token endgültig widerrufen' }));
		await screen.findByText('Das Token wurde widerrufen.');
		expect(await api.listApiTokens()).toEqual([]);
	});
});

describe('connections page', () => {
	it('lists grants with scopes and revokes after confirmation', async () => {
		const id = await startFlow('time:read time:write');
		await api.decideOAuthRequest(id, true, ['time:read', 'time:write']);
		render(ConnectionsPage);
		const list = await screen.findByTestId('grant-list');
		expect(within(list).getByText('Claude')).toBeInTheDocument();
		expect(within(list).getByText('Zeiten schreiben').closest('li')).toHaveAttribute('data-write', 'true');
		expect(screen.getByText(/noch nicht genutzt/)).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Zugriff widerrufen' }));
		expect(await api.listOAuthGrants()).toHaveLength(1);
		await userEvent.click(screen.getByRole('button', { name: 'Zugriff endgültig widerrufen' }));
		await screen.findByText('Der Zugriff wurde widerrufen.');
		expect(await api.listOAuthGrants()).toEqual([]);
		expect(screen.getByText('Noch keine Anwendung verbunden.')).toBeInTheDocument();
	});

	it('shows the unavailable notice when the server lacks the endpoint', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
		render(ConnectionsPage);
		expect(await screen.findByText(/noch nicht verfügbar|nicht verfügbar/i)).toBeInTheDocument();
	});
});

describe('help page', () => {
	it('shows the computed MCP URL, the Bearer header example and the untested disclaimer', () => {
		render(McpHelpPage);
		expect(screen.getByTestId('mcp-url')).toHaveTextContent(`${location.origin}/mcp`);
		expect(screen.getByTestId('token-header')).toHaveTextContent('Authorization: Bearer <Token>');
		expect(screen.getByTestId('untested')).toHaveTextContent('noch nicht ausprobiert');
		expect(screen.getByRole('heading', { name: 'ChatGPT' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Claude' })).toBeInTheDocument();
	});
});
