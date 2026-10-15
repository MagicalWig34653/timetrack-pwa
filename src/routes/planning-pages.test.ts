import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import type { VacationBalance } from '#lib/api/types.js';
import AbsenceForm from '#lib/components/planning/AbsenceForm.svelte';
import VacationBalanceCard from '#lib/components/planning/VacationBalanceCard.svelte';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/calendar'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: pageState }));

import AbsencesPage from './(app)/absences/+page.svelte';
import CalendarPage from './(app)/calendar/+page.svelte';
import SharedPage from './(app)/shared/+page.svelte';
import SharingPage from './(app)/settings/sharing/+page.svelte';
import VacationPage from './(app)/vacation/+page.svelte';

// Wednesday 14.10.2026 11:30 Berlin
const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

async function signIn() {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	mock = createMockFetch({ now: () => NOW.getTime() });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	pageState.url = new URL('http://localhost/calendar');
	await signIn();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const balance = (extra: Partial<VacationBalance> = {}): VacationBalance => ({
	year: 2026,
	snapshotDate: null,
	entitlementHalfDays: 60,
	carryOverHalfDays: 5,
	adjustmentHalfDays: -1,
	bookedHalfDays: 16,
	plannedHalfDays: 5,
	availableHalfDays: 48,
	availableAfterPlannedHalfDays: 43,
	...extra
});

describe('VacationBalanceCard', () => {
	it('shows days with halves, the formula rows and the planned preview', () => {
		render(VacationBalanceCard, { balance: balance() });
		expect(screen.getByTestId('balance-available')).toHaveTextContent('24 Tage');
		expect(screen.getByTestId('balance-after-planned')).toHaveTextContent('21,5 Tage');
		expect(screen.getByTestId('balance-entitlement')).toHaveTextContent('30 Tage');
		expect(screen.getByTestId('balance-carry')).toHaveTextContent('2,5 Tage');
		expect(screen.getByTestId('balance-adjustments')).toHaveTextContent('-0,5 Tage');
		expect(screen.getByTestId('balance-booked')).toHaveTextContent('-8 Tage');
		expect(screen.getByTestId('balance-planned')).toHaveTextContent('2,5 Tage');
		expect(screen.getByText(/Verfügbar = Anspruch \+ Übertrag/)).toBeInTheDocument();
	});

	it('explains the snapshot as replacing entitlement and carry-over', () => {
		render(VacationBalanceCard, {
			balance: balance({ snapshotDate: '2026-10-01', snapshotRemainingHalfDays: 20, entitlementHalfDays: 0, carryOverHalfDays: 0, adjustmentHalfDays: 4, bookedHalfDays: 10, availableHalfDays: 14, availableAfterPlannedHalfDays: 9 })
		});
		// shows the server's snapshotRemainingHalfDays instead of deriving it from available/adjustments/booked
		expect(screen.getByTestId('balance-snapshot')).toHaveTextContent('10 Tage');
		expect(screen.getByText('Resturlaub zum Stichtag 01.10.2026')).toBeInTheDocument();
		expect(screen.queryByTestId('balance-entitlement')).toBeNull();
		expect(screen.getByText(/nicht zusätzlich addiert/)).toBeInTheDocument();
	});

	it('notes an expiring carry-over without deducting it', () => {
		render(VacationBalanceCard, { balance: balance(), settings: { region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverExpiry: '03-31' } });
		expect(screen.getByTestId('expiry-note')).toHaveTextContent('2,5 Tage');
		expect(screen.getByTestId('expiry-note')).toHaveTextContent('31.03.');
	});
});

describe('AbsenceForm', () => {
	it('creates a vacation with half-day flags and reports the counted result', async () => {
		const onsaved = vi.fn();
		render(AbsenceForm, { date: '2026-12-07', onsaved, oncancel: vi.fn() });
		await userEvent.clear(screen.getByLabelText('Bis'));
		await userEvent.type(screen.getByLabelText('Bis'), '2026-12-09');
		await userEvent.click(screen.getByLabelText('Letzter Tag nur halber Tag'));
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(onsaved.mock.calls[0][0]).toMatchObject({ kind: 'vacation', halfDayEnd: true, halfDayStart: false, status: 'planned', countedHalfDays: 5 });
		expect(screen.queryByText('Unterlagen')).toBeNull(); // documents only for sick/other
	});

	it('offers "Freigestellt" with its hint, no document fields and no vacation count', async () => {
		const onsaved = vi.fn();
		render(AbsenceForm, { date: '2026-12-07', onsaved, oncancel: vi.fn() });
		await userEvent.selectOptions(screen.getByLabelText('Art'), 'excused');
		expect(screen.getByTestId('absence-excused-hint')).toHaveTextContent('Bezahlt frei, verbraucht keinen Urlaub.');
		expect(screen.queryByText('Unterlagen')).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(onsaved.mock.calls[0][0]).toMatchObject({ kind: 'excused', countedHalfDays: 0, documentStatus: 'not_needed' });
	});

	it('shows document fields for sick leave', async () => {
		render(AbsenceForm, { date: '2026-12-07', onsaved: vi.fn(), oncancel: vi.fn() });
		await userEvent.selectOptions(screen.getByLabelText('Art'), 'sick');
		expect(screen.getByLabelText('Stand der Unterlagen')).toBeInTheDocument();
		expect(screen.getByLabelText('Eingereicht am')).toBeInTheDocument();
		expect(screen.getByLabelText('Bescheinigung gilt ab')).toBeInTheDocument();
	});

	it('translates the overlap conflict into German', async () => {
		render(AbsenceForm, { date: '2026-10-28', onsaved: vi.fn(), oncancel: vi.fn() }); // inside the seeded approved week
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByTestId('absence-error')).toHaveTextContent('Abwesenheiten dürfen sich nicht überschneiden');
	});

	it('validates the date order before calling the server', async () => {
		render(AbsenceForm, { date: '2026-12-07', onsaved: vi.fn(), oncancel: vi.fn() });
		await userEvent.clear(screen.getByLabelText('Bis'));
		await userEvent.type(screen.getByLabelText('Bis'), '2026-12-01');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Das Ende darf nicht vor dem Beginn liegen.')).toBeInTheDocument();
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/absences'))).toBe(false);
	});

	it('uses If-Match when editing and offers a reload on a stale version', async () => {
		const [approved] = await api.listAbsences('2026-10-26', '2026-10-30');
		await api.updateAbsence(approved.id, { ...approved, note: 'von woanders' }, approved.version);
		const onstale = vi.fn();
		render(AbsenceForm, { absence: approved, date: approved.startDate, onsaved: vi.fn(), oncancel: vi.fn(), onstale });
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		const alert = await screen.findByTestId('absence-stale');
		expect(alert).toHaveTextContent('wurde zwischenzeitlich geändert');
		await userEvent.click(within(alert).getByRole('button', { name: 'Aktuelle Fassung laden' }));
		expect(onstale).toHaveBeenCalled();
	});
});

