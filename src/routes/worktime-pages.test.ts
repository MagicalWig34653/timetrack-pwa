import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSimpleWorkbook, buildWorktimeWorkbook } from '../../mock/worktime-xlsx.ts';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import ImportWizard from '#lib/components/transfer/ImportWizard.svelte';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/import'), params: {} } }));

import ExportPage from './(app)/export/+page.svelte';

const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;
const user = () => userEvent.setup({ applyAccept: false });

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	mock = createMockFetch({ now: () => NOW.getTime() });
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
	vi.restoreAllMocks();
});

const day = (date: string, start: string | null, end: string | null, remark?: string) => ({ date, start, end, remark });
const workbook = () =>
	new File(
		[
			buildWorktimeWorkbook({
				sheets: [
					{
						year: 2026,
						days: [
							day('2026-03-02', '8:00', '16:12'),
							day('2026-03-03', '8:00', '16:12', 'Urlaub'),
							day('2026-03-04', '8:00', '16:12', 'Urlaub (Freigestellt)'),
							day('2026-03-05', '9:00', '13:00', 'Arzttermin'),
							day('2026-03-06', '9:00', '9:20')
						]
					}
				]
			}) as BlobPart
		],
		'Arbeitszeit.xlsx'
	);

/** C23 situations: partial Freigestellt (18.9.), holiday work (25.12.) and school (26.12.) rows; first content on a Thursday */
const c23Workbook = () =>
	new File(
		[
			buildWorktimeWorkbook({
				sheets: [
					{
						year: 2026,
						days: [
							day('2026-09-17', '8:00', '16:12'),
							day('2026-09-18', '8:00', '11:00', 'Freigestellt'),
							day('2026-09-21', '8:00', '16:12', 'Urlaub'),
							day('2026-12-25', '8:00', '16:12'),
							day('2026-12-26', '8:00', '12:00', 'BS')
						]
					}
				]
			}) as BlobPart
		],
		'Arbeitszeit.xlsx'
	);

/** Upload -> the recognition card of step 1 (the table is analysed, the template is preselected). */
async function openRecognition(file: File = workbook()) {
	const u = user();
	await u.upload(screen.getByTestId('import-file'), file);
	await u.click(screen.getByRole('button', { name: 'Weiter' }));
	await screen.findByTestId('profile-banner');
	await waitFor(() => expect(screen.queryByTestId('profile-counting')).toBeNull());
	return u;
}

async function openPreview(file: File = workbook()) {
	const u = await openRecognition(file);
	await u.click(screen.getByTestId('profile-next'));
	await screen.findByTestId('worktime-preview');
	return u;
}

const commitNow = (u: ReturnType<typeof user>) => u.click(screen.getByTestId('commit'));
const putCalls = () => mock.calls.filter((c) => c.method === 'PUT' && c.path.includes('/mapping'));

