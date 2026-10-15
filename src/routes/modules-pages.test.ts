import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import AppLayout from './(app)/+layout.svelte';
import SettingsLayout from './(app)/settings/+layout.svelte';
import ModulesPage from './(app)/settings/modules/+page.svelte';
import AdminModulesPage from './(app)/admin/modules/+page.svelte';
import ConsentPage from './oauth/consent/+page.svelte';
import HomePage from './(app)/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signIn(options?: Parameters<typeof createMockFetch>[0]) {
	mock = createMockFetch(options);
	vi.stubGlobal('fetch', mock.fetch);
	const login = await api.loginOptions();
	sessionStore.set(await api.loginVerify(login.challengeId, { id: 'mock-login' }));
	await moduleStore.ensure(sessionStore.current!.account.id);
}

const child = createRawSnippet(() => ({ render: () => '<p data-testid="child">page content</p>' }));

beforeEach(() => {
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
	pageState.url = new URL('http://localhost/');
});
afterEach(() => vi.unstubAllGlobals());

describe('/settings/modules', () => {
	it('lists the five modules, switches one off optimistically and persists it', async () => {
		await signIn();
		render(ModulesPage);
		const list = await screen.findByTestId('module-list');
		expect(within(list).getAllByRole('switch')).toHaveLength(5);
		expect(screen.getByTestId('modules-note-data')).toHaveTextContent('Daten bleiben erhalten. Beim Wiedereinschalten ist alles wieder da.');
		expect(screen.getByTestId('modules-note-planning')).toHaveTextContent('Abwesenheiten und Feiertage nicht auf die Tagesbewertung');

		await userEvent.click(screen.getByTestId('module-switch-reports'));
		expect(moduleStore.enabled('reports')).toBe(false);
		await waitFor(() => expect(mock.calls.some((c) => c.method === 'PUT' && c.path === '/api/v1/me/modules')).toBe(true));
		await waitFor(() => expect(screen.getByTestId('modules-notice')).toHaveTextContent('Gespeichert.'));
		expect(screen.getByTestId('module-switch-reports')).not.toBeChecked();
		expect(await api.listModules()).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'reports', accountEnabled: false })]));

		await userEvent.click(screen.getByTestId('module-switch-reports'));
		await waitFor(() => expect(moduleStore.enabled('reports')).toBe(true));
	});

	it('disables the switch of operator-locked and server-disabled modules with a hint', async () => {
		await signIn({ modulesDisabled: ['mcp'] });
		await api.putServerModules({ transfer: false });
		await moduleStore.refresh();
		render(ModulesPage);
		await screen.findByTestId('module-list');
		const mcp = document.querySelector('[data-module="mcp"]') as HTMLElement;
		expect(within(mcp).getByRole('switch')).toBeDisabled();
		expect(within(mcp).getByTestId('module-state')).toHaveTextContent('Vom Betreiber deaktiviert');
		const transfer = document.querySelector('[data-module="transfer"]') as HTMLElement;
		expect(within(transfer).getByRole('switch')).toBeDisabled();
		expect(within(transfer).getByTestId('module-state')).toHaveTextContent('Server deaktiviert');
		expect(screen.getByTestId('module-switch-reports')).toBeEnabled();
	});

	it('rolls back and explains a refused change (409 module_locked)', async () => {
		await signIn();
		await api.putMyModules({ planning: false });
		await moduleStore.refresh();
		render(ModulesPage);
		await screen.findByTestId('module-list');
		// the admin locks planning behind the page's back; the page still offers the switch
		await api.putServerModules({ planning: false });
		await userEvent.click(screen.getByTestId('module-switch-planning'));
		await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('gesperrt'));
		expect(screen.getByTestId('module-switch-planning')).not.toBeChecked();
	});

	it('says so when the server has no module API', async () => {
		await signIn();
		moduleStore.reset();
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }));
		render(ModulesPage);
		expect(await screen.findByTestId('modules-unavailable')).toHaveTextContent('noch nicht');
	});
});

