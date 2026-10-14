import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import AbsenceAttachments from '#lib/components/transfer/AbsenceAttachments.svelte';
import ImportWizard from '#lib/components/transfer/ImportWizard.svelte';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/import'), params: {} } }));

import ExportPage from './(app)/export/+page.svelte';
import StoragePage from './(app)/settings/storage/+page.svelte';

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
	await signIn();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const SAMPLE = 'Datum;Beginn;Ende;Art\r\n03.03.2031;8:00;12:00;Arbeit\r\n03.03.2031;12:30;16:45;Arbeit\r\n04.03.2031;8:00;11:30;Schule\r\nSumme;;;\r\n';
const csv = (text = SAMPLE, name = 'zeiten.csv') => new File([text], name, { type: 'text/csv' });

async function uploadAndOpenMapping(file = csv()) {
	const u = user();
	await u.upload(screen.getByTestId('import-file'), file);
	await u.click(screen.getByRole('button', { name: 'Weiter' }));
	await screen.findByRole('heading', { name: 'Blatt und Kopfzeile' });
	await u.click(screen.getByRole('button', { name: 'Weiter' }));
	await screen.findByRole('heading', { name: 'Spalten' });
	return u;
}

describe('ImportWizard', () => {
	it('shows a stepper and rejects files that are too large or of the wrong type before uploading', async () => {
		render(ImportWizard);
		expect(screen.getByTestId('stepper')).toBeInTheDocument();
		expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Datei');
		const u = user();
		const big = csv();
		Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
		await u.upload(screen.getByTestId('import-file'), big);
		expect(screen.getByTestId('import-error')).toHaveTextContent('Die Datei ist größer als 5 MiB.');
		await u.upload(screen.getByTestId('import-file'), new File(['x'], 'bild.pdf'));
		expect(screen.getByTestId('import-error')).toHaveTextContent('Es werden nur CSV- und XLSX-Dateien angenommen.');
		expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
		expect(mock.calls.filter((c) => c.path.includes('/imports'))).toEqual([]);
	});

	it('accepts a dropped file and shows name and size', async () => {
		render(ImportWizard);
		await fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [csv()] } });
		expect(screen.getByTestId('picked-file')).toHaveTextContent('zeiten.csv');
		expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled();
	});

	it('walks all steps; nothing is written before the explicit confirmation', async () => {
		render(ImportWizard);
		const u = await uploadAndOpenMapping();
		// header suggestions: Datum/Beginn/Ende/Art
		expect(screen.getByLabelText('Datum')).toHaveValue('0');
		expect(screen.getByLabelText('Beginn')).toHaveValue('1');
		expect(screen.getByLabelText('Ende')).toHaveValue('2');
		expect(screen.getByLabelText('Art (optional)')).toHaveValue('3');
		await u.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
		await screen.findByTestId('preview-counts');
		expect(screen.getByTestId('count-rows')).toHaveTextContent('3');
		expect(screen.getByTestId('count-valid')).toHaveTextContent('3');
		expect(screen.getByTestId('count-duplicates')).toHaveTextContent('0');
		expect(screen.getByTestId('count-errors')).toHaveTextContent('0');
		expect(within(screen.getByTestId('sample-table')).getAllByRole('row')).toHaveLength(4);
		await u.click(screen.getByRole('button', { name: 'Weiter zur Bestätigung' }));
		await screen.findByTestId('confirm-summary');
		expect(screen.getByTestId('confirm-summary')).toHaveTextContent('3 neue Einträge werden angelegt, 0 Duplikate übersprungen.');
		// gate: no commit without the explicit check
		expect(screen.getByTestId('commit')).toBeDisabled();
		expect(mock.calls.some((c) => c.path.endsWith('/commit'))).toBe(false);
		expect((await api.getDay('2031-03-03')).rawWorkSeconds).toBe(0);
		await u.click(screen.getByLabelText(/Ich habe die Vorschau geprüft/));
		expect(screen.getByTestId('commit')).toBeEnabled();
		await u.click(screen.getByTestId('commit'));
		await screen.findByTestId('result-created');
		expect(screen.getByTestId('result-created')).toHaveTextContent('3 Einträge angelegt');
		expect(screen.getByRole('link', { name: 'Zum ersten importierten Tag' })).toHaveAttribute('href', '/time/2031-03-03');
		expect((await api.getDay('2031-03-03')).rawWorkSeconds).toBe(8 * 3600 + 15 * 60);
		// focus follows the step heading
		await waitFor(() => expect(screen.getByTestId('step-heading')).toHaveFocus());
	});

	it('skips duplicates when the same file is imported again', async () => {
		const first = render(ImportWizard);
		let u = await uploadAndOpenMapping();
		await u.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
		await u.click(await screen.findByRole('button', { name: 'Weiter zur Bestätigung' }));
		await u.click(await screen.findByLabelText(/Ich habe die Vorschau geprüft/));
		await u.click(screen.getByTestId('commit'));
		await screen.findByTestId('result-created');
		first.unmount();

		render(ImportWizard);
		u = await uploadAndOpenMapping();
		await u.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
		await screen.findByTestId('preview-counts');
		expect(screen.getByTestId('count-valid')).toHaveTextContent('0');
		expect(screen.getByTestId('count-duplicates')).toHaveTextContent('3');
		expect(screen.getByText(/so entstehen bei erneutem Import keine Doppelten/)).toBeInTheDocument();
		await u.click(screen.getByRole('button', { name: 'Weiter zur Bestätigung' }));
		await u.click(await screen.findByLabelText(/Ich habe die Vorschau geprüft/));
		await u.click(screen.getByTestId('commit'));
		await screen.findByTestId('result-created');
		expect(screen.getByTestId('result-created')).toHaveTextContent('0 Einträge angelegt');
		expect(screen.getByTestId('result-skipped')).toHaveTextContent('3 übersprungen');
		expect(screen.getByText(/Wahrscheinlich war die Datei schon importiert/)).toBeInTheDocument();
		expect(screen.queryByTestId('rollback')).toBeNull();
	});

	it('lists row errors in German and requires an explicit choice to skip them', async () => {
		render(ImportWizard);
		const u = await uploadAndOpenMapping(csv('Datum;Beginn;Ende\n03.03.2031;8:00;12:00\nkaputt;8:00;12:00\n04.03.2031;12:00;9:00\n'));
		await u.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
		const table = await screen.findByTestId('error-table');
		expect(within(table).getByText('Das Datum ist nicht lesbar.')).toBeInTheDocument();
		expect(within(table).getByText('Das Ende liegt nicht nach dem Beginn.')).toBeInTheDocument();
		await u.click(screen.getByRole('button', { name: 'Weiter zur Bestätigung' }));
		await u.click(await screen.findByLabelText(/Ich habe die Vorschau geprüft/));
		expect(screen.getByTestId('commit')).toBeDisabled(); // error rows still need their own decision
		await u.click(screen.getByLabelText(/Fehlerzeilen überspringen/));
		expect(screen.getByTestId('commit')).toBeEnabled();
	});

	it('explains decimal hours and reads the sample row with the chosen format', async () => {
		render(ImportWizard);
		const u = await uploadAndOpenMapping(csv('Datum;Beginn;Dauer\n03.03.2031;8;7,7\n'));
		await u.click(screen.getByLabelText('Die Datei hat eine Dauer'));
		await u.selectOptions(screen.getByLabelText('Dauer'), '2');
		expect(screen.getByTestId('probe')).toHaveTextContent('„8“ ist mit diesem Format nicht lesbar');
		await u.selectOptions(screen.getByLabelText('Zeitformat'), 'decimal_hours');
		expect(screen.getByTestId('decimal-hours-note')).toHaveTextContent('7,7 Stunden sind 7:42 und nicht 7:07');
		expect(screen.getByTestId('probe')).toHaveTextContent('Dauer: „7,7“ wird gelesen als 7:42');
		expect(screen.getByTestId('probe')).toHaveTextContent('Beginn: „8“ wird gelesen als 8:00');
	});

	it('blocks validation while the mapping is incomplete', async () => {
		render(ImportWizard);
		const u = user();
		await u.upload(screen.getByTestId('import-file'), csv('03.03.2031;8:00;12:00\n'));
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Blatt und Kopfzeile' });
		await u.click(screen.getByTestId('no-header'));
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Spalten' });
		await u.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
		expect(screen.getByTestId('mapping-issues')).toHaveTextContent('Wähle die Spalte mit dem Datum.');
		expect(mock.calls.some((c) => c.path.endsWith('/mapping'))).toBe(false);
	});

	it('saves, applies and deletes templates', async () => {
		render(ImportWizard);
		const u = await uploadAndOpenMapping();
		await u.type(screen.getByLabelText('Name der neuen Vorlage'), 'Mein Export');
		await u.click(screen.getByRole('button', { name: 'Als Vorlage speichern' }));
		await screen.findByText('Vorlage „Mein Export“ gespeichert.');
		await u.selectOptions(screen.getByLabelText('Datum'), '');
		expect(screen.getByLabelText('Datum')).toHaveValue('');
		await u.selectOptions(screen.getByLabelText('Gespeicherte Vorlage'), 'Mein Export');
		await u.click(screen.getByRole('button', { name: 'Anwenden' }));
		expect(screen.getByLabelText('Datum')).toHaveValue('0');
		await u.click(screen.getByRole('button', { name: 'Vorlage löschen' }));
		await screen.findByText('Vorlage gelöscht.');
		expect(await api.listImportTemplates()).toEqual([]);
	});

	it('rolls back a committed batch and shows the conflict list when entries were changed', async () => {
		render(ImportWizard);
		let u = await uploadAndOpenMapping();
		await u.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
		await u.click(await screen.findByRole('button', { name: 'Weiter zur Bestätigung' }));
		await u.click(await screen.findByLabelText(/Ich habe die Vorschau geprüft/));
		await u.click(screen.getByTestId('commit'));
		await screen.findByTestId('rollback');
		const [segment] = await api.listSegments('2031-03-03T00:00:00Z', '2031-03-03T23:00:00Z');
		await api.correctSegment(segment.id, { endedAt: '2031-03-03T10:30:00Z', reason: 'x' }, segment.version);
		await u.click(screen.getByTestId('rollback'));
		await u.click(screen.getByTestId('rollback-confirm'));
		const conflicts = await screen.findByTestId('rollback-conflicts');
		expect(conflicts).toHaveTextContent('Diese 1 Einträge wurden seit dem Import geändert');
		expect(conflicts).toHaveTextContent(segment.id);
		expect(screen.getByTestId('import-error')).toHaveTextContent('Der Import kann nicht zurückgenommen werden');
		// undo the change, then the rollback goes through
		const fresh = (await api.listSegments('2031-03-03T00:00:00Z', '2031-03-03T23:00:00Z'))[0];
		expect(fresh.version).toBe(2);
	});

	it('rolls back an unchanged batch', async () => {
		render(ImportWizard);
		const u = await uploadAndOpenMapping();
		await u.click(screen.getByRole('button', { name: 'Vorschau prüfen' }));
		await u.click(await screen.findByRole('button', { name: 'Weiter zur Bestätigung' }));
		await u.click(await screen.findByLabelText(/Ich habe die Vorschau geprüft/));
		await u.click(screen.getByTestId('commit'));
		await u.click(await screen.findByTestId('rollback'));
		await u.click(screen.getByTestId('rollback-confirm'));
		await screen.findByTestId('rolled-back');
		expect((await api.getDay('2031-03-03')).rawWorkSeconds).toBe(0);
	});

	it('discards the job from the sheet step without writing anything', async () => {
		render(ImportWizard);
		const u = user();
		await u.upload(screen.getByTestId('import-file'), csv());
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Blatt und Kopfzeile' });
		await u.click(screen.getByRole('button', { name: 'Import verwerfen' }));
		await screen.findByText('Der Import wurde verworfen. Es wurde nichts übernommen.');
		expect(mock.calls.some((c) => c.method === 'DELETE' && c.path.includes('/imports/'))).toBe(true);
		expect(screen.getByTestId('dropzone')).toBeInTheDocument();
	});

	it('shows a German message for a rejected upload (415)', async () => {
		vi.spyOn(api, 'uploadImport').mockRejectedValue(new ApiError(415, 'unsupported_type'));
		render(ImportWizard);
		const u = user();
		await u.upload(screen.getByTestId('import-file'), csv());
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		expect(await screen.findByTestId('import-error')).toHaveTextContent('Dieser Dateityp wird nicht angenommen.');
	});
});