describe('vacation page', () => {
	it('shows the balance for the current year with counted booked and planned days', async () => {
		render(VacationPage);
		expect(await screen.findByTestId('balance-available')).toHaveTextContent('22 Tage');
		expect(screen.getByTestId('balance-after-planned')).toHaveTextContent('19,5 Tage');
		expect(screen.getByTestId('vacation-year')).toHaveTextContent('2026');
		expect(screen.queryByTestId('settings-suggestion')).toBeNull();
	});

	it('offers the ADR-0005 defaults only as a suggestion and does not save them silently', async () => {
		vi.unstubAllGlobals();
		mock = createMockFetch({ now: () => NOW.getTime(), seedPlanning: false });
		vi.stubGlobal('fetch', mock.fetch);
		setCsrfToken(null);
		await signIn();
		render(VacationPage);
		expect(await screen.findByTestId('settings-missing')).toBeInTheDocument();
		expect(screen.getByTestId('settings-suggestion')).toHaveTextContent('30 Tage');
		expect(screen.getByLabelText('Jahresanspruch (Tage)')).toHaveValue('30');
		expect(screen.getByTestId('balance-entitlement')).toHaveTextContent('0 Tage');
		expect(mock.calls.some((c) => c.method === 'PUT' && c.path.includes('/vacation/settings'))).toBe(false);
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Einstellungen gespeichert.')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByTestId('balance-entitlement')).toHaveTextContent('30 Tage'));
	});

	it('rejects decimals that are not half days in the snapshot form', async () => {
		render(VacationPage);
		await screen.findByTestId('balance-available');
		await userEvent.type(screen.getByLabelText('Resturlaub (Tage)'), '12,3');
		await userEvent.click(screen.getByRole('button', { name: 'Stichtagsbestand speichern' }));
		expect(await screen.findByText(/ganze oder halbe Zahl/)).toBeInTheDocument();
	});

	it('records a snapshot and shows it as replacing history', async () => {
		render(VacationPage);
		await screen.findByTestId('balance-available');
		await userEvent.type(screen.getByLabelText('Resturlaub (Tage)'), '10');
		await userEvent.click(screen.getByRole('button', { name: 'Stichtagsbestand speichern' }));
		expect(await screen.findByText('Stichtagsbestand gespeichert.')).toBeInTheDocument();
		expect(await screen.findByTestId('balance-snapshot')).toHaveTextContent('10 Tage');
	});

	it('degrades to the German unavailable notice when the server has no vacation API', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/vacation/') ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }) : mock.fetch(input, init)
		);
		render(VacationPage);
		expect(await screen.findByTestId('planning-unavailable')).toHaveTextContent('noch nicht verfügbar');
	});
});

