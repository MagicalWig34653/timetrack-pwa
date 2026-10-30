import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} as Record<string, string> }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import PublicPage from './g/[token]/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

/** An owner account creates the groups; afterwards the page is used anonymously (the public client never sends the cookie). */
async function ownerSetup() {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
	localStorage.clear();
}

async function newPoll(extra: Record<string, unknown> = {}) {
	const poll = await api.createPoll({
		title: 'Teamabend',
		description: 'Wann passt es?',
		kind: 'date',
		choiceMode: 'multi',
		options: [{ date: '2026-12-01', startTime: '18:00', endTime: '20:00' }, { date: '2026-12-02' }],
		...extra
	} as never);
	pageState.params = { token: poll.token! };
	return poll;
}

async function newOrder(catalog = false) {
	const cat = catalog ? await api.createCatalog({ name: 'Döner', items: [{ name: 'Döner', priceCents: 700 }, { name: 'Falafel', priceCents: 650 }] }) : null;
	const order = await api.createOrder({ title: 'Dönerstag', note: 'Bestellung bis 11 Uhr', ...(cat ? { catalogId: cat.id } : {}) });
	pageState.params = { token: order.token! };
	return order;
}

const storedMemory = (token: string) => JSON.parse(localStorage.getItem(`tt-groups:${token}`) ?? 'null');

beforeEach(async () => {
	await ownerSetup();
});
afterEach(() => vi.unstubAllGlobals());