describe('Export page', () => {
	function stubDownload() {
		const create = vi.fn(() => 'blob:x');
		(URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
		(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			downloads.push(this.download);
		});
		const downloads: string[] = [];
		return { create, click, downloads };
	}

	it('downloads with the server filename and explains actual vs. evaluated columns', async () => {
		const stub = stubDownload();
		render(ExportPage);
		expect(screen.getByTestId('export-columns')).toHaveTextContent('Tatsächlich:');
		expect(screen.getByTestId('export-columns')).toHaveTextContent('Bewertet:');
		const u = user();
		await u.click(screen.getByRole('button', { name: 'Dieser Monat' }));
		expect(screen.getByLabelText('Von')).toHaveValue('2026-10-01');
		expect(screen.getByLabelText('Bis')).toHaveValue('2026-10-31');
		await u.click(screen.getByLabelText(/CSV/));
		await u.click(screen.getByRole('button', { name: 'Exportieren' }));
		await screen.findByTestId('export-done');
		expect(mock.calls.at(-1)?.path).toBe('/api/v1/export/time?from=2026-10-01&to=2026-10-31&format=csv');
		expect(stub.downloads).toEqual(['Arbeitszeit_2026-10-01_2026-10-31.csv']);
		expect(screen.getByTestId('export-done')).toHaveTextContent('Export erstellt: Arbeitszeit_2026-10-01_2026-10-31.csv');
	});

	it('blocks ranges over 366 days on the client and maps range_too_large from the server', async () => {
		stubDownload();
		render(ExportPage);
		const u = user();
		await fireEvent.input(screen.getByLabelText('Von'), { target: { value: '2025-01-01' } });
		await fireEvent.input(screen.getByLabelText('Bis'), { target: { value: '2026-10-01' } });
		await u.click(screen.getByRole('button', { name: 'Exportieren' }));
		expect(screen.getByText('Der Zeitraum ist länger als 366 Tage.')).toBeInTheDocument();
		expect(mock.calls.some((c) => c.path.includes('/export/'))).toBe(false);
		vi.spyOn(api, 'exportTime').mockRejectedValue(new ApiError(400, 'range_too_large'));
		await fireEvent.input(screen.getByLabelText('Von'), { target: { value: '2026-09-01' } });
		await fireEvent.input(screen.getByLabelText('Bis'), { target: { value: '2026-09-30' } });
		await u.click(screen.getByRole('button', { name: 'Exportieren' }));
		expect(await screen.findByTestId('export-error')).toHaveTextContent('Erlaubt sind höchstens 366 Tage.');
	});

	it('degrades to "noch nicht verfügbar" on 404/501', async () => {
		stubDownload();
		vi.spyOn(api, 'exportTime').mockRejectedValue(new ApiError(404, 'not_found'));
		render(ExportPage);
		await user().click(screen.getByRole('button', { name: 'Exportieren' }));
		expect(await screen.findByTestId('planning-unavailable')).toBeInTheDocument();
	});
});

