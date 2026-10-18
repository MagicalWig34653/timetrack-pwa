import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';
import { FILTER_STORAGE_KEY } from '#lib/vacation/planner.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/vacation/planner'), params: {} } }));

import PlannerPage from './(app)/vacation/planner/+page.svelte';

// Wednesday 14.10.2026
const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	mock = createMockFetch({ now: () => NOW.getTime() });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	localStorage.clear();
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('vacation planner page', () => {
	it('shows the budget header and ranked cards with the key facts', async () => {
		render(PlannerPage);
		const budget = await screen.findByTestId('planner-budget');
		expect(within(budget).getByTestId('budget-entitlement')).toHaveTextContent('30 Tage');
		expect(within(budget).getByTestId('budget-taken')).toHaveTextContent('8 Tage');
		expect(within(budget).getByTestId('budget-planned')).toHaveTextContent('2,5 Tage');
		expect(within(budget).getByTestId('budget-remaining')).toHaveTextContent('19,5 Tage');

		const cards = await screen.findAllByTestId('suggestion-card');
		expect(cards.length).toBeGreaterThan(0);
		expect(cards.length).toBeLessThanOrEqual(10);
		const first = cards[0];
		expect(within(first).getByTestId('suggestion-summary')).toHaveTextContent(/Urlaubstage? → \d+ Tage frei/);
		expect(within(first).getByTestId('suggestion-factor')).toHaveTextContent(/^Faktor /);
		expect(within(first).getByTestId('suggestion-kind').textContent).toMatch(/Brückentag|Feiertagsblock|Schulferien-Verlängerung|Langer Urlaub/);
		expect(within(first).getByTestId('suggestion-timeline')).toBeInTheDocument();
		expect(within(first).getByRole('button', { name: 'In meinen Urlaub übernehmen' })).toBeInTheDocument();
	});

	it('hides filler windows below factor 2 by default and shows them when the minimum is lowered', async () => {
		render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		const factors = () => screen.getAllByTestId('suggestion-factor').map((e) => Number((e.textContent ?? '').replace('Faktor ', '').replace(',', '.')));
		expect(Math.min(...factors())).toBeGreaterThanOrEqual(2);
		const hidden = await screen.findByTestId('planner-hidden');
		expect(hidden).toHaveTextContent(/ausgeblendet \(Faktor unter 2\)/);

		await userEvent.click(screen.getByTestId('planner-show-all'));
		await waitFor(() => expect(screen.queryByTestId('planner-hidden')).toBeNull());
		await userEvent.clear(screen.getByLabelText('Anzahl Vorschläge'));
		await userEvent.type(screen.getByLabelText('Anzahl Vorschläge'), '50');
		await waitFor(() => expect(Math.min(...factors())).toBeLessThan(2));
	});

	it('remembers the filters in localStorage and restores them', async () => {
		const first = render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		const max = screen.getByLabelText('Höchstens Urlaubstage');
		await userEvent.clear(max);
		await userEvent.type(max, '4');
		await userEvent.click(screen.getByTestId('filter-apply'));
		await waitFor(() => expect(mock.calls.some((c) => c.path.includes('maxVacationDays=4'))).toBe(true));
		expect(JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY)!)).toMatchObject({ maxVacationDays: 4 });
		first.unmount();

		render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		expect(screen.getByLabelText('Höchstens Urlaubstage')).toHaveValue(4);
	});

	it('blocks an invalid range before calling the server', async () => {
		render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		const calls = mock.calls.filter((c) => c.path.includes('/vacation/suggestions')).length;
		await userEvent.clear(screen.getByLabelText('Zeitraum bis'));
		await userEvent.type(screen.getByLabelText('Zeitraum bis'), '2026-01-01');
		expect(await screen.findByTestId('filter-range-error')).toBeInTheDocument();
		expect(screen.getByTestId('filter-apply')).toBeDisabled();
		expect(mock.calls.filter((c) => c.path.includes('/vacation/suggestions')).length).toBe(calls);
	});

	it('shows conflict warnings prominently without hiding the card', async () => {
		render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		await userEvent.click(screen.getByTestId('planner-show-all'));
		const withConflicts = screen.getAllByTestId('suggestion-card').filter((c) => c.getAttribute('data-conflicts') === 'yes');
		expect(withConflicts.length).toBeGreaterThan(0);
		const warning = within(withConflicts[0]).getByTestId('suggestion-conflicts');
		expect(warning).toHaveTextContent('Achtung');
		expect(within(withConflicts[0]).getByTestId('suggestion-range')).toBeVisible();
	});

	it('takes a conflict-free suggestion over after a confirmation and refreshes the suggestions', async () => {
		render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		const card = screen.getAllByTestId('suggestion-card').find((c) => c.getAttribute('data-conflicts') === 'no')!;
		const fetches = () => mock.calls.filter((c) => c.method === 'GET' && c.path.includes('/vacation/suggestions')).length;
		const before = fetches();
		await userEvent.click(within(card).getByTestId('take-over'));
		expect(within(card).getByTestId('take-over-confirm')).toBeInTheDocument();
		expect(within(card).getByTestId('take-over-blocks')).toHaveTextContent(/Urlaubstage?\)/);
		expect(within(card).queryByTestId('ack-conflicts')).toBeNull();
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/absences'))).toBe(false);

		await userEvent.click(within(card).getByTestId('take-over-confirm-button'));
		expect(await screen.findByTestId('planner-notice')).toHaveTextContent(/Urlaub eingetragen|Urlaube eingetragen/);
		const posts = mock.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/absences'));
		expect(posts.length).toBeGreaterThan(0);
		const created = (await api.listAbsences('2026-10-14', '2027-12-31')).filter((a) => a.status === 'planned' && a.kind === 'vacation' && a.startDate > '2026-11-25');
		expect(created.length).toBe(posts.length);
		// suggestions (and with them the budget) are loaded again after the booking
		await waitFor(() => expect(fetches()).toBe(before + 1));
	});

	it('requires an explicit acknowledgement when conflicts exist', async () => {
		render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		await userEvent.click(screen.getByTestId('planner-show-all'));
		const card = screen.getAllByTestId('suggestion-card').find((c) => c.getAttribute('data-conflicts') === 'yes' && within(c).queryByTestId('suggestion-no-budget') === null)!;
		await userEvent.click(within(card).getByTestId('take-over'));
		const confirm = within(card).getByTestId('take-over-confirm-button');
		expect(confirm).toBeDisabled();
		await userEvent.click(within(card).getByTestId('ack-conflicts'));
		expect(confirm).toBeEnabled();
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/absences'))).toBe(false);
	});

	it('shows an empty state when nothing fits', async () => {
		render(PlannerPage);
		await screen.findAllByTestId('suggestion-card');
		const off = screen.getByLabelText('Mindestens freie Tage');
		await userEvent.clear(off);
		await userEvent.type(off, '60');
		await userEvent.click(screen.getByTestId('filter-apply'));
		expect(await screen.findByTestId('planner-empty')).toHaveTextContent('Keine passenden Vorschläge');
	});

	it('shows the German message for 503 database_unavailable with a retry', async () => {
		const original = mock.fetch;
		let fail = true;
		vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
			if (fail && String(input).includes('/vacation/suggestions')) {
				return Promise.resolve(new Response(JSON.stringify({ error: { code: 'database_unavailable', message: 'x' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
			}
			return original(input, init);
		});
		render(PlannerPage);
		const error = await screen.findByTestId('planner-error', undefined, { timeout: 15000 });
		expect(error).toHaveTextContent('Die Datenbank ist gerade nicht erreichbar');
		fail = false;
		await userEvent.click(within(error).getByRole('button', { name: 'Erneut versuchen' }));
		expect((await screen.findAllByTestId('suggestion-card')).length).toBeGreaterThan(0);
	}, 30000);
});