describe('calendar page', () => {
	it('shows holidays, the approved vacation and plan modes in the month grid', async () => {
		pageState.url = new URL('http://localhost/calendar?date=2026-10-14');
		render(CalendarPage);
		const grid = await screen.findByTestId('month-grid');
		expect(within(grid).getByText('Tag der Deutschen Einheit')).toBeInTheDocument(); // 03.10.
		expect(within(grid).getByText('Reformationstag')).toBeInTheDocument(); // 31.10.
		expect(within(grid).getAllByText('Urlaub').length).toBeGreaterThanOrEqual(5); // 26.-30.10.
		expect(within(grid).getAllByText('Homeoffice').length).toBeGreaterThan(0);
		expect(within(grid).getAllByText('Krank').length).toBeGreaterThan(0); // seeded sick leave 28.-29.09. in the first grid row
	});

	it('creates an absence from a day and refreshes the grid', async () => {
		pageState.url = new URL('http://localhost/calendar?date=2026-10-14');
		render(CalendarPage);
		const grid = await screen.findByTestId('month-grid');
		await userEvent.click(grid.querySelector('[data-date="2026-10-20"]') as HTMLElement);
		const panel = await screen.findByTestId('day-panel');
		await userEvent.click(within(panel).getByRole('button', { name: 'Abwesenheit anlegen' }));
		await userEvent.selectOptions(screen.getByLabelText('Art'), 'sick');
		await userEvent.selectOptions(screen.getByLabelText('Status'), 'taken');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Abwesenheit gespeichert.')).toBeInTheDocument();
		await waitFor(() => expect(within(screen.getByTestId('month-grid')).getAllByText('Krank').length).toBeGreaterThan(0));
	});

	it('saves a plan entry for a day', async () => {
		pageState.url = new URL('http://localhost/calendar?date=2026-10-14');
		render(CalendarPage);
		const grid = await screen.findByTestId('month-grid');
		await userEvent.click(grid.querySelector('[data-date="2026-10-27"]') as HTMLElement);
		await userEvent.click(within(await screen.findByTestId('day-panel')).getByRole('button', { name: 'Planung festlegen' }));
		await userEvent.selectOptions(screen.getByLabelText('Arbeitsform'), 'customer');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Planung gespeichert.')).toBeInTheDocument();
		expect(await api.listPlanDays('2026-10-27', '2026-10-27')).toMatchObject([{ mode: 'customer' }]);
	});

	it('degrades to the unavailable notice on 404', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/calendar/') ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }) : mock.fetch(input, init)
		);
		render(CalendarPage);
		expect(await screen.findByTestId('planning-unavailable')).toBeInTheDocument();
	});
});