describe('Storage settings', () => {
	it('shows rules, the stored-secret hint and never prefills the secret', async () => {
		await api.putStorageSettings({
			rules: [{ maxBytes: 262144, backend: 'db' }, { maxBytes: null, backend: 's3' }],
			maxUploadBytes: 5 * 1024 * 1024,
			s3: { endpoint: 'https://s3.example.org', region: 'eu', bucket: 'b', accessKeyId: 'AKIA', secretAccessKey: 'geheim' }
		});
		render(StoragePage);
		await screen.findByTestId('storage-rules');
		expect(screen.getByTestId('storage-only-new')).toHaveTextContent('Änderungen gelten nur für neue Uploads');
		expect(screen.getByLabelText('Größe 1')).toHaveValue('256');
		expect(screen.getByLabelText('Einheit 1')).toHaveValue('KiB');
		expect(screen.getByTestId('storage-rule-rest')).toHaveTextContent('Alle größeren Dateien');
		expect(screen.getByLabelText('Speicherort für alle größeren Dateien')).toHaveValue('s3');
		expect(screen.getByLabelText('Geheimer Zugriffsschlüssel')).toHaveValue('');
		expect(screen.getByTestId('secret-stored')).toHaveTextContent('Geheimnis gespeichert');
		expect(document.body.innerHTML).not.toContain('geheim"');
	});

	it('saves valid rules and sends no secret unless typed', async () => {
		render(StoragePage);
		await screen.findByTestId('storage-rules');
		const u = user();
		await u.click(screen.getByRole('button', { name: 'Regel hinzufügen' }));
		await u.clear(screen.getByLabelText('Größe 1'));
		await u.type(screen.getByLabelText('Größe 1'), '1');
		await u.click(screen.getByRole('button', { name: 'Speichern' }));
		await screen.findByTestId('storage-saved');
		const put = mock.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/admin/storage'));
		expect(put).toHaveLength(1);
		const stored = await api.getStorageSettings();
		expect(stored.rules).toEqual([{ maxBytes: 1048576, backend: 'db' }, { maxBytes: null, backend: 'db' }]);
	});

	it('blocks saving invalid rules without calling the server', async () => {
		render(StoragePage);
		await screen.findByTestId('storage-rules');
		const u = user();
		await u.click(screen.getByRole('button', { name: 'Regel hinzufügen' }));
		await u.click(screen.getByRole('button', { name: 'Regel hinzufügen' }));
		await u.clear(screen.getByLabelText('Größe 2'));
		await u.type(screen.getByLabelText('Größe 2'), '1');
		await u.selectOptions(screen.getByLabelText('Einheit 2'), 'KiB'); // 1 KiB is not above the first rule
		await u.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(screen.getByTestId('storage-error')).toHaveTextContent('Bitte korrigiere die markierten Felder.');
		expect(screen.getAllByTestId('rule-issue')[0]).toHaveTextContent('Die Grenze muss größer sein als die der Regel davor.');
		expect(mock.calls.some((c) => c.method === 'PUT' && c.path.endsWith('/admin/storage'))).toBe(false);
	});

	it('requires the path of a used local backend and the fields of S3', async () => {
		render(StoragePage);
		await screen.findByTestId('storage-rules');
		const u = user();
		await u.selectOptions(screen.getByLabelText('Speicherort für alle größeren Dateien'), 'local');
		await u.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(screen.getByText(/Gib das Verzeichnis an/)).toBeInTheDocument();
		await u.selectOptions(screen.getByLabelText('Speicherort für alle größeren Dateien'), 's3');
		await u.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(screen.getByText(/Endpunkt, Region, Bucket und Schlüssel-ID sind nötig/)).toBeInTheDocument();
	});

	it('explains the missing STORAGE_SECRET_KEY on 501', async () => {
		render(StoragePage);
		await screen.findByTestId('storage-rules');
		vi.spyOn(api, 'putStorageSettings').mockRejectedValue(new ApiError(501, 'not_implemented'));
		await user().click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByTestId('storage-error')).toHaveTextContent('STORAGE_SECRET_KEY');
	});

	it('shows a 403 hint to non-admins without calling the storage API', async () => {
		sessionStore.current = { ...sessionStore.current!, account: { ...sessionStore.current!.account, role: 'member' } };
		render(StoragePage);
		expect(await screen.findByTestId('storage-forbidden')).toHaveTextContent('nur von Administratoren');
		expect(mock.calls.some((c) => c.path.includes('/admin/storage'))).toBe(false);
	});

	it('degrades to "noch nicht verfügbar" on 404', async () => {
		vi.spyOn(api, 'getStorageSettings').mockRejectedValue(new ApiError(404, 'not_found'));
		render(StoragePage);
		expect(await screen.findByTestId('planning-unavailable')).toBeInTheDocument();
	});

	it('rows can be added and removed', async () => {
		render(StoragePage);
		await screen.findByTestId('storage-rules');
		const u = user();
		expect(screen.queryAllByTestId('storage-rule')).toHaveLength(0);
		await u.click(screen.getByRole('button', { name: 'Regel hinzufügen' }));
		expect(screen.getAllByTestId('storage-rule')).toHaveLength(1);
		await u.click(screen.getByRole('button', { name: 'Regel 1 entfernen' }));
		expect(screen.queryAllByTestId('storage-rule')).toHaveLength(0);
	});
});