describe('worktime import wizard: recognition, template and preview', () => {
	it('recognises the table in step 1: the card is the template choice with plain numbers and a way to map the columns instead', async () => {
		render(ImportWizard);
		await openRecognition();
		expect(screen.getByTestId('step-heading')).toHaveTextContent('Datei wählen');
		const card = screen.getByTestId('profile-banner');
		expect(card).toHaveTextContent('Das ist deine Arbeitszeit-Tabelle (Excel mit Jahresblättern und Wochenblöcken).');
		expect(screen.getByTestId('profile-template')).toHaveTextContent('Vorlage: Meine Arbeitszeit-Tabelle (empfohlen)');
		expect(screen.getByTestId('profile-template')).toHaveTextContent('Alles ist passend voreingestellt.');
		expect(screen.getByTestId('profile-fact-sheets')).toHaveTextContent('1');
		expect(screen.getByTestId('profile-fact-weeks')).toHaveTextContent('1');
		expect(screen.getByTestId('profile-fact-time-days')).toHaveTextContent('3');
		expect(screen.getByTestId('profile-fact-vacation-days')).toHaveTextContent('1');
		expect(screen.getByTestId('profile-fact-first-day')).toHaveTextContent('02.03.2026');
		// recognition has applied the template: a preview with the recommended options already exists, nothing is written
		expect(putCalls()).toHaveLength(1);
		expect(mock.calls.some((c) => c.method === 'POST' && c.path.endsWith('/commit'))).toBe(false);
		expect(screen.getByTestId('profile-switch-generic')).toHaveTextContent('Stattdessen Spalten selbst zuordnen');
		expect(screen.queryByTestId('no-header')).toBeNull();
	});

	it('maps the columns instead (generic wizard) and can return to the table template', async () => {
		render(ImportWizard);
		const u = await openRecognition();
		await u.click(screen.getByTestId('profile-switch-generic'));
		await screen.findByRole('heading', { name: 'Blatt und Kopfzeile' });
		expect(screen.getByTestId('profile-banner-generic')).toBeInTheDocument();
		expect(screen.getByTestId('no-header')).toBeInTheDocument();
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Spalten' });
		await u.click(screen.getByRole('button', { name: 'Zurück' }));
		await u.click(screen.getByTestId('profile-switch-worktime'));
		await screen.findByTestId('worktime-preview');
		expect(screen.getByTestId('step-heading')).toHaveTextContent('Vorschau');
	});

	it('does not show the recognition card for a generic workbook', async () => {
		render(ImportWizard);
		const u = user();
		await u.upload(screen.getByTestId('import-file'), new File([buildSimpleWorkbook('Tabelle1', [['Datum', 'Beginn', 'Ende'], ['03.03.2026', '8:00', '9:00']]) as BlobPart], 'z.xlsx'));
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Blatt und Kopfzeile' });
		expect(screen.queryByTestId('profile-banner')).toBeNull();
		expect(screen.queryByTestId('profile-banner-generic')).toBeNull();
	});

	it('preview: plain summary, one primary button, collapsed customisation, table balance in plain words', async () => {
		render(ImportWizard);
		await openPreview();
		expect(screen.getByTestId('step-heading')).toHaveTextContent('Vorschau');
		expect(screen.getByTestId('wt-summary')).toHaveTextContent('Das wird importiert: 3 Arbeitstage, 1 Urlaubstag');
		expect(screen.getAllByRole('button', { name: 'Jetzt importieren' })).toHaveLength(1);
		expect((screen.getByTestId('wt-customize') as HTMLDetailsElement).open).toBe(false);
		expect((screen.getByTestId('wt-expert') as HTMLDetailsElement).open).toBe(false);
		expect(screen.getByTestId('wt-customize')).toHaveTextContent('Anpassen (nur wenn nötig)');
		expect(screen.getByTestId('wt-balance')).toHaveTextContent('Zeitkonto: Tabelle gegen App');
		expect(screen.getByTestId('wt-count-segments')).toHaveTextContent('5');
		expect(screen.getByTestId('wt-count-absences')).toHaveTextContent('2');
		expect(screen.getByTestId('wt-date-system')).toHaveTextContent('1900');
		expect(screen.getByTestId('wt-by-action')).toHaveTextContent('Freigestellt (bezahlt frei): 1');
		// pause_exceeds_day is a warning: it does not count as error
		expect(screen.getByTestId('error-table').querySelector('[data-warning="true"]')).not.toBeNull();
		expect(screen.getByTestId('commit')).toBeEnabled();
	});

	it('every option states a plain sentence, an example and the recommendation; the remark table sits in the expert options', async () => {
		render(ImportWizard);
		await openPreview();
		const options = screen.getByTestId('wt-customize');
		expect(options).toHaveTextContent('Tag um die Pause herum teilen (empfohlen)');
		expect(options).toHaveTextContent('Beispiel: 08:00 bis 16:12 Uhr mit 30 Minuten Pause');
		expect(options).toHaveTextContent('Nicht übernehmen (empfohlen)');
		expect(options).toHaveTextContent('Beispiel: Steht am 25.12. eine Arbeitszeit');
		expect(options).toHaveTextContent('Als gearbeitete Zeit (empfohlen)');
		expect(options).toHaveTextContent('Sekunden abschneiden (empfohlen)');
		expect(screen.getByTestId('wt-expert')).toContainElement(screen.getByTestId('wt-rules'));
		expect(screen.getByTestId('wt-expert')).toHaveTextContent('Sehr alte Mac-Excel-Dateien');
		expect(screen.getByTestId('wt-pause-split')).toBeChecked();
		expect(screen.getByTestId('wt-holiday-discard')).toBeChecked();
		expect(screen.getByTestId('wt-credit-work')).toBeChecked();
		expect(screen.getByTestId('wt-day-options')).toHaveTextContent('Mehrarbeit');
	});

	it('an option change refreshes the preview by itself, "Zurücksetzen auf Empfehlung" restores everything', async () => {
		render(ImportWizard);
		const u = await openPreview(c23Workbook());
		expect(screen.getByTestId('wt-warnings').querySelector('[data-code="school_on_holiday"]')).not.toBeNull();
		const before = putCalls().length;
		expect(screen.getByTestId('wt-reset')).toBeDisabled();
		await u.click(screen.getByTestId('wt-holiday-keep'));
		expect(screen.getByTestId('commit')).toBeDisabled();
		await waitFor(() => expect(screen.queryByTestId('wt-warnings')?.querySelector('[data-code="school_on_holiday"]') ?? null).toBeNull());
		expect(putCalls().length).toBeGreaterThan(before);
		expect(screen.getByTestId('commit')).toBeEnabled();
		expect(screen.getByTestId('wt-customize')).toHaveTextContent('Geändert');
		await u.click(screen.getByTestId('wt-reset'));
		expect(screen.getByTestId('wt-holiday-discard')).toBeChecked();
		await waitFor(() => expect(screen.getByTestId('wt-warnings').querySelector('[data-code="school_on_holiday"]')).not.toBeNull());
		expect(screen.getByTestId('wt-reset')).toBeDisabled();
	});

	it('edits the remark table (add, reorder, remove, reset), blocks the import on a faulty entry and shows the problem', async () => {
		render(ImportWizard);
		const u = await openPreview();
		expect(screen.getByTestId('wt-rules-intro')).toHaveTextContent('die erste passende Zeile von oben');
		expect(screen.getByTestId('wt-rules-absence-note')).toHaveTextContent('keine Arbeitszeit');
		const rows = () => screen.getAllByTestId('wt-rule');
		expect(rows()).toHaveLength(6);
		expect((within(rows()[1]).getByLabelText('Wenn die Bemerkung enthält') as HTMLInputElement).value).toBe('freigestellt');
		await u.click(screen.getByRole('button', { name: 'Zeile 2 nach oben' }));
		expect((within(rows()[0]).getByLabelText('Wenn die Bemerkung enthält') as HTMLInputElement).value).toBe('freigestellt');
		await u.click(screen.getByRole('button', { name: 'Zeile 1 entfernen' }));
		expect(rows()).toHaveLength(5);
		await u.click(screen.getByTestId('wt-rule-add'));
		expect(rows()).toHaveLength(6);
		expect(screen.getByTestId('mapping-issues')).toHaveTextContent('Zeile 6: Der Text fehlt.');
		expect((screen.getByTestId('wt-customize') as HTMLDetailsElement).open).toBe(true);
		expect(screen.getByTestId('commit')).toBeDisabled();
		await u.click(screen.getByTestId('wt-rules-reset'));
		await waitFor(() => expect(rows()).toHaveLength(6));
		expect((within(rows()[0]).getByLabelText('Wenn die Bemerkung enthält') as HTMLInputElement).value).toBe('krank');
		expect(mock.calls.some((c) => c.path.endsWith('/import-profiles/worktime/default-rules'))).toBe(true);
		await waitFor(() => expect(screen.getByTestId('commit')).toBeEnabled());
	});

	it('lists unknown remarks, remembers a meaning with one click and imports with one button', async () => {
		render(ImportWizard);
		const u = await openPreview();
		const unmapped = screen.getByTestId('wt-unmapped');
		expect(unmapped).toHaveTextContent('Arzttermin');
		await u.click(within(unmapped).getByRole('button', { name: 'Bedeutung für „Arzttermin“ merken' }));
		await waitFor(() => expect(screen.queryByTestId('wt-unmapped')).toBeNull());
		expect(screen.getByTestId('import-notice')).toHaveTextContent('Gemerkt');
		await commitNow(u);
		expect(await screen.findByTestId('result-absences')).toHaveTextContent('2 Abwesenheiten angelegt');
		expect(await api.listAbsences('2026-03-01', '2026-03-31')).toHaveLength(2);
		// there is no separate confirmation step in the template flow
		expect(screen.queryByTestId('confirm-summary')).toBeNull();
	});

	it('shows a typed conflict list when the rollback is refused', async () => {
		render(ImportWizard);
		const u = await openPreview();
		await commitNow(u);
		await screen.findByTestId('result-created');
		const [first] = await api.listAbsences('2026-03-01', '2026-03-31');
		await api.updateAbsence(first.id, { kind: first.kind, startDate: first.startDate, endDate: first.endDate, status: first.status, note: 'x' }, first.version);
		await u.click(screen.getByTestId('rollback'));
		await u.click(screen.getByTestId('rollback-confirm'));
		const list = await screen.findByTestId('rollback-conflicts');
		expect(list).toHaveTextContent('Abwesenheit');
		expect(list.querySelector('[data-conflict-type="absence"]')).not.toBeNull();
	});

	it('stores and re-applies the worktime options as an own template (expert options)', async () => {
		render(ImportWizard);
		const u = await openPreview();
		await u.click(screen.getByTestId('wt-pause-none'));
		await u.type(screen.getByLabelText('Name der neuen Vorlage'), 'Meine Tabelle');
		await u.click(screen.getByRole('button', { name: 'Als Vorlage speichern' }));
		await screen.findByTestId('import-notice');
		const templates = await api.listImportTemplates();
		expect(templates[0].mapping).toMatchObject({ profile: 'worktime_workbook', worktime: { pauseMode: 'none' } });
		await u.click(screen.getByTestId('wt-pause-split'));
		await u.selectOptions(screen.getByLabelText('Gespeicherte Vorlage'), 'Meine Tabelle');
		await u.click(screen.getByRole('button', { name: 'Anwenden' }));
		expect((screen.getByTestId('wt-pause-none') as HTMLInputElement).checked).toBe(true);
		expect(screen.getByTestId('import-notice')).toHaveTextContent('Die Vorschau wurde aktualisiert');
	});
});