describe('absences page', () => {
	it('lists the year, filters by status and shows counted days', async () => {
		render(AbsencesPage);
		const list = await screen.findByTestId('absence-list');
		expect(within(list).getAllByTestId('absence-row')).toHaveLength(4);
		expect(within(list).getByText('Zählt: 5 Tage')).toBeInTheDocument(); // approved 26.-30.10.
		expect(within(list).getByText(/Zählt: 2,5 Tage/)).toBeInTheDocument(); // planned with half day at the end
		await userEvent.selectOptions(screen.getByLabelText('Status'), 'Genehmigt');
		expect(screen.getAllByTestId('absence-row')).toHaveLength(1);
		await userEvent.selectOptions(screen.getByLabelText('Status'), 'Storniert');
		expect(screen.getByTestId('absences-empty')).toBeInTheDocument();
	});

	it('edits with If-Match and keeps counting once when approved becomes taken', async () => {
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		await userEvent.selectOptions(screen.getByLabelText('Status'), 'Genehmigt');
		await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
		await userEvent.selectOptions(screen.getByLabelText('Status', { selector: '#abs-status' }), 'taken');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Abwesenheit gespeichert.')).toBeInTheDocument();
		const put = mock.calls.find((c) => c.method === 'PUT' && c.path.includes('/absences/'));
		expect(put).toBeTruthy();
		expect((await api.getVacationBalance(2026)).bookedHalfDays).toBe(16);
	});

	it('degrades to the unavailable notice on 501', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/absences') ? new Response(JSON.stringify({ error: { code: 'not_implemented', message: 'x' } }), { status: 501 }) : mock.fetch(input, init)
		);
		render(AbsencesPage);
		expect(await screen.findByTestId('planning-unavailable')).toBeInTheDocument();
	});
});

