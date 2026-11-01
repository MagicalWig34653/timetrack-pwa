import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { samplePdf, samplePng } from '../../mock/sample-files.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import AbsenceAttachments from '#lib/components/transfer/AbsenceAttachments.svelte';
import { ABSENCE_FILTER_STORAGE_KEY } from '#lib/planning/absence-list.js';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/absences'), params: {} as Record<string, string> }));
const gotoMock = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/state', () => ({ page: pageState }));

import AbsencesPage from './(app)/absences/+page.svelte';
import CalendarPage from './(app)/calendar/+page.svelte';

// Wednesday 14.10.2026. Demo absences: vacation taken 07.-09.09., sick 28.-29.09. ("Erkältung"), vacation approved 26.-30.10., vacation planned 23.-25.11.
const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

const bytes = (data: Uint8Array) => new Uint8Array(data);
const file = (data: Uint8Array | string, name: string, type: string) => new File([typeof data === 'string' ? data : (bytes(data) as BlobPart)], name, { type });

beforeEach(async () => {
	localStorage.clear();
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	mock = createMockFetch({ now: () => NOW.getTime() });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	pageState.url = new URL('http://localhost/absences');
	gotoMock.mockClear();
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => {
	Reflect.deleteProperty(navigator, 'pdfViewerEnabled');
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const rows = () => screen.getAllByTestId('absence-row');
const firstDates = () => rows().map((r) => r.querySelector('.tabular-nums')?.textContent?.trim());

describe('absences list: sort and filter', () => {
	it('shows counts, sorts by date and kind and keeps ties stable', async () => {
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		expect(screen.getByTestId('absences-count')).toHaveTextContent('4 von 4 Abwesenheiten');
		expect(firstDates()[0]).toContain('07.09.2026');
		await userEvent.selectOptions(screen.getByLabelText('Sortierung'), 'date_desc');
		expect(firstDates()[0]).toContain('23.11.2026');
		await userEvent.selectOptions(screen.getByLabelText('Sortierung'), 'kind');
		expect(rows().at(-1)).toHaveTextContent('Krank');
	});

	it('filters by note text, mirrors it in the URL, remembers it and resets', async () => {
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		await userEvent.type(screen.getByLabelText('Suche in der Notiz'), 'erkält');
		// the list follows after a short pause (debounce); the URL is replaced without resetting focus and scroll (reset: false)
		expect(rows()).toHaveLength(4);
		await waitFor(() => expect(rows()).toHaveLength(1));
		expect(screen.getByTestId('absences-count')).toHaveTextContent('1 von 4 Abwesenheiten');
		await waitFor(() => expect(gotoMock).toHaveBeenLastCalledWith('/absences?q=erk%C3%A4lt', { replace: true, reset: false }));
		expect(gotoMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(localStorage.getItem(ABSENCE_FILTER_STORAGE_KEY) ?? '{}').q).toBe('erkält');
		await userEvent.click(screen.getByTestId('absences-reset'));
		expect(rows()).toHaveLength(4);
		expect(localStorage.getItem(ABSENCE_FILTER_STORAGE_KEY)).toBeNull();
	});

	it('shows an empty state with a reset button when nothing matches', async () => {
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		await userEvent.type(screen.getByLabelText('Suche in der Notiz'), 'gibt es nicht');
		const empty = await screen.findByTestId('absences-empty');
		expect(empty).toHaveTextContent('Keine Abwesenheiten für diese Auswahl.');
		await userEvent.click(within(empty).getByRole('button', { name: 'Filter zurücksetzen' }));
		expect(rows()).toHaveLength(4);
	});

	it('counts per status and kind and filters by a date range overlap', async () => {
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		expect(within(screen.getByLabelText('Art')).getByRole('option', { name: 'Urlaub (3)' })).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText('Von (Datum)'), '2026-10-30');
		expect(rows()).toHaveLength(2); // approved ending 30.10. and planned in November
		expect(within(screen.getByLabelText('Art')).getByRole('option', { name: 'Krank (0)' })).toBeInTheDocument();
	});

	it('takes initial filters from the URL before the remembered ones', async () => {
		localStorage.setItem(ABSENCE_FILTER_STORAGE_KEY, JSON.stringify({ kind: 'vacation' }));
		pageState.url = new URL('http://localhost/absences?kind=sick&sort=date_desc');
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		expect(rows()).toHaveLength(1);
		expect(screen.getByLabelText('Art')).toHaveValue('sick');
	});

	it('restores the remembered filters and survives blocked storage', async () => {
		localStorage.setItem(ABSENCE_FILTER_STORAGE_KEY, JSON.stringify({ status: 'approved' }));
		const view = render(AbsencesPage);
		await screen.findByTestId('absence-list');
		expect(rows()).toHaveLength(1);
		view.unmount();
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		expect(rows()).toHaveLength(4);
	});

	it('filters by attachment once the counts are known and opens the attachments of a row', async () => {
		const sick = (await api.listAbsences('2026-01-01', '2026-12-31')).find((a) => a.kind === 'sick')!;
		const meta = await api.uploadFile(file(samplePdf('Test'), 'attest.pdf', 'application/pdf'));
		await api.attachFile(sick.id, meta.id);
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Anhänge (1)' })).toBeInTheDocument());
		await userEvent.selectOptions(screen.getByLabelText('Anhang'), 'with');
		expect(rows()).toHaveLength(1);
		await userEvent.click(screen.getByRole('button', { name: 'Anhänge (1)' }));
		expect(await screen.findByText('attest.pdf')).toBeInTheDocument();
		await userEvent.selectOptions(screen.getByLabelText('Anhang'), 'without');
		expect(rows()).toHaveLength(3);
	});

	async function attachToSick() {
		const sick = (await api.listAbsences('2026-01-01', '2026-12-31')).find((a) => a.kind === 'sick')!;
		const meta = await api.uploadFile(file(samplePdf('Test'), 'attest.pdf', 'application/pdf'));
		await api.attachFile(sick.id, meta.id);
	}

	it('takes the counts from the list without per-absence attachment requests (contract 0.24.0)', async () => {
		await attachToSick();
		const urls: string[] = [];
		vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
			urls.push(String(input instanceof Request ? input.url : input));
			return mock.fetch(input as string, init);
		});
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		expect(await screen.findByRole('button', { name: 'Anhänge (1)' })).toBeInTheDocument();
		expect(screen.getAllByRole('button', { name: 'Anhänge (0)' })).toHaveLength(3);
		await userEvent.selectOptions(screen.getByLabelText('Anhang'), 'without');
		expect(rows()).toHaveLength(3);
		expect(urls.filter((u) => /\/absences\/[^/?]+\/attachments/.test(u))).toEqual([]);
	});

	it('falls back to counting per absence when the server sends no attachmentCount (older server)', async () => {
		await attachToSick();
		const urls: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			urls.push(url);
			const response = await mock.fetch(input as string, init);
			if (!/\/absences\?/.test(url)) return response;
			const list = (await response.json()) as Record<string, unknown>[];
			return new Response(JSON.stringify(list.map(({ attachmentCount: _omit, ...rest }) => rest)), { status: response.status, headers: { 'Content-Type': 'application/json' } });
		});
		render(AbsencesPage);
		await screen.findByTestId('absence-list');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Anhänge (1)' })).toBeInTheDocument());
		await userEvent.selectOptions(screen.getByLabelText('Anhang'), 'with');
		expect(rows()).toHaveLength(1);
		expect(urls.filter((u) => /\/absences\/[^/?]+\/attachments/.test(u))).toHaveLength(4);
	});
});

