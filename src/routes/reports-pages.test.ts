import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import EntryForm from '#lib/components/reports/EntryForm.svelte';
import ReportsTeaser from '#lib/components/reports/ReportsTeaser.svelte';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/reports'), params: {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: pageState }));

import ReportsPage from './(app)/reports/+page.svelte';
import LearningFieldsPage from './(app)/settings/learning-fields/+page.svelte';

// Wednesday of ISO week 42/2026
const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;
const user = () => userEvent.setup({ applyAccept: false });

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
	pageState.url = new URL('http://localhost/reports');
	await signIn();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const day = (date: string) => document.querySelector(`[data-testid="day"][data-date="${date}"]`) as HTMLElement;

async function openReports() {
	render(ReportsPage);
	await screen.findByTestId('week-heading');
	await screen.findByTestId('week-total');
}

async function addEntry(u: ReturnType<typeof user>, date: string, field: string, duration: string, notes = '') {
	await u.click(within(day(date)).getByTestId('add-entry'));
	const form = within(day(date)).getByTestId('entry-form');
	const fieldInput = within(form).getByTestId('entry-field');
	await u.clear(fieldInput);
	await u.type(fieldInput, field);
	if (duration) await u.type(within(form).getByTestId('entry-duration'), duration);
	if (notes) await u.type(within(form).getByTestId('entry-notes'), notes);
	await u.click(within(form).getByTestId('entry-save'));
	await waitFor(() => expect(within(day(date)).queryByTestId('entry-form')).toBeNull());
}