describe('sharing settings', () => {
	it('starts with nothing shared, defaults all switches to off and requires one scope', async () => {
		render(SharingPage);
		expect(await screen.findByTestId('shares-empty')).toBeInTheDocument();
		expect(screen.getByTestId('never-shared')).toHaveTextContent('Notizen');
		for (const name of ['Planung', 'Tatsächliche Zeiten', 'Urlaub']) {
			expect(screen.getByRole('checkbox', { name: new RegExp(name) })).not.toBeChecked();
		}
		await userEvent.type(screen.getByLabelText('Kontoname der Person'), 'lena');
		await userEvent.click(screen.getByRole('button', { name: 'Freigabe anlegen' }));
		expect(await screen.findByTestId('share-error')).toHaveTextContent('mindestens einen Umfang');
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/shares'))).toBe(false);
	});

	it('creates, changes a scope and revokes in two steps', async () => {
		render(SharingPage);
		await screen.findByTestId('shares-empty');
		await userEvent.type(screen.getByLabelText('Kontoname der Person'), 'lena');
		await userEvent.click(screen.getByRole('checkbox', { name: /^Planung/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Freigabe anlegen' }));
		const row = await screen.findByTestId('share-row');
		expect(row).toHaveTextContent('lena');
		await userEvent.click(within(row).getByRole('checkbox', { name: 'Urlaub lena' }));
		await waitFor(() => expect(within(screen.getByTestId('share-row')).getByRole('checkbox', { name: 'Urlaub lena' })).toBeChecked());
		await userEvent.click(within(row).getByRole('button', { name: 'Widerrufen lena' }));
		expect(mock.calls.some((c) => c.method === 'DELETE' && c.path.includes('/shares/'))).toBe(false);
		await userEvent.click(within(row).getByRole('button', { name: 'Jetzt widerrufen lena' }));
		expect(await screen.findByTestId('shares-empty')).toBeInTheDocument();
		expect(screen.getByTestId('share-notice')).toHaveTextContent('widerrufen');
	});

	it('maps an unknown recipient to a German message', async () => {
		render(SharingPage);
		await screen.findByTestId('shares-empty');
		await userEvent.type(screen.getByLabelText('Kontoname der Person'), 'niemand');
		await userEvent.click(screen.getByRole('checkbox', { name: /^Urlaub/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Freigabe anlegen' }));
		expect(await screen.findByTestId('share-error')).toHaveTextContent('Dieses Konto wurde nicht gefunden');
	});
});

describe('shared view', () => {
	it('shows only the granted scopes and the never-shared note', async () => {
		render(SharedPage);
		const list = await screen.findByTestId('incoming-list');
		expect(list).toHaveTextContent('Lena Beispiel');
		await userEvent.click(within(list).getByRole('button', { name: /Lena Beispiel/ }));
		const view = await screen.findByTestId('shared-view');
		await waitFor(() => expect(within(view).getByTestId('shared-plan')).toBeInTheDocument());
		expect(within(view).getByTestId('shared-vacation')).toBeInTheDocument();
		expect(within(view).queryByTestId('shared-actual')).toBeNull();
		expect(screen.getByTestId('never-shared')).toHaveTextContent('Krankheits- und Freistellungstage');
	});

	it('shows the gone notice when the share was revoked meanwhile', async () => {
		render(SharedPage);
		const list = await screen.findByTestId('incoming-list');
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/view') ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }) : mock.fetch(input, init)
		);
		await userEvent.click(within(list).getByRole('button', { name: /Lena Beispiel/ }));
		expect(await screen.findByTestId('shared-error')).toHaveTextContent('widerrufen');
		expect(screen.queryByTestId('shared-view')).toBeNull();
	});

	it('degrades to the unavailable notice on 404', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/shares') ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }) : mock.fetch(input, init)
		);
		render(SharedPage);
		expect(await screen.findByTestId('planning-unavailable')).toBeInTheDocument();
	});
});

describe('contract v0.3.1 in the UI', () => {
	it('shows the not-yet-saved hint from configured=false without a 404 and prefills defaults', async () => {
		vi.unstubAllGlobals();
		mock = createMockFetch({ now: () => NOW.getTime(), seedPlanning: false });
		vi.stubGlobal('fetch', mock.fetch);
		setCsrfToken(null);
		await signIn();
		render(VacationPage);
		expect(await screen.findByTestId('settings-missing')).toHaveTextContent('noch nicht gespeichert');
		expect(mock.calls.filter((c) => c.path.includes('/vacation/settings')).length).toBe(1);
		expect(screen.getByLabelText('Jahresanspruch (Tage)')).toHaveValue('30');
	});

	it('edits only the carry-over of the selected year and keeps the others', async () => {
		await api.putVacationSettings({ region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: { '2025': 3, '2026': 5 } });
		render(VacationPage);
		const field = await screen.findByLabelText('Übertrag für 2026 (Tage)');
		expect(field).toHaveValue('2,5');
		await userEvent.clear(field);
		await userEvent.type(field, '4');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Einstellungen gespeichert.')).toBeInTheDocument();
		expect((await api.getVacationSettings()).carryOverByYear).toEqual({ '2025': 3, '2026': 8 });
		await userEvent.click(screen.getByRole('button', { name: 'Folgejahr' }));
		expect(await screen.findByLabelText('Übertrag für 2027 (Tage)')).toHaveValue('0');
	});

	it('lists snapshots and adjustments and deletes one only after confirmation', async () => {
		await api.createVacationAdjustment({ date: '2026-05-01', halfDays: 2, reason: 'Gutschrift Mai' });
		render(VacationPage);
		const entry = await screen.findByTestId('vacation-entry');
		expect(entry).toHaveTextContent('Korrektur 01.05.2026: +1 Tag');
		expect(entry).toHaveTextContent('Gutschrift Mai');
		await userEvent.click(within(entry).getByRole('button', { name: 'Löschen' }));
		expect(mock.calls.some((c) => c.method === 'DELETE' && c.path.includes('/vacation/entries/'))).toBe(false);
		await userEvent.click(within(entry).getByRole('button', { name: 'Abbrechen' }));
		await userEvent.click(within(screen.getByTestId('vacation-entry')).getByRole('button', { name: 'Löschen' }));
		await userEvent.click(screen.getByRole('button', { name: 'Jetzt löschen' }));
		expect(await screen.findByTestId('entries-empty')).toBeInTheDocument();
		expect((await api.getVacationBalance(2026)).adjustmentHalfDays).toBe(0);
	});

	it('reads the single absence after a 412 instead of reloading the list', async () => {
		const [approved] = await api.listAbsences('2026-10-26', '2026-10-30');
		const newer = await api.updateAbsence(approved.id, { ...approved, note: 'von woanders' }, approved.version);
		const onstale = vi.fn();
		render(AbsenceForm, { absence: approved, date: approved.startDate, onsaved: vi.fn(), oncancel: vi.fn(), onstale });
		mock.calls.length = 0;
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await userEvent.click(within(await screen.findByTestId('absence-stale')).getByRole('button', { name: 'Aktuelle Fassung laden' }));
		expect(onstale).toHaveBeenCalledWith(newer);
		expect(mock.calls.some((c) => c.method === 'GET' && c.path.endsWith(`/absences/${approved.id}`))).toBe(true);
		expect(mock.calls.some((c) => c.method === 'GET' && c.path.includes('/absences?'))).toBe(false);
	});

	it('keeps editing on the fresh version in the absences page', async () => {
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		await userEvent.selectOptions(screen.getByLabelText('Status'), 'Genehmigt');
		await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
		const [approved] = await api.listAbsences('2026-10-26', '2026-10-30');
		await api.updateAbsence(approved.id, { ...approved, note: 'von woanders' }, approved.version);
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Aktuelle Fassung laden' }));
		expect(await screen.findByLabelText('Notiz (optional)')).toHaveValue('von woanders');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Abwesenheit gespeichert.')).toBeInTheDocument();
	});

	it('shows no vacation use for sick absences', async () => {
		await api.createAbsence({ kind: 'sick', startDate: '2026-02-02', endDate: '2026-02-03', status: 'taken' });
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		await userEvent.selectOptions(screen.getByLabelText('Art'), 'Krank');
		expect(screen.getAllByTestId('absence-counted').some((e) => e.textContent?.includes('Verbraucht keinen Urlaub'))).toBe(true);
	});

	it('maps a duplicate share and a share to oneself to German messages', async () => {
		render(SharingPage);
		await screen.findByTestId('shares-empty');
		await userEvent.type(screen.getByLabelText('Kontoname der Person'), 'admin');
		await userEvent.click(screen.getByRole('checkbox', { name: /^Urlaub/ }));
		await userEvent.click(screen.getByRole('button', { name: 'Freigabe anlegen' }));
		expect(await screen.findByText('Du kannst nichts an dein eigenes Konto freigeben.')).toBeInTheDocument();
		await api.createShare({ recipientHandle: 'lena', scopes: { plan: true } });
		await userEvent.clear(screen.getByLabelText('Kontoname der Person'));
		await userEvent.type(screen.getByLabelText('Kontoname der Person'), 'lena');
		await userEvent.click(screen.getByRole('button', { name: 'Freigabe anlegen' }));
		expect(await screen.findByTestId('share-error')).toHaveTextContent('bereits eine Freigabe');
	});

	it('shows only approved or taken vacation of the sharer for a long range', async () => {
		render(SharedPage);
		await userEvent.click(await screen.findByRole('button', { name: /Lena Beispiel/ }));
		const list = await screen.findByTestId('shared-vacation');
		expect(within(list).getAllByRole('listitem')).toHaveLength(1); // approved 26.-30.10.; the planned week is not listed
	});
});