describe('worktime import wizard: warnings in plain words, result and the one next step (work model)', () => {
	const warning = (code: string) => screen.queryByTestId('wt-warnings')?.querySelector(`[data-code="${code}"]`) ?? null;

	it('each warning says what happens and answers "Muss ich etwas tun?"', async () => {
		render(ImportWizard);
		await openPreview(c23Workbook());
		expect(warning('holiday_times_discarded')).toHaveTextContent('1 Tag');
		expect(warning('school_on_holiday')).toHaveTextContent('An Feiertagen steht in der Tabelle eine Schulzeit.');
		expect(warning('credit_partial_as_work')).toHaveAttribute('data-count', '1');
		expect(warning('credit_partial_as_work')).toHaveTextContent('Muss ich etwas tun?');
		expect(warning('credit_partial_as_work')).toHaveTextContent('Als ganzer freier Tag');
		expect(screen.getByTestId('wt-warnings')).not.toHaveTextContent(/Profil|Mapping|Regeln/);
		expect(screen.getByTestId('wt-count-segments')).toHaveTextContent(/^[1-9]/);
		expect(screen.getByTestId('wt-balance-value')).toHaveTextContent('-5:12');
		expect(screen.getByTestId('wt-balance-future')).toHaveTextContent('-4:12');
		expect(screen.getByTestId('wt-balance-total')).toHaveTextContent('-9:24');
		expect(screen.getByTestId('wt-model-pending')).toHaveTextContent('legst du noch dein Arbeitsmodell an');
	});

	it('"keep" and "as full day" remove the warnings', async () => {
		render(ImportWizard);
		const u = await openPreview(c23Workbook());
		await u.click(screen.getByTestId('wt-holiday-keep'));
		await u.click(screen.getByTestId('wt-credit-absence'));
		await waitFor(() => expect(screen.queryByTestId('wt-warnings')).toBeNull());
		expect(screen.getByTestId('wt-count-absences')).toHaveTextContent('2');
	});

	it('result: one next step "Arbeitsmodell anlegen (ab ...)" with the reason, creates the model, then the account comparison and a single way on', async () => {
		render(ImportWizard);
		const u = await openPreview(c23Workbook());
		await commitNow(u);
		const warnings = await screen.findByTestId('result-warnings');
		expect(warnings.querySelector('[data-code="holiday_times_discarded"]')).toHaveAttribute('data-count', '1');
		const next = screen.getByTestId('wt-next-step');
		expect(screen.getByTestId('wt-model-start')).toHaveAttribute('data-kind', 'earlier');
		expect(within(next).getByTestId('wt-next-why')).toHaveTextContent('Soll');
		expect(within(next).getByTestId('wt-model-create')).toHaveTextContent('Arbeitsmodell anlegen (ab 17.09.2026)');
		expect(screen.queryByTestId('wt-continue')).toBeNull();
		await u.click(within(next).getByTestId('wt-model-create'));
		await screen.findByTestId('wt-model-done');
		expect(screen.getByTestId('wt-model-done')).toHaveTextContent('ab 17.09.2026');
		expect(screen.getByTestId('wt-continue')).toHaveAttribute('href', '/time/2026-09-17');
		await screen.findByTestId('wt-compare');
		expect(screen.getByTestId('wt-compare')).toHaveTextContent('Die Tabelle rechnet bis heute');
		const models = await api.listWorkModels();
		expect(models.some((m) => m.validFrom === '2026-09-17')).toBe(true);
	});

	it('a failed model creation shows the server reason in plain German, keeps the screen and offers "Erneut versuchen"', async () => {
		render(ImportWizard);
		const u = await openPreview(c23Workbook());
		await commitNow(u);
		await screen.findByTestId('wt-next-step');
		const spy = vi.spyOn(api, 'createWorkModel').mockRejectedValueOnce(new ApiError(409, 'model_overlap', 'x'));
		await u.click(screen.getByTestId('wt-model-create'));
		const error = await screen.findByTestId('wt-model-error');
		expect(error).toHaveTextContent('überschneidet sich mit einer späteren Arbeitsmodell-Version');
		expect(error).not.toHaveTextContent('model_overlap');
		expect(screen.getByTestId('result-created')).toBeInTheDocument();
		expect(screen.getByTestId('wt-model-create')).toHaveTextContent('Erneut versuchen');
		await u.click(screen.getByTestId('wt-model-create'));
		await screen.findByTestId('wt-model-done');
		expect(spy).toHaveBeenCalledTimes(2);
		expect(screen.queryByTestId('wt-model-error')).toBeNull();
	});
});