describe('reports page', () => {
	it('shows the current ISO week with seven days and an empty state', async () => {
		await openReports();
		expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 42/2026');
		expect(screen.getByTestId('week-range')).toHaveTextContent('12.10.2026 bis 18.10.2026');
		expect(screen.getAllByTestId('day')).toHaveLength(7);
		expect(screen.getByTestId('week-total')).toHaveTextContent('0:00 h');
		expect(screen.getByTestId('copy-text')).toBeDisabled();
		expect(screen.getByTestId('tracked-hint')).toHaveTextContent(/Arbeitszeit laut Zeiterfassung: \d+:\d\d h/);
	});

	it('adds entries via quick-add, groups them by day and sums per learning field', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:30', 'Subnetze');
		await addEntry(u, '2026-10-13', 'Betrieb', '0:45');
		await addEntry(u, '2026-10-14', 'Netzwerke', '1,5');
		const tuesday = within(day('2026-10-13'));
		expect(tuesday.getAllByTestId('entry')).toHaveLength(2);
		expect(tuesday.getAllByTestId('entry-duration-shown')[0]).toHaveTextContent('1:30 h');
		expect(tuesday.getByText('Subnetze')).toBeInTheDocument();
		expect(screen.getByTestId('week-total')).toHaveTextContent('3:45 h');
		const rows = screen.getAllByTestId('by-field-row').map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
		expect(rows).toEqual(['Netzwerke 3:00 h', 'Betrieb 0:45 h']);
		expect(screen.getByTestId('toast')).toHaveTextContent('Eintrag gespeichert.');
	});

	it('shows the parsed duration live and warns about decimal hours', async () => {
		const u = user();
		await openReports();
		await u.click(within(day('2026-10-12')).getByTestId('add-entry'));
		const input = screen.getByTestId('entry-duration');
		const parsed = screen.getByTestId('entry-duration-parsed');
		await u.type(input, '7,7');
		expect(parsed).toHaveTextContent('Gelesen als 7:42 h');
		expect(parsed).toHaveTextContent('nicht 7:07');
		await u.clear(input);
		await u.type(input, '1:30');
		expect(parsed).toHaveTextContent(/^Gelesen als 1:30 h$/);
		await u.clear(input);
		await u.type(input, 'abc');
		expect(parsed).toHaveTextContent('Bitte eine Zeit wie 1:30 oder 1,5 eingeben');
		expect(input).toHaveAttribute('aria-invalid', 'true');
	});

	it('validates the form before sending anything', async () => {
		const u = user();
		await openReports();
		const before = mock.calls.filter((c) => c.method === 'POST').length;
		await u.click(within(day('2026-10-12')).getByTestId('add-entry'));
		await u.click(screen.getByTestId('entry-save'));
		expect(await screen.findByText('Bitte ein Lernfeld angeben.')).toBeInTheDocument();
		expect(mock.calls.filter((c) => c.method === 'POST').length).toBe(before);
	});

	it('offers the learning field list as suggestions and links a picked field by id', async () => {
		const field = await api.createLearningField({ number: 4, name: 'Netzwerke' });
		const u = user();
		await openReports();
		await u.click(within(day('2026-10-12')).getByTestId('add-entry'));
		const list = document.querySelector(`#${CSS.escape(screen.getByTestId('entry-field').getAttribute('list')!)}`) as HTMLDataListElement;
		expect([...list.options].map((o) => o.value)).toEqual(['Netzwerke']);
		await u.type(screen.getByTestId('entry-field'), 'netzwerke');
		await u.click(screen.getByTestId('entry-save'));
		await waitFor(() => expect(within(day('2026-10-12')).getAllByTestId('entry')).toHaveLength(1));
		const saved = (await api.getReportWeek(2026, 42)).entries[0];
		expect(saved).toMatchObject({ learningField: 'Netzwerke', learningFieldId: field.id });
	});

	it('keeps free text when the name is not in the list', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-12', 'Eigenes Thema', '1');
		expect(within(day('2026-10-12')).getByTestId('entry-learning-field')).toHaveTextContent('Eigenes Thema');
	});

	it('edits an entry and moves it to another day of the week', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:00');
		await u.click(within(day('2026-10-13')).getByRole('button', { name: 'Eintrag „Netzwerke“ bearbeiten' }));
		const form = within(day('2026-10-13')).getByTestId('entry-form');
		expect(within(form).getByTestId('entry-duration')).toHaveValue('1:00');
		await u.selectOptions(within(form).getByLabelText('Datum'), '2026-10-15');
		await u.clear(within(form).getByTestId('entry-duration'));
		await u.type(within(form).getByTestId('entry-duration'), '2');
		await u.click(within(form).getByTestId('entry-save'));
		await waitFor(() => expect(within(day('2026-10-15')).getAllByTestId('entry')).toHaveLength(1));
		expect(within(day('2026-10-15')).getByTestId('entry-duration-shown')).toHaveTextContent('2:00 h');
		expect(within(day('2026-10-13')).queryAllByTestId('entry')).toHaveLength(0);
	});

	it('handles 412: shows the conflict, loads the current version, or saves the own input on top', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:00', 'alt');
		const [current] = (await api.getReportWeek(2026, 42)).entries;
		// another device changes the entry
		await api.updateReportEntry(current.id, { date: current.date, learningField: 'Netzwerke', durationSeconds: 5400, notes: 'von woanders' }, current.version);

		await u.click(within(day('2026-10-13')).getByRole('button', { name: 'Eintrag „Netzwerke“ bearbeiten' }));
		let form = within(day('2026-10-13')).getByTestId('entry-form');
		await u.clear(within(form).getByTestId('entry-notes'));
		await u.type(within(form).getByTestId('entry-notes'), 'meine Notiz');
		await u.click(within(form).getByTestId('entry-save'));
		const stale = await within(form).findByTestId('entry-stale');
		expect(stale).toHaveTextContent('Der Eintrag wurde zwischenzeitlich geändert.');
		expect(within(form).getByTestId('entry-stale-current')).toHaveTextContent('Netzwerke, 1:30 h');
		expect(within(form).getByTestId('entry-save')).toBeDisabled();

		// load the current version: own input is replaced
		await u.click(within(form).getByRole('button', { name: 'Aktuelle Fassung laden' }));
		expect(within(form).getByTestId('entry-notes')).toHaveValue('von woanders');
		expect(within(form).getByTestId('entry-duration')).toHaveValue('1:30');

		// a second conflict, this time keep my input
		await api.updateReportEntry(current.id, { date: current.date, learningField: 'Netzwerke', durationSeconds: 7200, notes: 'nochmal woanders' }, current.version + 1);
		await u.clear(within(form).getByTestId('entry-notes'));
		await u.type(within(form).getByTestId('entry-notes'), 'gewinnt');
		await u.click(within(form).getByTestId('entry-save'));
		form = within(day('2026-10-13')).getByTestId('entry-form');
		await u.click(await within(form).findByRole('button', { name: 'Meine Eingabe trotzdem speichern' }));
		await waitFor(() => expect(within(day('2026-10-13')).queryByTestId('entry-form')).toBeNull());
		expect(within(day('2026-10-13')).getByText('gewinnt')).toBeInTheDocument();
	});

	it('reports a deleted entry when saving after someone else removed it', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:00');
		const [current] = (await api.getReportWeek(2026, 42)).entries;
		await u.click(within(day('2026-10-13')).getByRole('button', { name: 'Eintrag „Netzwerke“ bearbeiten' }));
		await api.deleteReportEntry(current.id);
		await u.click(screen.getByTestId('entry-save'));
		expect(await screen.findByTestId('entry-error')).toHaveTextContent(/Nicht gefunden|gelöscht/);
	});

	it('asks before deleting an entry', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:00');
		await u.click(within(day('2026-10-13')).getByRole('button', { name: 'Eintrag „Netzwerke“ löschen' }));
		expect(screen.getByTestId('entry-delete-confirm')).toHaveTextContent('Eintrag „Netzwerke“ vom 13.10.2026 wirklich löschen?');
		await u.click(within(screen.getByTestId('entry-delete-confirm')).getByRole('button', { name: 'Abbrechen' }));
		expect(within(day('2026-10-13')).getAllByTestId('entry')).toHaveLength(1);
		await u.click(within(day('2026-10-13')).getByRole('button', { name: 'Eintrag „Netzwerke“ löschen' }));
		await u.click(screen.getByTestId('entry-delete-yes'));
		await waitFor(() => expect(within(day('2026-10-13')).queryAllByTestId('entry')).toHaveLength(0));
		expect(screen.getByTestId('week-total')).toHaveTextContent('0:00 h');
	});

	it('toggles the week status between Entwurf and Erledigt without locking edits', async () => {
		const u = user();
		await openReports();
		expect(screen.getByTestId('status-draft')).toHaveAttribute('aria-pressed', 'true');
		await u.click(screen.getByTestId('status-done'));
		await waitFor(() => expect(screen.getByTestId('status-done')).toHaveAttribute('aria-pressed', 'true'));
		expect(screen.getByTestId('week-status-badge')).toHaveTextContent('Erledigt');
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:00');
		expect(screen.getByTestId('status-done')).toHaveAttribute('aria-pressed', 'true');
		await u.click(screen.getByTestId('status-draft'));
		await waitFor(() => expect(screen.getByTestId('week-status-badge')).toHaveTextContent('Entwurf'));
	});

	it('navigates weeks, crosses into week 53 and refuses weeks that do not exist', async () => {
		const u = user();
		await openReports();
		await u.click(screen.getByTestId('week-prev'));
		await waitFor(() => expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 41/2026'));
		await u.click(screen.getByTestId('week-next'));
		await u.click(screen.getByTestId('week-next'));
		await waitFor(() => expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 43/2026'));
		await u.click(screen.getByTestId('week-today'));
		await waitFor(() => expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 42/2026'));
		expect(screen.getByTestId('week-today')).toBeDisabled();

		await u.clear(screen.getByTestId('week-year'));
		await u.type(screen.getByTestId('week-year'), '2026');
		await u.clear(screen.getByTestId('week-number'));
		await u.type(screen.getByTestId('week-number'), '53{Enter}');
		await waitFor(() => expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 53/2026'));
		expect(screen.getByTestId('week-range')).toHaveTextContent('28.12.2026 bis 03.01.2027');
		await u.click(screen.getByTestId('week-next'));
		await waitFor(() => expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 1/2027'));

		await u.clear(screen.getByTestId('week-year'));
		await u.type(screen.getByTestId('week-year'), '2027');
		await u.clear(screen.getByTestId('week-number'));
		await u.type(screen.getByTestId('week-number'), '53{Enter}');
		expect(await screen.findByTestId('week-nav-error')).toHaveTextContent('Dieses Jahr hat nur 52 Kalenderwochen.');
		expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 1/2027');
	});

	it('opens the week from the URL parameters', async () => {
		pageState.url = new URL('http://localhost/reports?year=2026&week=53');
		await openReports();
		expect(screen.getByTestId('week-heading')).toHaveTextContent('KW 53/2026');
	});

	it('copies the text output to the clipboard and confirms with a toast', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:30', 'Subnetze');
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await u.click(screen.getByTestId('copy-text'));
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(writeText.mock.calls[0][0]).toBe('Berichtsheft KW 42/2026 (12.10.2026 – 18.10.2026)\n\nDienstag, 13.10.2026\nNetzwerke | 1:30 h | Subnetze\n\nSumme: 1:30 h\n');
		await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('In die Zwischenablage kopiert'));
	});

	it('falls back to a selected textarea in a dialog when the clipboard is not available', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:30');
		Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
		await u.click(screen.getByTestId('copy-text'));
		const dialog = await screen.findByTestId('text-dialog');
		expect(within(dialog).getByTestId('copy-fallback')).toHaveTextContent('Strg+C');
		expect((within(dialog).getByTestId('text-preview') as HTMLTextAreaElement).value).toContain('Netzwerke | 1:30 h');
		expect(screen.queryByText('In die Zwischenablage kopiert')).toBeNull();
	});

	it('previews the text without copying', async () => {
		const u = user();
		await openReports();
		await addEntry(u, '2026-10-13', 'Netzwerke', '1:30');
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await u.click(screen.getByTestId('copy-preview'));
		const dialog = await screen.findByTestId('text-dialog');
		expect((within(dialog).getByTestId('text-preview') as HTMLTextAreaElement).value).toContain('Summe: 1:30 h');
		expect(writeText).not.toHaveBeenCalled();
		await u.click(within(dialog).getByTestId('text-copy-again'));
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('In die Zwischenablage kopiert'));
	});

	it('manages sources: text notes and files, with download link and removal', async () => {
		const u = user();
		await openReports();
		const panel = within(screen.getByTestId('sources'));
		expect(await panel.findByText('Noch keine Quellen.')).toBeInTheDocument();
		await u.type(panel.getByTestId('source-note'), 'Stichpunkte zur Woche');
		await u.selectOptions(panel.getByTestId('source-day'), '2026-10-14');
		await u.click(panel.getByTestId('source-note-add'));
		await waitFor(() => expect(panel.getAllByTestId('source')).toHaveLength(1));
		expect(panel.getByText('Stichpunkte zur Woche')).toBeInTheDocument();

		await u.upload(panel.getByTestId('source-file'), new File(['hallo'], 'skript.txt', { type: 'text/plain' }));
		await u.click(panel.getByTestId('source-upload'));
		await waitFor(() => expect(panel.getAllByTestId('source')).toHaveLength(2));
		expect(panel.getByRole('button', { name: 'Datei „skript.txt“ herunterladen' })).toBeInTheDocument();

		await u.upload(panel.getByTestId('source-file'), new File(['x'], 'virus.exe'));
		expect(await panel.findByTestId('sources-error')).toHaveTextContent('Dieser Dateityp ist nicht erlaubt');

		await u.click(panel.getByRole('button', { name: 'Quelle „skript.txt“ entfernen' }));
		await waitFor(() => expect(panel.getAllByTestId('source')).toHaveLength(1));
		expect(mock.calls.some((c) => c.method === 'DELETE' && c.path.includes('/files/'))).toBe(true);
	});

	it('shows a neutral notice while the server does not know the Berichtsheft', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/reports/') ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }) : mock.fetch(input, init)
		);
		render(ReportsPage);
		expect(await screen.findByTestId('reports-unavailable')).toHaveTextContent('noch nicht verfügbar');
	});
});

