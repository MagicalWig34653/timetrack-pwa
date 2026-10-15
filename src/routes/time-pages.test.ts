import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/time'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: pageState }));

import Dashboard from './(app)/+page.svelte';
import WeekPage from './(app)/time/+page.svelte';
import DayPage from './(app)/time/[date]/+page.svelte';
import SuggestionsPage from './(app)/suggestions/+page.svelte';
import DevicesPage from './(app)/settings/devices/+page.svelte';
import WorkModelPage from './(app)/settings/work-model/+page.svelte';

// Wednesday 14.10.2026 11:30 Berlin; only Date is faked so timers and promises keep running.
const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('dashboard "Heute"', () => {
	it('shows the German unavailable notice when the server has no time API', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/time/') || String(input).includes('/work-models') || String(input).includes('/places')
				? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 })
				: mock.fetch(input, init)
		);
		render(Dashboard);
		expect(await screen.findByTestId('time-unavailable')).toHaveTextContent('noch nicht verfügbar');
	});

	it('shows target, balance, open suggestions and the idle timer for an empty day', async () => {
		render(Dashboard);
		expect(await screen.findByRole('heading', { name: 'Hallo, Admin Demo' })).toBeInTheDocument();
		expect(await screen.findByTestId('day-target')).toHaveTextContent('7:42');
		expect(screen.getByTestId('day-delta')).toHaveTextContent('-7:42');
		expect(screen.getByTestId('provisional-badge')).toBeVisible();
		expect(screen.getByTestId('balance').textContent).toMatch(/^[+-]?\d+:\d{2}$/);
		expect(screen.getByTestId('suggestions-notice')).toHaveTextContent('Offene Vorschläge: 1');
		expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
	});

	it('renders raw and evaluated rows, the actual pause and rounding for a finished morning', async () => {
		await api.createSegment({ kind: 'work', startedAt: '2026-10-14T06:07:00Z', endedAt: '2026-10-14T08:00:00Z' }); // 08:07-10:00
		await api.createSegment({ kind: 'work', startedAt: '2026-10-14T08:30:00Z', endedAt: '2026-10-14T09:00:00Z' }); // 10:30-11:00
		render(Dashboard);
		const timeline = await screen.findByTestId('timeline');
		expect(within(timeline).getByTestId('timeline-raw')).toBeInTheDocument();
		expect(within(timeline).getByTestId('timeline-evaluated')).toBeInTheDocument();
		expect(within(timeline).getAllByTestId('timeline-gap')).toHaveLength(1); // 10:00-10:30 stays a gap
		expect(within(timeline).getAllByTestId('timeline-rounding').length).toBeGreaterThan(0);
		expect(screen.getByTestId('day-raw')).toHaveTextContent('2:23'); // 1:53 + 0:30
		expect(screen.getByTestId('day-rounding')).toHaveTextContent('+0:07');
		expect(screen.getByTestId('day-evaluated')).toHaveTextContent('2:30');
		const rows = screen.getAllByTestId('gap-row');
		expect(rows[0]).toHaveTextContent('Pause 0:30');
		expect(screen.queryByTestId('break-hints')).toBeNull(); // no invented pauses, no hint under 6 h
	});

	it('starts and stops the timer from the card', async () => {
		render(Dashboard);
		await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
		expect(await screen.findByRole('button', { name: 'Stopp' })).toBeInTheDocument();
		expect(screen.getByTestId('elapsed')).toHaveTextContent('0:00');
		await userEvent.click(screen.getByRole('button', { name: 'Stopp' }));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument());
	});
});

describe('week list', () => {
	it('lists seven days with target, delta and totals only for elapsed days', async () => {
		pageState.url = new URL('http://localhost/time');
		render(WeekPage);
		const list = await screen.findByTestId('week-list');
		expect(within(list).getAllByRole('link')).toHaveLength(7);
		expect(screen.getByText('Woche vom 12.10.2026 bis 18.10.2026')).toBeInTheDocument();
		const totals = screen.getByTestId('week-totals');
		expect(totals).toHaveTextContent('Soll bisher'); // 3 elapsed workdays = 23:06
		expect(totals).toHaveTextContent('23:06');
	});

	it('navigates to another week via the query parameter', async () => {
		pageState.url = new URL('http://localhost/time?week=2026-10-05');
		render(WeekPage);
		expect(await screen.findByText('Woche vom 05.10.2026 bis 11.10.2026')).toBeInTheDocument();
	});
});

describe('day detail', () => {
	it('voids a segment only with a reason and shows it struck through', async () => {
		pageState.params = { date: '2026-10-12' };
		render(DayPage);
		const rows = await screen.findAllByTestId('segment-row');
		expect(rows).toHaveLength(2);
		await userEvent.click(within(rows[0]).getByRole('button', { name: 'Stornieren' }));
		const form = screen.getByRole('form', { name: 'Eintrag stornieren' });
		await userEvent.click(within(form).getByRole('button', { name: 'Stornieren' }));
		expect(await screen.findByText('Bitte gib einen Grund an.')).toBeInTheDocument();
		expect(mock.calls.some((c) => c.method === 'DELETE' && c.path.includes('/time/segments/'))).toBe(false);
		await userEvent.type(screen.getByLabelText(/^Grund/), 'Fehlbuchung');
		await userEvent.click(within(form).getByRole('button', { name: 'Stornieren' }));
		expect(await screen.findByText('Eintrag storniert.')).toBeInTheDocument();
		expect(await screen.findByText('Storniert')).toBeInTheDocument();
	});

	it('saves day preferences (holiday) and updates the target', async () => {
		pageState.params = { date: '2026-10-13' };
		render(DayPage);
		await screen.findByTestId('day-summary');
		await userEvent.selectOptions(screen.getByLabelText('Markierung'), 'holiday');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Tageseinstellungen gespeichert.')).toBeInTheDocument();
		expect(screen.getByTestId('day-target')).toHaveTextContent('0:00');
	});

	it('rejects an invalid date parameter', async () => {
		pageState.params = { date: '2026-02-31' };
		render(DayPage);
		expect(await screen.findByText('Dieses Datum ist ungültig.')).toBeInTheDocument();
	});
});