describe('/admin/modules', () => {
	it('asks for confirmation before switching a module off for everyone', async () => {
		await signIn();
		render(AdminModulesPage);
		await screen.findByTestId('admin-module-list');
		await userEvent.click(screen.getByTestId('admin-switch-planning'));
		await userEvent.click(screen.getByTestId('admin-save'));
		const dialog = await screen.findByTestId('admin-confirm');
		expect(dialog).toHaveTextContent('Betrifft alle Konten');
		expect(mock.calls.some((c) => c.method === 'PUT' && c.path === '/api/v1/admin/modules')).toBe(false);
		await userEvent.click(screen.getByTestId('admin-confirm-yes'));
		await waitFor(() => expect(screen.getByTestId('admin-modules-notice')).toHaveTextContent('gespeichert'));
		expect(moduleStore.enabled('planning')).toBe(false);
	});

	it('saves switching on without a dialog and shows operator-locked modules as locked', async () => {
		await signIn({ modulesDisabled: ['reports'] });
		await api.putServerModules({ transfer: false });
		render(AdminModulesPage);
		await screen.findByTestId('admin-module-list');
		expect(screen.getByTestId('admin-switch-reports')).toBeDisabled();
		expect(screen.getByTestId('admin-module-locked')).toBeInTheDocument();
		await userEvent.click(screen.getByTestId('admin-switch-transfer'));
		await userEvent.click(screen.getByTestId('admin-save'));
		await waitFor(() => expect(screen.getByTestId('admin-modules-notice')).toHaveTextContent('gespeichert'));
		expect(screen.queryByTestId('admin-confirm')).toBeNull();
	});
});

describe('layouts hide switched-off modules', () => {
	const navLabels = () => within(screen.getByRole('navigation', { name: 'Hauptnavigation' })).getAllByRole('link').map((a) => a.textContent?.trim());

	it('removes navigation entries and shows the notice instead of the page', async () => {
		await signIn();
		await api.putMyModules({ reports: false, planning: false });
		await moduleStore.refresh();
		pageState.url = new URL('http://localhost/reports');
		render(AppLayout, { children: child, data: {} as never, params: {} } as never);
		const labels = navLabels();
		expect(labels).not.toContain('Berichtsheft');
		expect(labels).not.toContain('Urlaub');
		expect(labels).toContain('Zeit');
		expect(labels).toContain('Module (Server)'); // admin
		expect(screen.getByTestId('module-disabled')).toHaveTextContent('Dieses Modul ist deaktiviert');
		expect(screen.queryByTestId('child')).toBeNull();
		expect(screen.getByRole('link', { name: 'Zu den Moduleinstellungen' })).toHaveAttribute('href', '/settings/modules');
	});

	it('renders core pages untouched', async () => {
		await signIn();
		await api.putMyModules({ reports: false });
		await moduleStore.refresh();
		pageState.url = new URL('http://localhost/time');
		render(AppLayout, { children: child, data: {} as never, params: {} } as never);
		expect(screen.getByTestId('child')).toBeInTheDocument();
	});

	it('removes settings sub-navigation entries of disabled modules', async () => {
		await signIn();
		await api.putMyModules({ reports: false, mcp: false, automation: false });
		await moduleStore.refresh();
		render(SettingsLayout, { children: child, data: {} as never, params: {} } as never);
		const hrefs = within(screen.getByRole('navigation', { name: 'Einstellungen' })).getAllByRole('link').map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/settings/modules');
		expect(hrefs).toContain('/settings/sharing');
		for (const gone of ['/settings/learning-fields', '/settings/api-tokens', '/settings/connections', '/settings/mcp-help', '/settings/devices']) {
			expect(hrefs).not.toContain(gone);
		}
	});

	it('hides the dashboard teaser and suggestion hints', async () => {
		await signIn();
		const { unmount } = render(HomePage);
		await screen.findByTestId('balance');
		expect(screen.getByTestId('suggestions-notice')).toBeInTheDocument();
		unmount();
		await api.putMyModules({ reports: false, automation: false });
		await moduleStore.refresh();
		render(HomePage);
		await screen.findByTestId('balance');
		expect(screen.queryByTestId('suggestions-notice')).toBeNull();
		expect(screen.queryByText('Berichtsheft')).toBeNull();
		expect(mock.calls.filter((c) => c.path.includes('/time/suggestions')).length).toBe(1); // only the first render asked
	});
});

describe('/oauth/consent', () => {
	it('shows the disabled notice without asking for the request when mcp is off', async () => {
		await signIn();
		await api.putMyModules({ mcp: false });
		await moduleStore.refresh();
		pageState.url = new URL('http://localhost/oauth/consent?request=abc');
		render(ConsentPage);
		expect(await screen.findByTestId('module-disabled')).toHaveAttribute('data-module', 'mcp');
		expect(mock.calls.some((c) => c.path.includes('/oauth/requests'))).toBe(false);
	});
});