describe('public poll page /g/<token>', () => {
	it('shows the poll without any account call and sends neither cookies nor CSRF', async () => {
		const poll = await newPoll();
		mock.calls.length = 0;
		render(PublicPage);
		expect(await screen.findByTestId('group-title')).toHaveTextContent('Teamabend');
		expect(screen.getByTestId('group-description')).toHaveTextContent('Wann passt es?');
		expect(screen.getByText('Alle Uhrzeiten gelten in der Zeitzone Europe/Berlin.')).toBeInTheDocument();
		expect(mock.calls.map((c) => c.path)).toEqual([`/api/v1/public/groups/${poll.token}`]);
		expect(mock.calls.every((c) => c.credentials === 'omit' && !c.csrf)).toBe(true);
		expect(mock.calls.some((c) => c.path.includes('/auth/') || c.path.includes('/modules'))).toBe(false);
	});

	it('votes with yes/maybe/no, remembers the edit secret, shows the matrix and highlights the best option', async () => {
		const poll = await newPoll();
		render(PublicPage);
		const form = await screen.findByTestId('vote-form');
		await userEvent.type(within(form).getByLabelText('Dein Name'), 'Anna');
		const options = within(form).getAllByTestId('vote-option');
		expect(options).toHaveLength(2);
		await userEvent.click(within(options[0]).getByLabelText('Ja'));
		await userEvent.click(within(options[1]).getByLabelText('Vielleicht'));
		await userEvent.click(within(form).getByRole('button', { name: 'Abstimmen' }));

		expect(await screen.findByTestId('vote-notice')).toHaveTextContent('Danke, deine Antwort ist gespeichert');
		const rows = await screen.findAllByTestId('vote-row');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toHaveTextContent('Anna');
		expect(rows[0]).toHaveTextContent('(du)');
		expect(rows[0].querySelectorAll('[data-answer]')[0]).toHaveAttribute('data-answer', 'yes');
		expect(rows[0].querySelectorAll('[data-answer]')[1]).toHaveAttribute('data-answer', 'maybe');
		expect(screen.getByTestId(`option-head-${poll.options[0].id}`)).toHaveTextContent('Beste Wahl');
		expect(screen.getByTestId(`option-head-${poll.options[1].id}`)).not.toHaveTextContent('Beste Wahl');

		const memory = storedMemory(poll.token!);
		expect(memory.name).toBe('Anna');
		expect(Object.keys(memory.votes)).toHaveLength(1);
		expect(Object.values(memory.votes)[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// the form switched to edit mode with the stored answers
		expect(screen.getByRole('heading', { name: 'Deine Antwort ändern' })).toBeInTheDocument();
		expect((within(screen.getByTestId('vote-form')).getAllByTestId('vote-option')[0].querySelector('input:checked') as HTMLInputElement).value).toBe('yes');
	});

	it('edits the own vote with the secret and withdraws it', async () => {
		const poll = await newPoll();
		render(PublicPage);
		await userEvent.type(await screen.findByLabelText('Dein Name'), 'Ben');
		await userEvent.click(within(screen.getAllByTestId('vote-option')[1]).getByLabelText('Ja'));
		await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
		await screen.findAllByTestId('vote-row');

		await userEvent.click(within(screen.getAllByTestId('vote-option')[1]).getByLabelText('Nein'));
		await userEvent.click(within(screen.getAllByTestId('vote-option')[0]).getByLabelText('Ja'));
		await userEvent.click(screen.getByRole('button', { name: 'Änderung speichern' }));
		expect(await screen.findByTestId('vote-notice')).toHaveTextContent('Deine Antwort wurde geändert');
		await waitFor(() => expect(screen.getAllByTestId('vote-row')[0].querySelectorAll('[data-answer]')[0]).toHaveAttribute('data-answer', 'yes'));
		const put = mock.calls.find((c) => c.method === 'PUT' && c.path.includes('/votes/'));
		expect(put).toBeTruthy();

		await userEvent.click(screen.getByRole('button', { name: 'Stimme zurückziehen' }));
		await waitFor(() => expect(screen.queryAllByTestId('vote-row')).toHaveLength(0));
		expect(screen.getByTestId('vote-notice')).toHaveTextContent('zurückgezogen');
		expect(Object.keys(storedMemory(poll.token!).votes)).toHaveLength(0);
		expect(screen.getByRole('heading', { name: 'Abstimmen' })).toBeInTheDocument();
	});

	it('explains a taken name (409 name_taken) without losing the input', async () => {
		const poll = await newPoll();
		const first = await fetch(`/api/v1/public/groups/${poll.token}/votes`, { method: 'POST', body: JSON.stringify({ name: 'Carla', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] }) });
		expect(first.status).toBe(201);
		render(PublicPage);
		await userEvent.type(await screen.findByLabelText('Dein Name'), ' carla');
		await userEvent.click(within(screen.getAllByTestId('vote-option')[0]).getByLabelText('Ja'));
		await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
		expect(await screen.findByText(/Dieser Name ist schon vergeben/)).toBeInTheDocument();
		expect(screen.getByLabelText('Dein Name')).toHaveValue(' carla');
		expect(storedMemory(poll.token!)?.votes ?? {}).toEqual({});
	});

	it('drops a lost edit secret on 403 and lets the person vote again', async () => {
		const poll = await newPoll();
		const first = render(PublicPage);
		await userEvent.type(await screen.findByLabelText('Dein Name'), 'Dora');
		await userEvent.click(within(screen.getAllByTestId('vote-option')[0]).getByLabelText('Ja'));
		await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
		await screen.findAllByTestId('vote-row');
		first.unmount();
		// corrupt the stored secret
		const memory = storedMemory(poll.token!);
		const id = Object.keys(memory.votes)[0];
		memory.votes[id] = 'tampered';
		localStorage.setItem(`tt-groups:${poll.token}`, JSON.stringify(memory));
		render(PublicPage); // a fresh page visit reads the corrupted secret
		await screen.findByTestId('vote-form');
		await userEvent.click(screen.getByRole('button', { name: 'Änderung speichern' }));
		expect(await screen.findByText(/nicht mehr geändert werden/)).toBeInTheDocument();
		expect(storedMemory(poll.token!).votes[id]).toBeUndefined();
	});

	it('single choice polls need exactly one option and show text options as radio buttons', async () => {
		await newPoll({ kind: 'text', choiceMode: 'single', options: [{ label: 'Pizza' }, { label: 'Sushi' }] });
		render(PublicPage);
		await userEvent.type(await screen.findByLabelText('Dein Name'), 'Eva');
		await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
		expect(await screen.findByTestId('vote-error')).toHaveTextContent('Wähle genau eine Möglichkeit.');
		await userEvent.click(screen.getByLabelText('Sushi'));
		await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
		expect(await screen.findAllByTestId('vote-row')).toHaveLength(1);
	});

	it('hides the results while open and shows the final result and closed state afterwards', async () => {
		const poll = await newPoll({ hideResults: true });
		await fetch(`/api/v1/public/groups/${poll.token}/votes`, { method: 'POST', body: JSON.stringify({ name: 'Finn', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] }) });
		const view = render(PublicPage);
		expect(await screen.findByTestId('results-hidden')).toHaveTextContent('Bisher haben 1 abgestimmt');
		expect(screen.queryByTestId('poll-results')).toBeNull();
		view.unmount();

		await api.setPollFinalOption(poll.id!, poll.options[1].id);
		render(PublicPage);
		expect(await screen.findByTestId('final-result')).toHaveTextContent('Ergebnis der Umfrage');
		expect(screen.getByTestId('closed-note')).toBeInTheDocument();
		expect(screen.queryByTestId('vote-form')).toBeNull();
		expect(await screen.findAllByTestId('vote-row')).toHaveLength(1);
		expect(screen.getByTestId(`option-head-${poll.options[1].id}`)).toHaveTextContent('Gewählt');
	});

	it('shows a neutral not-found page for unknown or renewed links', async () => {
		const poll = await newPoll();
		await api.rotatePollToken(poll.id!);
		render(PublicPage);
		expect(await screen.findByTestId('group-notfound')).toHaveTextContent('Dieser Link gilt nicht (mehr)');
		expect(screen.queryByTestId('vote-form')).toBeNull();
	});

	it('offers a retry when the server cannot be reached', async () => {
		await newPoll();
		const real = mock.fetch;
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
		render(PublicPage);
		expect(await screen.findByTestId('group-error')).toBeInTheDocument();
		vi.stubGlobal('fetch', real);
		await userEvent.click(screen.getByRole('button', { name: 'Noch einmal versuchen' }));
		expect(await screen.findByTestId('group-title')).toBeInTheDocument();
	});
});