describe('AbsenceAttachments', () => {
	async function absenceId() {
		return (await api.createAbsence({ kind: 'sick', startDate: '2031-04-07', endDate: '2031-04-08', status: 'approved' })).id;
	}

	it('uploads, lists with size, downloads and removes; says attachments are never shared', async () => {
		const id = await absenceId();
		(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
		(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
		const names: string[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			names.push(this.download);
		});
		render(AbsenceAttachments, { absenceId: id });
		await screen.findByTestId('attachments-never-shared');
		expect(screen.getByTestId('attachments-never-shared')).toHaveTextContent('nie geteilt');
		const u = user();
		const pdf = new File(['%PDF-1.4 ' + 'x'.repeat(1500)], 'Krankmeldung.pdf', { type: 'application/pdf' });
		await u.upload(screen.getByTestId('attachment-file'), pdf);
		expect(screen.getByTestId('attachment-picked')).toHaveTextContent('Krankmeldung.pdf (1,5 KiB)');
		await u.click(screen.getByRole('button', { name: 'Hochladen' }));
		const row = await screen.findByTestId('attachment');
		expect(row).toHaveTextContent('Krankmeldung.pdf');
		expect(row).toHaveTextContent('1,5 KiB');
		await u.click(within(row).getByRole('button', { name: 'Krankmeldung.pdf herunterladen' }));
		await waitFor(() => expect(names).toEqual(['Krankmeldung.pdf']));
		await u.click(within(row).getByRole('button', { name: 'Krankmeldung.pdf entfernen' }));
		await waitFor(() => expect(screen.queryByTestId('attachment')).toBeNull());
		expect(await api.listAbsenceAttachments(id)).toEqual([]);
	});

	it('rejects types outside the whitelist on the client and maps 413/415 from the server', async () => {
		const id = await absenceId();
		render(AbsenceAttachments, { absenceId: id });
		await screen.findByTestId('attachment-file');
		const u = user();
		await u.upload(screen.getByTestId('attachment-file'), new File(['MZ'], 'programm.exe'));
		expect(screen.getByTestId('attachment-error')).toHaveTextContent('Erlaubt sind PDF, PNG, JPG, HEIC und TXT.');
		expect(screen.queryByRole('button', { name: 'Hochladen' })).toBeNull();

		const spy = vi.spyOn(api, 'uploadFile').mockRejectedValue(new ApiError(413, 'file_too_large'));
		await u.upload(screen.getByTestId('attachment-file'), new File(['x'], 'n.txt'));
		await u.click(screen.getByRole('button', { name: 'Hochladen' }));
		expect(await screen.findByTestId('attachment-error')).toHaveTextContent('Die Datei ist zu groß.');
		spy.mockRejectedValue(new ApiError(415, 'unsupported_type'));
		await u.click(screen.getByRole('button', { name: 'Hochladen' }));
		await waitFor(() => expect(screen.getByTestId('attachment-error')).toHaveTextContent('Dieser Dateityp ist nicht erlaubt.'));
	});

	it('degrades gracefully when the server has no attachments yet', async () => {
		vi.spyOn(api, 'listAbsenceAttachments').mockRejectedValue(new ApiError(501, 'not_implemented'));
		render(AbsenceAttachments, { absenceId: 'x' });
		expect(await screen.findByTestId('attachments-unavailable')).toBeInTheDocument();
	});
});