describe('EntryForm', () => {
	it('pre-fills quick-add with the given learning field', async () => {
		render(EntryForm, { date: '2026-10-12', dates: [], fields: [], defaultField: 'Netzwerke', onsaved: vi.fn(), oncancel: vi.fn(), onreload: async () => null });
		expect(screen.getByTestId('entry-field')).toHaveValue('Netzwerke');
	});
});

describe('learning fields page', () => {
	it('creates, edits, sorts and deletes with confirmation and explains old entries', async () => {
		const u = user();
		render(LearningFieldsPage);
		expect(await screen.findByTestId('learning-note')).toHaveTextContent('behalten den Namen');
		expect(screen.getByText(/Noch keine Lernfelder/)).toBeInTheDocument();

		await u.click(screen.getByTestId('learning-add'));
		await u.click(screen.getByTestId('learning-save'));
		expect(await screen.findByText(/Bitte einen Namen eingeben/)).toBeInTheDocument();
		await u.type(screen.getByTestId('learning-name'), 'Netzwerke');
		await u.type(screen.getByTestId('learning-number'), '4');
		await u.click(screen.getByTestId('learning-save'));
		await waitFor(() => expect(screen.getAllByTestId('learning-field')).toHaveLength(1));
		expect(screen.getByTestId('learning-field')).toHaveTextContent('4 · Netzwerke');

		await u.click(screen.getByTestId('learning-add'));
		await u.type(screen.getByTestId('learning-name'), 'Betrieb');
		const sort = screen.getByTestId('learning-sort');
		await u.clear(sort);
		await u.type(sort, '-1');
		await u.click(screen.getByTestId('learning-save'));
		await waitFor(() => expect(screen.getAllByTestId('learning-field')).toHaveLength(2));
		expect(screen.getAllByTestId('learning-field')[0]).toHaveTextContent('Betrieb');

		await u.click(screen.getByRole('button', { name: 'Lernfeld „Betrieb“ bearbeiten' }));
		await u.clear(screen.getByTestId('learning-name'));
		await u.type(screen.getByTestId('learning-name'), 'Betrieb 2');
		await u.click(screen.getByTestId('learning-save'));
		await waitFor(() => expect(screen.getByText('Betrieb 2')).toBeInTheDocument());

		await u.click(screen.getByTestId('learning-add'));
		await u.type(screen.getByTestId('learning-name'), 'netzwerke');
		await u.click(screen.getByTestId('learning-save'));
		expect(await screen.findByTestId('learning-form-error')).toHaveTextContent('gibt es schon');
		await u.click(screen.getByRole('button', { name: 'Abbrechen' }));

		await u.click(screen.getByRole('button', { name: 'Lernfeld „Netzwerke“ löschen' }));
		expect(screen.getByTestId('learning-delete-confirm')).toHaveTextContent('Bestehende Einträge behalten den Namen');
		await u.click(screen.getByTestId('learning-delete-yes'));
		await waitFor(() => expect(screen.getAllByTestId('learning-field')).toHaveLength(1));
		expect(screen.getByTestId('learning-notice')).toHaveTextContent('Lernfeld gelöscht.');
	});

	it('validates number and sort order', async () => {
		const u = user();
		render(LearningFieldsPage);
		await u.click(await screen.findByTestId('learning-add'));
		await u.type(screen.getByTestId('learning-name'), 'X');
		await u.type(screen.getByTestId('learning-number'), 'abc');
		await u.click(screen.getByTestId('learning-save'));
		expect(await screen.findByText(/ganze Zahl ab 0/)).toBeInTheDocument();
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/learning-fields'))).toBe(false);
	});
});

describe('dashboard teaser', () => {
	it('shows the entry count of the current week and links to the Berichtsheft', async () => {
		render(ReportsTeaser);
		expect(await screen.findByTestId('reports-teaser-count')).toHaveTextContent('Noch keine Einträge in dieser Woche.');
		await api.createReportEntry({ date: '2026-10-13', learningField: 'A' });
		await api.createReportEntry({ date: '2026-10-14', learningField: 'B' });
		const { unmount } = render(ReportsTeaser);
		await waitFor(() => expect(screen.getAllByTestId('reports-teaser-count').at(-1)).toHaveTextContent('2 Einträge in dieser Woche'));
		expect(screen.getAllByRole('link', { name: 'Berichtsheft öffnen' }).at(-1)).toHaveAttribute('href', '/reports?year=2026&week=42');
		unmount();
	});

	it('stays hidden when the server has no Berichtsheft yet', async () => {
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			String(input).includes('/reports/') ? new Response(null, { status: 404 }) : mock.fetch(input, init)
		);
		render(ReportsTeaser);
		await new Promise((r) => setTimeout(r, 20));
		expect(screen.queryByTestId('reports-teaser')).toBeNull();
	});
});