describe('suggestions inbox', () => {
	it('accepts a suggestion with edited start time and then shows the empty state', async () => {
		render(SuggestionsPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Annehmen' }));
		const start = screen.getByLabelText('Beginn');
		await userEvent.clear(start);
		await userEvent.type(start, '2026-10-14T08:00');
		await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
		expect(await screen.findByText('Vorschlag übernommen.')).toBeInTheDocument();
		expect(await screen.findByTestId('suggestions-empty')).toBeInTheDocument();
		const segments = await api.listSegments('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z');
		expect(segments[0]).toMatchObject({ source: 'suggestion', startedAt: '2026-10-14T06:00:00.000Z' });
	});

	it('rejects a suggestion', async () => {
		render(SuggestionsPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }));
		expect(await screen.findByText('Vorschlag verworfen.')).toBeInTheDocument();
		expect(await api.listSuggestions()).toEqual([]);
	});
});

describe('device tokens', () => {
	it('shows a new token once, never in the list, and revokes it', async () => {
		render(DevicesPage);
		await userEvent.type(await screen.findByLabelText('Name'), 'iPhone Kurzbefehle');
		await userEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }));
		const banner = await screen.findByTestId('created-token');
		const secret = within(banner).getByTestId('token-value').textContent!;
		expect(secret).toMatch(/^ttd_/);
		const list = await screen.findByTestId('token-list');
		expect(list).toHaveTextContent('iPhone Kurzbefehle');
		expect(list).toHaveTextContent('noch nie genutzt');
		expect(list.textContent).not.toContain(secret);
		expect(screen.getByTestId('shortcut-sample')).toHaveTextContent('Authorization: Bearer');
		await userEvent.click(screen.getByRole('button', { name: 'Ich habe es gespeichert' }));
		expect(screen.queryByTestId('created-token')).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: 'Widerrufen' }));
		await userEvent.click(screen.getByRole('button', { name: 'Endgültig widerrufen' }));
		expect(await screen.findByText('Token widerrufen.')).toBeInTheDocument();
		expect(await api.listDeviceTokens()).toEqual([]);
	});

	it('validates the name', async () => {
		render(DevicesPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Token erzeugen' }));
		expect(await screen.findByText('Bitte gib einen Namen an.')).toBeInTheDocument();
	});
});

describe('work model settings', () => {
	it('explains that history is kept and creates a new version prefilled with h:mm values', async () => {
		render(WorkModelPage);
		expect(await screen.findByTestId('history-note')).toHaveTextContent('Bestehende Versionen werden nie verändert');
		await userEvent.click(screen.getByRole('button', { name: 'Neue Version anlegen' }));
		expect(screen.getByLabelText('Wochen-Soll')).toHaveValue('38:30');
		expect(screen.getByText('Ergibt 7:42 pro Arbeitstag.')).toBeInTheDocument();
		const from = screen.getByLabelText('Gültig ab');
		await userEvent.clear(from);
		await userEvent.type(from, '2026-11-01');
		const weekly = screen.getByLabelText('Wochen-Soll');
		await userEvent.clear(weekly);
		await userEvent.type(weekly, '40:00');
		await userEvent.click(screen.getByRole('button', { name: 'Version anlegen' }));
		expect(await screen.findByText('Neue Version angelegt.')).toBeInTheDocument();
		const list = screen.getByTestId('model-list');
		expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
		expect(list).toHaveTextContent('Ab 01.11.2026');
		expect(list).toHaveTextContent('40:00');
		expect((await api.listWorkModels()).find((m) => m.validFrom === '2026-11-01')).toBeDefined();
	});

	it('opens the form for a new version at ?validFrom=YYYY-MM-DD (worktime import hint) and ignores invalid values', async () => {
		window.history.pushState({}, '', '/settings/work-model?validFrom=2026-09-17');
		try {
			render(WorkModelPage);
			expect(await screen.findByTestId('work-model-prefilled')).toHaveTextContent('17.09.2026');
			expect(screen.getByLabelText('Gültig ab')).toHaveValue('2026-09-17');
			expect(screen.getByLabelText('Wochen-Soll')).toHaveValue('38:30');
			cleanup();
			window.history.pushState({}, '', '/settings/work-model?validFrom=2026-13-45');
			render(WorkModelPage);
			await screen.findByTestId('history-note');
			expect(screen.queryByTestId('work-model-prefilled')).toBeNull();
			expect(screen.queryByLabelText('Gültig ab')).toBeNull();
		} finally {
			window.history.pushState({}, '', '/');
		}
	});

	it('shows German validation errors instead of calling the API', async () => {
		render(WorkModelPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Neue Version anlegen' }));
		const weekly = screen.getByLabelText('Wochen-Soll');
		await userEvent.clear(weekly);
		await userEvent.type(weekly, '38,5');
		await userEvent.click(screen.getByRole('button', { name: 'Version anlegen' }));
		expect(await screen.findByText('Bitte gib die Dauer als h:mm an, zum Beispiel 7:42.')).toBeInTheDocument();
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/work-models'))).toBe(false);
	});
});
