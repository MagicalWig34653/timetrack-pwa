import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';
import TriggerLinksPage from './(app)/settings/trigger-links/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('trigger links page', () => {
	it('shows the security text and the empty state', async () => {
		render(TriggerLinksPage);
		const security = await screen.findByTestId('trigger-security');
		expect(security).toHaveTextContent('Wie ein Passwort behandeln');
		expect(security).toHaveTextContent('Verlauf');
		expect(security).toHaveTextContent('einen eigenen Link');
		expect(screen.getByText('Noch keine Auslöse-Links.')).toBeInTheDocument();
	});

	it('shows the URL once per action, never in the list, and revokes after confirmation', async () => {
		render(TriggerLinksPage);
		await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'NFC-Tag Schreibtisch');
		await userEvent.click(screen.getByLabelText(/Umschalten/));
		await userEvent.click(screen.getByRole('button', { name: 'Link erzeugen' }));
		const banner = await screen.findByTestId('created-link');
		expect(banner).toHaveTextContent('Jetzt kopieren');
		const start = within(banner).getByTestId('link-url-start').textContent!;
		expect(start).toMatch(/^http:\/\/localhost(:\d+)?\/t\/[A-Za-z0-9]{43}\/start$/);
		expect(within(banner).getByTestId('link-url-stop').textContent).toMatch(/\/stop$/);
		expect(within(banner).getByTestId('link-url-toggle').textContent).toMatch(/\/toggle$/);
		const token = start.split('/')[4];
		const list = await screen.findByTestId('link-list');
		expect(list).toHaveTextContent('NFC-Tag Schreibtisch');
		expect(list).toHaveTextContent('Aktionen: Start, Stopp, Umschalten');
		expect(list).toHaveTextContent('noch nie benutzt');
		expect(list).toHaveTextContent('ohne Ortsbindung');
		expect(list.textContent).not.toContain(token);
		expect(JSON.stringify(await api.listTriggerLinks())).not.toContain(token);

		await userEvent.click(screen.getByRole('button', { name: 'Ich habe sie gespeichert' }));
		expect(screen.queryByTestId('created-link')).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: 'Link „NFC-Tag Schreibtisch“ widerrufen' }));
		expect(screen.getByText(/antwortet danach sofort nicht mehr/)).toBeInTheDocument();
		expect(await api.listTriggerLinks()).toHaveLength(1);
		await userEvent.click(screen.getByRole('button', { name: 'Endgültig widerrufen' }));
		expect(await screen.findByText('Link widerrufen.')).toBeInTheDocument();
		expect(await api.listTriggerLinks()).toEqual([]);
	});

	it('binds a link to a place and sends kind and expiry', async () => {
		render(TriggerLinksPage);
		const [place] = await api.listPlaces();
		await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'Büro');
		await userEvent.selectOptions(screen.getByLabelText('Ort (optional)'), place.id);
		await userEvent.selectOptions(screen.getByLabelText('Art des Abschnitts'), 'travel');
		await userEvent.type(screen.getByLabelText('Gültigkeit in Tagen (optional)'), '30');
		await userEvent.click(screen.getByRole('button', { name: 'Link erzeugen' }));
		await screen.findByTestId('created-link');
		const [link] = await api.listTriggerLinks();
		expect(link).toMatchObject({ label: 'Büro', placeId: place.id, kind: 'travel', actions: ['start', 'stop'] });
		expect(link.expiresAt).not.toBeNull();
		expect(await screen.findByTestId('link-list')).toHaveTextContent(`Ort: ${place.name}`);
	});

	it('validates label, actions and expiry before sending', async () => {
		render(TriggerLinksPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Link erzeugen' }));
		expect(await screen.findByText('Bitte gib eine Bezeichnung an.')).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText('Bezeichnung'), 'x');
		await userEvent.click(screen.getByLabelText(/^Start/));
		await userEvent.click(screen.getByLabelText(/^Stopp/));
		await userEvent.type(screen.getByLabelText('Gültigkeit in Tagen (optional)'), '900');
		await userEvent.click(screen.getByRole('button', { name: 'Link erzeugen' }));
		expect(screen.getByText('Wähle mindestens eine Aktion.')).toBeInTheDocument();
		expect(screen.getByText('Bitte gib eine ganze Zahl von 1 bis 730 an.')).toBeInTheDocument();
		expect(await api.listTriggerLinks()).toEqual([]);
	});

	it('shows the German message when the maximum is reached', async () => {
		for (let i = 0; i < 20; i++) await api.createTriggerLink({ label: `l${i}`, actions: ['start'] });
		render(TriggerLinksPage);
		await userEvent.type(await screen.findByLabelText('Bezeichnung'), 'einer zu viel');
		await userEvent.click(screen.getByRole('button', { name: 'Link erzeugen' }));
		expect(await screen.findByText(/schon 20 Auslöse-Links aktiv/)).toBeInTheDocument();
		expect(screen.queryByTestId('created-link')).toBeNull();
	});

	it('shows the unavailable notice on a server without trigger links', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/trigger-links') ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }) : mock.fetch(input, init)
		);
		render(TriggerLinksPage);
		expect(await screen.findByTestId('time-unavailable')).toBeInTheDocument();
	});
});
