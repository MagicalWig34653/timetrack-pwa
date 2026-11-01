import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/settings/places'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import PlacesPage from './(app)/settings/places/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signIn() {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	const login = await api.loginOptions();
	sessionStore.set(await api.loginVerify(login.challengeId, { id: 'mock-login' }));
	await moduleStore.ensure(sessionStore.current!.account.id);
}

beforeEach(() => {
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('/settings/places archive', () => {
	it('shows no archive section while nothing is archived', async () => {
		await signIn();
		render(PlacesPage);
		await screen.findByTestId('place-list');
		expect(screen.queryByTestId('archived-places')).toBeNull();
	});

	it('archives a place, lists it under "Archivierte Orte" and restores it', async () => {
		await signIn();
		render(PlacesPage);
		const list = await screen.findByTestId('place-list');
		const before = within(list).getAllByRole('listitem').length;
		await userEvent.click(within(list).getAllByRole('button', { name: 'Archivieren' })[0]);
		const confirm = within(list).getByText('Der Ort wird archiviert. Bestehende Einträge behalten ihre Zuordnung.').parentElement!;
		await userEvent.click(within(confirm).getByRole('button', { name: 'Archivieren' }));
		const archived = await screen.findByTestId('archived-places');
		expect(within(archived).getAllByTestId('archived-place')).toHaveLength(1);
		await waitFor(() => expect(within(screen.getByTestId('place-list')).getAllByRole('listitem')).toHaveLength(before - 1));
		await userEvent.click(within(archived).getByRole('button', { name: /wiederherstellen/ }));
		await waitFor(() => expect(screen.queryByTestId('archived-places')).toBeNull());
		expect(within(screen.getByTestId('place-list')).getAllByRole('listitem')).toHaveLength(before);
		expect(screen.getByText('Ort wiederhergestellt.')).toBeInTheDocument();
	});
});