describe('attachment preview', () => {
	let created: Blob[];
	beforeEach(() => {
		created = [];
		vi.stubGlobal('URL', Object.assign(URL, {
			createObjectURL: (blob: Blob) => {
				created.push(blob);
				return `blob:test/${created.length}`;
			},
			revokeObjectURL: vi.fn()
		}));
	});

	async function attach(name: string, data: Uint8Array | string, type: string) {
		const sick = (await api.listAbsences('2026-01-01', '2026-12-31')).find((a) => a.kind === 'sick')!;
		const meta = await api.uploadFile(file(data, name, type));
		await api.attachFile(sick.id, meta.id);
		return sick.id;
	}

	it('lists name, type and size and previews a PNG inline', async () => {
		const id = await attach('scan.png', samplePng(), 'image/png');
		render(AbsenceAttachments, { absenceId: id });
		const item = await screen.findByTestId('attachment');
		expect(item).toHaveTextContent('scan.png');
		expect(item).toHaveTextContent('PNG');
		await userEvent.click(screen.getByRole('button', { name: 'scan.png ansehen' }));
		const image = await screen.findByTestId('preview-image');
		expect(image).toHaveAttribute('src', 'blob:test/1');
		expect(created[0].type).toBe('image/png');
		expect(screen.getByTestId('preview-title')).toHaveTextContent('scan.png');
	});

	it('shows a PDF in a frame titled with the file name and offers a new tab', async () => {
		const id = await attach('attest.pdf', samplePdf('Hallo'), 'application/pdf');
		render(AbsenceAttachments, { absenceId: id });
		await userEvent.click(await screen.findByRole('button', { name: 'attest.pdf ansehen' }));
		const frame = await screen.findByTestId('preview-pdf');
		expect(frame).toHaveAttribute('title', 'Vorschau von attest.pdf');
		expect(created[0].type).toBe('application/pdf');
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		await userEvent.click(screen.getByTestId('preview-new-tab'));
		expect(open).toHaveBeenCalledWith('blob:test/1', '_blank', 'noopener');
	});

	it('explains instead of showing an empty frame when the browser has no PDF viewer', async () => {
		const id = await attach('attest.pdf', samplePdf('Hallo'), 'application/pdf');
		Object.defineProperty(navigator, 'pdfViewerEnabled', { value: false, configurable: true });
		render(AbsenceAttachments, { absenceId: id });
		await userEvent.click(await screen.findByRole('button', { name: 'attest.pdf ansehen' }));
		expect(await screen.findByTestId('preview-unsupported')).toHaveTextContent('PDFs nicht selbst anzeigen');
		expect(screen.queryByTestId('preview-pdf')).not.toBeInTheDocument();
		expect(screen.getByTestId('preview-download')).toBeEnabled();
	});

	it('renders plain text and offers only the download for HEIC', async () => {
		const id = await attach('notiz.txt', 'Hallo Arzt', 'text/plain');
		const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0, 0]);
		const sickId = id;
		const meta = await api.uploadFile(file(heic, 'foto.heic', 'image/heic'));
		await api.attachFile(sickId, meta.id);
		render(AbsenceAttachments, { absenceId: id });
		await userEvent.click(await screen.findByRole('button', { name: 'notiz.txt ansehen' }));
		expect(await screen.findByTestId('preview-text')).toHaveTextContent('Hallo Arzt');
		await userEvent.click(screen.getByTestId('preview-close'));
		expect(screen.queryByRole('button', { name: 'foto.heic ansehen' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'foto.heic herunterladen' })).toBeInTheDocument();
	});

	it('shows an error in the dialog when the download fails', async () => {
		const id = await attach('attest.pdf', samplePdf('Hallo'), 'application/pdf');
		render(AbsenceAttachments, { absenceId: id });
		const button = await screen.findByRole('button', { name: 'attest.pdf ansehen' });
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			init?.method === 'GET' && String(input).match(/\/files\//) ? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }) : mock.fetch(input, init)
		);
		await userEvent.click(button);
		expect(await screen.findByTestId('preview-error')).toBeInTheDocument();
	});
});

describe('calendar tile backgrounds', () => {
	it('colours tiles by working day, free day and absence and shows a legend', async () => {
		pageState.url = new URL('http://localhost/calendar?date=2026-10-14');
		render(CalendarPage);
		const grid = await screen.findByTestId('month-grid');
		const state = (date: string) => grid.querySelector(`[data-date="${date}"]`)?.getAttribute('data-work-state');
		await waitFor(() => expect(state('2026-10-14')).toBe('work')); // Wednesday
		expect(state('2026-10-17')).toBe('free'); // Saturday
		expect(state('2026-10-03')).toBe('free'); // Saturday and holiday
		expect(state('2026-10-27')).toBe('vacation_booked');
		expect(state('2026-09-28')).toBe('sick');
		expect(grid.querySelector('[data-date="2026-10-27"]')).toHaveAccessibleName(/Urlaub genehmigt/);
		const legend = screen.getByTestId('tile-legend');
		expect(within(legend).getAllByRole('listitem')).toHaveLength(6);
	});
});