describe('empty template file', () => {
	it('step 1 offers the empty work-time table; it downloads next year\'s sheet through the existing export', async () => {
		const saved: string[] = [];
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			saved.push(this.download);
		});
		render(ImportWizard);
		const u = user();
		await u.click(screen.getByTestId('template-file-download'));
		await screen.findByTestId('import-notice');
		const call = mock.calls.find((c) => c.path.includes('/export/time'))!;
		expect(call.path).toContain('format=worktime-xlsx');
		expect(call.path).toContain('from=2027-01-01');
		expect(call.path).toContain('to=2027-12-31');
		expect(screen.getByTestId('import-notice')).toHaveTextContent('Vorlage für 2027');
		expect(saved[0]).toMatch(/\.xlsx$/);
		click.mockRestore();
	});
});

describe('export page: worktime format', () => {
	it('offers the worktime workbook with its options and downloads with the server filename', async () => {
		const saved: string[] = [];
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			saved.push(this.download);
		});
		render(ExportPage);
		const u = user();
		await u.click(screen.getByRole('radio', { name: /Arbeitszeit-Tabelle/ }));
		const options = screen.getByTestId('export-worktime');
		expect(options).toHaveTextContent('dasselbe Blattlayout');
		expect(options).toHaveTextContent('behält die Formeln');
		expect(options).toHaveTextContent('Mac-Excel-Altformat');
		expect(within(options).getByRole('radio', { name: /Bewertet/ })).toBeChecked();
		expect(screen.queryByTestId('export-columns')).toBeNull();
		await u.selectOptions(within(options).getByLabelText('Pause'), 'override');
		await u.clear(within(options).getByLabelText('Pause in Minuten'));
		await u.type(within(options).getByLabelText('Pause in Minuten'), '999');
		await u.click(screen.getByRole('button', { name: 'Exportieren' }));
		expect(within(options).getByText('Die Pause muss zwischen 0 und 240 Minuten liegen.')).toBeInTheDocument();
		await u.clear(within(options).getByLabelText('Pause in Minuten'));
		await u.type(within(options).getByLabelText('Pause in Minuten'), '45');
		await u.selectOptions(within(options).getByLabelText('Datumssystem'), '1904');
		await u.click(within(options).getByRole('radio', { name: /Tatsächlich/ }));
		await u.click(screen.getByRole('button', { name: 'Exportieren' }));
		await screen.findByTestId('export-done');
		const call = mock.calls.find((c) => c.path.includes('/export/time'))!;
		expect(call.path).toContain('format=worktime-xlsx');
		expect(call.path).toContain('times=actual');
		expect(call.path).toContain('pauseMinutes=45');
		expect(call.path).toContain('dateSystem=1904');
		expect(call.path).toContain('standardStart=08%3A00');
		expect(saved[0]).toMatch(/^Arbeitszeit-Tabelle_.*\.xlsx$/);
		click.mockRestore();
	});
});