describe('public order page /g/<token>', () => {
	it('adds entries, groups equal dishes and shows the total', async () => {
		const order = await newOrder(true);
		render(PublicPage);
		expect(await screen.findByTestId('group-title')).toHaveTextContent('Dönerstag');
		// catalog suggestions fill dish and price
		await userEvent.click(within(await screen.findByTestId('suggestions')).getByRole('button', { name: /Döner/ }));
		expect(screen.getByLabelText('Was möchtest du?')).toHaveValue('Döner');
		expect(screen.getByLabelText('Preis in € (optional)')).toHaveValue('7,00');
		await userEvent.type(screen.getByLabelText('Dein Name'), 'Anna');
		await userEvent.clear(screen.getByLabelText('Menge'));
		await userEvent.type(screen.getByLabelText('Menge'), '2');
		await userEvent.type(screen.getByLabelText('Notiz (optional)'), 'ohne Zwiebeln');
		await userEvent.click(screen.getByRole('button', { name: 'Eintragen' }));
		expect(await screen.findByTestId('entry-notice')).toHaveTextContent('„Döner“ ist eingetragen.');
		const lines = await screen.findAllByTestId('order-line');
		expect(lines).toHaveLength(1);
		expect(lines[0]).toHaveTextContent('2×');
		expect(lines[0]).toHaveTextContent('Döner (ohne Zwiebeln)');
		expect(lines[0]).toHaveTextContent('Anna');
		expect(screen.getByTestId('order-total-value').textContent).toMatch(/14,00\s€/);
		expect(Object.keys(storedMemory(order.token!).entries)).toHaveLength(1);
		// the form is reset for the next entry but the name stays
		expect(screen.getByLabelText('Was möchtest du?')).toHaveValue('');
		expect(screen.getByLabelText('Dein Name')).toHaveValue('Anna');
	});

	it('validates the form on the client', async () => {
		await newOrder();
		render(PublicPage);
		await screen.findByTestId('entry-form');
		await userEvent.click(screen.getByRole('button', { name: 'Eintragen' }));
		expect(screen.getByText('Gib deinen Namen an.')).toBeInTheDocument();
		expect(screen.getByText('Gib an, was du möchtest.')).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText('Dein Name'), 'A');
		await userEvent.type(screen.getByLabelText('Was möchtest du?'), 'X');
		await userEvent.type(screen.getByLabelText('Preis in € (optional)'), 'abc');
		await userEvent.click(screen.getByRole('button', { name: 'Eintragen' }));
		expect(screen.getByText(/Der Preis ist ungültig/)).toBeInTheDocument();
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/entries'))).toBe(false);
	});

	it('takes over a dish of someone else with an own name and quantity', async () => {
		const order = await newOrder();
		await fetch(`/api/v1/public/groups/${order.token}/entries`, { method: 'POST', body: JSON.stringify({ name: 'Ben', item: 'Falafel', priceCents: 650 }) });
		render(PublicPage);
		const line = (await screen.findAllByTestId('order-line'))[0];
		await userEvent.type(screen.getByLabelText('Dein Name'), 'Cleo');
		await userEvent.click(within(line).getByRole('button', { name: '„Falafel“ für mich übernehmen' }));
		await userEvent.clear(screen.getByLabelText('Menge', { selector: '#take-qty' }));
		await userEvent.type(screen.getByLabelText('Menge', { selector: '#take-qty' }), '3');
		await userEvent.click(screen.getByRole('button', { name: 'Für mich eintragen' }));
		expect(await screen.findByTestId('entry-notice')).toHaveTextContent('„Falafel“ wurde für dich übernommen.');
		const merged = (await screen.findAllByTestId('order-line'))[0];
		expect(merged).toHaveTextContent('4×');
		expect(merged).toHaveTextContent('Ben, Cleo');
		expect(Object.keys(storedMemory(order.token!).entries)).toHaveLength(1);
	});

	it('edits and deletes only own entries', async () => {
		const order = await newOrder();
		await fetch(`/api/v1/public/groups/${order.token}/entries`, { method: 'POST', body: JSON.stringify({ name: 'Ben', item: 'Fremd' }) });
		render(PublicPage);
		await userEvent.type(await screen.findByLabelText('Dein Name'), 'Dora');
		await userEvent.type(screen.getByLabelText('Was möchtest du?'), 'Pizza');
		await userEvent.click(screen.getByRole('button', { name: 'Eintragen' }));
		await screen.findByTestId('entry-notice');
		const entries = await screen.findAllByTestId('order-entry');
		expect(entries).toHaveLength(2);
		expect(within(entries[0]).queryByRole('button')).toBeNull();
		await userEvent.click(within(entries[1]).getByRole('button', { name: 'Eintrag Pizza ändern' }));
		expect(screen.getByRole('heading', { name: 'Eintrag ändern' })).toBeInTheDocument();
		await userEvent.clear(screen.getByLabelText('Was möchtest du?'));
		await userEvent.type(screen.getByLabelText('Was möchtest du?'), 'Pasta');
		await userEvent.click(screen.getByRole('button', { name: 'Änderung speichern' }));
		await waitFor(() => expect(screen.getAllByTestId('order-entry')[1]).toHaveTextContent('Pasta'));
		await userEvent.click(within(screen.getAllByTestId('order-entry')[1]).getByRole('button', { name: 'Eintrag Pasta löschen' }));
		await waitFor(() => expect(screen.getAllByTestId('order-entry')).toHaveLength(1));
		expect(Object.keys(storedMemory(order.token!).entries)).toHaveLength(0);
	});

	it('downloads the list as CSV and text through the public export', async () => {
		const order = await newOrder();
		await fetch(`/api/v1/public/groups/${order.token}/entries`, { method: 'POST', body: JSON.stringify({ name: 'Ben', item: 'Falafel' }) });
		const urls: Blob[] = [];
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => (urls.push(b), 'blob:x'), revokeObjectURL: () => {} }));
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		render(PublicPage);
		const buttons = await screen.findByTestId('export-buttons');
		await userEvent.click(within(buttons).getByRole('button', { name: 'CSV' }));
		await waitFor(() => expect(urls).toHaveLength(1));
		await userEvent.click(within(buttons).getByRole('button', { name: 'Text' }));
		await waitFor(() => expect(urls).toHaveLength(2));
		expect(mock.calls.filter((c) => c.path.includes('/export')).map((c) => c.path.split('?')[1])).toEqual(['format=csv', 'format=txt']);
		click.mockRestore();
	});

	it('shows a closed round without form and take buttons', async () => {
		const order = await newOrder();
		await fetch(`/api/v1/public/groups/${order.token}/entries`, { method: 'POST', body: JSON.stringify({ name: 'Ben', item: 'Falafel' }) });
		await api.closeOrder(order.id!);
		render(PublicPage);
		expect(await screen.findByTestId('closed-note')).toBeInTheDocument();
		expect(screen.queryByTestId('entry-form')).toBeNull();
		expect(screen.queryByRole('button', { name: /übernehmen/ })).toBeNull();
		expect(screen.getAllByTestId('order-line')).toHaveLength(1);
	});
});
