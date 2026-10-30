import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { freshLinks } from '#lib/groups/fresh-links.svelte.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/groups'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import GroupsList from './(app)/groups/+page.svelte';
import NewPoll from './(app)/groups/polls/new/+page.svelte';
import PollDetail from './(app)/groups/polls/[id]/+page.svelte';
import NewOrder from './(app)/groups/orders/new/+page.svelte';
import OrderDetail from './(app)/groups/orders/[id]/+page.svelte';
import Catalogs from './(app)/groups/catalogs/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;
const publicPost = (token: string, path: string, body: unknown) => fetch(`/api/v1/public/groups/${token}${path}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

beforeEach(async () => {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	goto.mockReset();
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('/groups list', () => {
	it('shows empty states, then polls and rounds with status and counts', async () => {
		const view = render(GroupsList);
		expect(await screen.findByTestId('polls-empty')).toBeInTheDocument();
		expect(screen.getByTestId('orders-empty')).toBeInTheDocument();
		expect(screen.getByTestId('new-poll')).toHaveAttribute('href', '/groups/polls/new');
		expect(screen.getByTestId('new-order')).toHaveAttribute('href', '/groups/orders/new');
		view.unmount();

		const poll = await api.createPoll({ title: 'Teamabend', kind: 'text', choiceMode: 'single', options: [{ label: 'a' }, { label: 'b' }] });
		await publicPost(poll.token!, '/votes', { name: 'A', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] });
		await api.createOrder({ title: 'Dönerstag' });
		render(GroupsList);
		const list = await screen.findByTestId('poll-list');
		expect(list).toHaveTextContent('Teamabend');
		expect(list).toHaveTextContent('Textumfrage');
		expect(list).toHaveTextContent('Stimmen: 1');
		expect(list).toHaveTextContent('Offen');
		expect(list.querySelector('a')).toHaveAttribute('href', `/groups/polls/${poll.id}`);
		expect(await screen.findByTestId('order-list')).toHaveTextContent('Dönerstag');
		expect(screen.getByTestId('catalogs-link')).toHaveAttribute('href', '/groups/catalogs');
		// the link token never appears in the owner list
		expect(document.body.textContent).not.toContain(poll.token);
	});
});

describe('new poll', () => {
	it('creates a date poll with times and keeps the link in memory only', async () => {
		render(NewPoll);
		await userEvent.type(await screen.findByLabelText('Titel'), 'Teamabend');
		const rows = screen.getAllByTestId('date-row');
		await fireEvent.input(within(rows[0]).getByLabelText('Datum'), { target: { value: '2026-12-01' } });
		await fireEvent.input(within(rows[0]).getByLabelText('Von (optional)'), { target: { value: '18:00' } });
		await fireEvent.input(within(rows[0]).getByLabelText('Bis (optional)'), { target: { value: '20:00' } });
		await userEvent.click(screen.getByTestId('add-option'));
		const second = screen.getAllByTestId('date-row')[1];
		expect(within(second).getByLabelText('Datum')).toHaveValue('2026-12-02');
		await userEvent.click(screen.getByRole('button', { name: 'Umfrage anlegen' }));
		await waitFor(() => expect(goto).toHaveBeenCalled());
		const polls = await api.listPolls();
		expect(polls).toHaveLength(1);
		expect(goto).toHaveBeenCalledWith(`/groups/polls/${polls[0].id}`);
		const poll = await api.getPoll(polls[0].id);
		expect(poll.kind).toBe('date');
		expect(poll.timeZone).toBe('Europe/Berlin');
		expect(poll.options.map((o) => [o.date, o.startTime, o.endTime])).toEqual([['2026-12-01', '18:00', '20:00'], ['2026-12-02', '18:00', '20:00']]);
		expect(freshLinks.get(polls[0].id)).toMatch(/^\/g\/[A-Za-z0-9_-]{43}$/);
	});

	it('creates a text poll: Enter adds the next option, empty rows are ignored, errors are explained', async () => {
		render(NewPoll);
		await userEvent.click(await screen.findByTestId('kind-text'));
		await userEvent.click(screen.getByRole('button', { name: 'Umfrage anlegen' }));
		expect(screen.getByText('Gib einen Titel an.')).toBeInTheDocument();
		expect(screen.getByText('Lege mindestens eine Möglichkeit an.')).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText('Titel'), 'Essen');
		await userEvent.type(screen.getByLabelText('Möglichkeit 1'), 'Pizza{Enter}');
		expect(screen.getAllByTestId('text-row')).toHaveLength(3);
		await userEvent.type(screen.getByLabelText('Möglichkeit 2'), 'Sushi');
		await userEvent.click(screen.getByTestId('mode-single'));
		await userEvent.click(screen.getByRole('switch', { name: /Ergebnisse bis zum Ende verbergen/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Umfrage anlegen' }));
		await waitFor(() => expect(goto).toHaveBeenCalled());
		const [summary] = await api.listPolls();
		const poll = await api.getPoll(summary.id);
		expect(poll).toMatchObject({ kind: 'text', choiceMode: 'single', hideResults: true });
		expect(poll.options.map((o) => o.label)).toEqual(['Pizza', 'Sushi']);
		expect(poll.timeZone).toBeNull();
	});

	it('rejects a deadline in the past and a time range without start', async () => {
		render(NewPoll);
		await userEvent.type(await screen.findByLabelText('Titel'), 'X');
		const row = screen.getAllByTestId('date-row')[0];
		await fireEvent.input(within(row).getByLabelText('Datum'), { target: { value: '2026-12-01' } });
		await fireEvent.input(within(row).getByLabelText('Bis (optional)'), { target: { value: '20:00' } });
		await userEvent.click(screen.getByRole('button', { name: 'Umfrage anlegen' }));
		expect(screen.getByText(/Jeder Termin braucht ein gültiges Datum/)).toBeInTheDocument();
		await fireEvent.input(within(row).getByLabelText('Bis (optional)'), { target: { value: '' } });
		await fireEvent.input(screen.getByLabelText('Frist (optional)'), { target: { value: '2020-01-01T10:00' } });
		await userEvent.click(screen.getByRole('button', { name: 'Umfrage anlegen' }));
		expect(screen.getAllByText('Die Frist muss in der Zukunft liegen.').length).toBeGreaterThan(0);
		expect(await api.listPolls()).toHaveLength(0);
	});
});

describe('poll detail', () => {
	async function openDetail(fresh = true) {
		const poll = await api.createPoll({ title: 'Wann?', kind: 'date', choiceMode: 'multi', options: [{ date: '2026-12-01' }, { date: '2026-12-02' }] });
		if (fresh) freshLinks.set(poll.id!, poll.path!);
		pageState.params = { id: poll.id! };
		await publicPost(poll.token!, '/votes', { name: 'Anna', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] });
		await publicPost(poll.token!, '/votes', { name: 'Ben', answers: [{ optionId: poll.options[0].id, answer: 'yes' }, { optionId: poll.options[1].id, answer: 'maybe' }] });
		render(PollDetail);
		await screen.findByTestId('poll-results');
		return poll;
	}

	it('shows the fresh link with copy button, the matrix with the best option and the tally', async () => {
		const poll = await openDetail();
		expect(screen.getByTestId('share-link-url')).toHaveValue(`${location.origin}${poll.path}`);
		expect(screen.getByRole('button', { name: 'Link kopieren' })).toBeInTheDocument();
		expect(screen.getAllByTestId('vote-row')).toHaveLength(2);
		expect(screen.getByTestId(`option-head-${poll.options[0].id}`)).toHaveTextContent('Beste Wahl');
		expect(screen.getByTestId(`tally-${poll.options[0].id}`)).toHaveTextContent('2');
		expect(screen.getByTestId(`tally-${poll.options[1].id}`)).toHaveTextContent('0 (+1)');
	});

	it('shows the known link again without a fresh note; renewing shows a new link and the old one stops working', async () => {
		const poll = await openDetail(false);
		expect(screen.getByTestId('share-link-url')).toHaveValue(`${location.origin}${poll.path}`);
		expect(screen.getByTestId('share-link-known')).toHaveTextContent('jederzeit wieder ansehen');
		expect(screen.queryByTestId('share-link-fresh')).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: 'Link erneuern' }));
		expect(screen.getByTestId('rotate-confirm')).toHaveTextContent('Der bisherige Link funktioniert sofort nicht mehr');
		await userEvent.click(screen.getByRole('button', { name: 'Neuen Link erzeugen' }));
		const input = await screen.findByTestId('share-link-url');
		expect((input as HTMLInputElement).value).not.toContain(poll.token!);
		expect((await fetch(`/api/v1/public/groups/${poll.token}`)).status).toBe(404);
	});

	it('closes, reopens, chooses and withdraws the final option', async () => {
		const poll = await openDetail();
		await userEvent.click(screen.getByTestId('close'));
		expect(await screen.findByTestId('reopen')).toBeInTheDocument();
		expect(screen.getByTestId('notice')).toHaveTextContent('Beendet');
		await userEvent.click(screen.getByTestId('reopen'));
		await screen.findByTestId('close');
		await userEvent.click(screen.getAllByRole('button', { name: /als Ergebnis wählen/ })[1]);
		await waitFor(() => expect(screen.getByTestId('final-result')).toBeInTheDocument());
		expect((await api.getPoll(poll.id!)).finalOptionId).toBe(poll.options[1].id);
		await userEvent.click(screen.getByRole('button', { name: 'Zurücknehmen' }));
		await waitFor(() => expect(screen.queryByTestId('final-result')).toBeNull());
	});

	it('removes a vote after confirmation and deletes the poll', async () => {
		const poll = await openDetail();
		await userEvent.click(screen.getByRole('button', { name: 'Stimme von Anna entfernen' }));
		expect(screen.getByTestId('confirm-dialog')).toHaveTextContent('Die Stimme von Anna wird entfernt');
		await userEvent.click(screen.getByTestId('confirm-submit'));
		await waitFor(() => expect(screen.getAllByTestId('vote-row')).toHaveLength(1));
		expect((await api.getPoll(poll.id!)).voteCount).toBe(1);

		await userEvent.click(screen.getByTestId('delete'));
		await userEvent.click(screen.getByTestId('confirm-submit'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/groups'));
		expect(await api.listPolls()).toHaveLength(0);
	});

	it('edits title, deadline and the hide switch', async () => {
		const poll = await openDetail();
		await userEvent.click(screen.getByTestId('edit-settings'));
		const form = screen.getByTestId('edit-form');
		await userEvent.clear(within(form).getByLabelText('Titel'));
		await userEvent.type(within(form).getByLabelText('Titel'), 'Neuer Titel');
		await userEvent.click(within(form).getByRole('switch'));
		await userEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
		await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('Gespeichert.'));
		expect(await api.getPoll(poll.id!)).toMatchObject({ title: 'Neuer Titel', hideResults: true });
	});

	it('shows a friendly message for an unknown poll', async () => {
		pageState.params = { id: crypto.randomUUID() };
		render(PollDetail);
		expect(await screen.findByTestId('not-found')).toBeInTheDocument();
	});
});

describe('new order and order detail', () => {
	it('creates a round with a catalog', async () => {
		const catalog = await api.createCatalog({ name: 'Döner', items: [{ name: 'Döner', priceCents: 700 }] });
		render(NewOrder);
		await userEvent.type(await screen.findByLabelText('Titel'), 'Dönerstag');
		await screen.findByRole('option', { name: /Döner \(Gerichte: 1\)/ });
		await userEvent.selectOptions(screen.getByLabelText('Katalog (optional)'), catalog.id);
		await userEvent.click(screen.getByRole('button', { name: 'Bestellrunde anlegen' }));
		await waitFor(() => expect(goto).toHaveBeenCalled());
		const [summary] = await api.listOrders();
		expect((await api.getOrder(summary.id)).catalogId).toBe(catalog.id);
		expect(freshLinks.get(summary.id)).toMatch(/^\/g\//);
	});

	async function openOrder() {
		const order = await api.createOrder({ title: 'Dönerstag' });
		freshLinks.set(order.id!, order.path!);
		pageState.params = { id: order.id! };
		await publicPost(order.token!, '/entries', { name: 'Anna', item: 'Döner', quantity: 2, priceCents: 700 });
		await publicPost(order.token!, '/entries', { name: 'Ben', item: 'Falafel' });
		render(OrderDetail);
		await screen.findByTestId('order-summary');
		return order;
	}

	it('shows the grouped overview, total and removes an entry after confirmation', async () => {
		const order = await openOrder();
		expect(await screen.findAllByTestId('order-line')).toHaveLength(2);
		expect(screen.getByTestId('order-total-value').textContent).toMatch(/14,00\s€/);
		expect(screen.getByTestId('order-total')).toHaveTextContent('davon ohne Preis: 1');
		await userEvent.click(screen.getByRole('button', { name: 'Eintrag Falafel von Ben entfernen' }));
		await userEvent.click(screen.getByTestId('confirm-submit'));
		await waitFor(() => expect(screen.getAllByTestId('order-line')).toHaveLength(1));
		expect((await api.getOrder(order.id!)).entryCount).toBe(1);
	});

	it('exports CSV and text through the owner endpoint and closes the round', async () => {
		const order = await openOrder();
		const blobs: Blob[] = [];
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.push(b), 'blob:x'), revokeObjectURL: () => {} }));
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		const buttons = screen.getByTestId('export-buttons');
		await userEvent.click(within(buttons).getByRole('button', { name: 'CSV' }));
		await waitFor(() => expect(blobs).toHaveLength(1));
		expect(mock.calls.some((c) => c.path === `/api/v1/groups/orders/${order.id}/export?format=csv`)).toBe(true);
		click.mockRestore();
		await userEvent.click(screen.getByTestId('close'));
		expect(await screen.findByTestId('reopen')).toBeInTheDocument();
		expect((await fetch(`/api/v1/public/groups/${order.token}`).then((r) => r.json())).order.closed).toBe(true);
	});
});

describe('catalogs', () => {
	it('creates, edits and deletes a catalog with prices and takes dishes from earlier rounds', async () => {
		const order = await api.createOrder({ title: 'Alt' });
		await publicPost(order.token!, '/entries', { name: 'A', item: 'Pizza', priceCents: 900 });
		render(Catalogs);
		expect(await screen.findByTestId('catalogs-empty')).toBeInTheDocument();
		await userEvent.click(screen.getByTestId('new-catalog'));
		await userEvent.type(screen.getByLabelText('Name'), 'Italiener');
		await userEvent.click(within(await screen.findByTestId('catalog-suggestions')).getByRole('button', { name: /Pizza/ }));
		await userEvent.click(screen.getByTestId('add-dish'));
		const rows = screen.getAllByTestId('catalog-row');
		await userEvent.type(within(rows[1]).getByLabelText('Gericht 2'), 'Pasta');
		await userEvent.type(within(rows[1]).getByLabelText('Preis von Gericht 2 in Euro'), '8,5');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		const list = await screen.findByTestId('catalog-list');
		expect(list).toHaveTextContent('Italiener');
		expect(list).toHaveTextContent('Gerichte: 2');
		const [saved] = await api.listCatalogs();
		expect(saved.items).toEqual([{ name: 'Pizza', priceCents: 900 }, { name: 'Pasta', priceCents: 850 }]);

		await userEvent.click(screen.getByRole('button', { name: 'Katalog Italiener bearbeiten' }));
		await userEvent.click(screen.getByRole('button', { name: 'Gericht 1 entfernen' }));
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await waitFor(() => expect(list).toHaveTextContent('Gerichte: 1'));

		await userEvent.click(screen.getByRole('button', { name: 'Katalog Italiener löschen' }));
		await userEvent.click(screen.getByTestId('confirm-submit'));
		expect(await screen.findByTestId('catalogs-empty')).toBeInTheDocument();
	});

	it('refuses a nameless catalog and an invalid price', async () => {
		render(Catalogs);
		await userEvent.click(await screen.findByTestId('new-catalog'));
		await userEvent.type(screen.getByLabelText('Gericht 1'), 'X');
		await userEvent.type(screen.getByLabelText('Preis von Gericht 1 in Euro'), 'zwei');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(screen.getByText('Gib dem Katalog einen Namen.')).toBeInTheDocument();
		expect(screen.getByText(/ein Preis muss eine Zahl sein/)).toBeInTheDocument();
		expect(await api.listCatalogs()).toHaveLength(0);
	});
});
