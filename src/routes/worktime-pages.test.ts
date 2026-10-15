import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSimpleWorkbook, buildWorktimeWorkbook } from '../../mock/worktime-xlsx.ts';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
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

async function openProfileStep(file: File = workbook()) {
	const u = user();
	await u.upload(screen.getByTestId('import-file'), file);
	await u.click(screen.getByRole('button', { name: 'Weiter' }));
	await screen.findByRole('heading', { name: 'Blatt und Kopfzeile' });
	return u;
}

describe('worktime import wizard', () => {
	it('shows the profile banner, replaces the column step by the profile step and can switch to the generic wizard', async () => {
		render(ImportWizard);
		const u = await openProfileStep();
		expect(screen.getByTestId('profile-banner')).toHaveTextContent('Arbeitszeit-Tabelle erkannt');
		expect(screen.queryByTestId('no-header')).toBeNull();
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Arbeitszeit-Tabelle' });
		expect(screen.getByTestId('worktime-step')).toBeInTheDocument();
		await u.click(screen.getByRole('button', { name: 'Zurück' }));
		await u.click(screen.getByTestId('profile-switch-generic'));
		expect(screen.getByTestId('profile-banner-generic')).toBeInTheDocument();
		expect(screen.getByTestId('no-header')).toBeInTheDocument();
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Spalten' });
	});

	it('does not show the banner for a generic workbook', async () => {
		render(ImportWizard);
		const u = user();
		await u.upload(screen.getByTestId('import-file'), new File([buildSimpleWorkbook('Tabelle1', [['Datum', 'Beginn', 'Ende'], ['03.03.2026', '8:00', '9:00']]) as BlobPart], 'z.xlsx'));
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByRole('heading', { name: 'Blatt und Kopfzeile' });
		expect(screen.queryByTestId('profile-banner')).toBeNull();
	});

	it('edits the rule table (add, reorder, remove, reset) and validates the rules', async () => {
		render(ImportWizard);
		const u = await openProfileStep();
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByTestId('worktime-step');
		expect(screen.getByTestId('wt-rules-intro')).toHaveTextContent('die erste passende Regel gilt');
		expect(screen.getByTestId('wt-rules-absence-note')).toHaveTextContent('nicht als Arbeitszeit');
		const rows = () => screen.getAllByTestId('wt-rule');
		expect(rows()).toHaveLength(6);
		expect((within(rows()[1]).getByLabelText('Text') as HTMLInputElement).value).toBe('freigestellt');
		await u.click(screen.getByRole('button', { name: 'Regel 2 nach oben' }));
		expect((within(rows()[0]).getByLabelText('Text') as HTMLInputElement).value).toBe('freigestellt');
		await u.click(screen.getByRole('button', { name: 'Regel 1 entfernen' }));
		expect(rows()).toHaveLength(5);
		await u.click(screen.getByTestId('wt-rule-add'));
		expect(rows()).toHaveLength(6);
		await u.click(screen.getByTestId('wt-validate'));
		expect(screen.getByTestId('mapping-issues')).toHaveTextContent('Regel 6: Der Text fehlt.');
		await u.click(screen.getByTestId('wt-rules-reset'));
		await waitFor(() => expect(rows()).toHaveLength(6));
		expect((within(rows()[0]).getByLabelText('Text') as HTMLInputElement).value).toBe('krank');
		expect(mock.calls.some((c) => c.path.endsWith('/import-profiles/worktime/default-rules'))).toBe(true);
	});

	it('validates, explains the preview, creates a rule for an unmapped remark and commits with absences', async () => {
		render(ImportWizard);
		const u = await openProfileStep();
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByTestId('worktime-step');
		await u.click(screen.getByTestId('wt-validate'));
		await screen.findByTestId('worktime-preview');
		expect(screen.getByTestId('wt-count-segments')).toHaveTextContent('5');
		expect(screen.getByTestId('wt-count-absences')).toHaveTextContent('2');
		expect(screen.getByTestId('wt-date-system')).toHaveTextContent('1900');
		expect(screen.getByTestId('wt-balance')).toHaveTextContent('Zeitkonto laut Tabelle');
		expect(screen.getByTestId('wt-balance')).toHaveTextContent('rundet nicht');
		expect(screen.getByTestId('wt-by-action')).toHaveTextContent('Freigestellt (bezahlt frei): 1');
		// pause_exceeds_day is a warning: it does not count as error
		expect(screen.getByTestId('count-errors')).toHaveTextContent('0');
		expect(screen.getByTestId('error-table').querySelector('[data-warning="true"]')).not.toBeNull();
		const unmapped = screen.getByTestId('wt-unmapped');
		expect(unmapped).toHaveTextContent('Arzttermin');
		await u.click(within(unmapped).getByRole('button', { name: 'Regel für „Arzttermin“ anlegen' }));
		await waitFor(() => expect(screen.queryByTestId('wt-unmapped')).toBeNull());
		expect(screen.getByTestId('import-notice')).toHaveTextContent('Regel angelegt');

		await u.click(screen.getByRole('button', { name: 'Weiter zur Bestätigung' }));
		expect(await screen.findByTestId('confirm-summary')).toHaveTextContent('2 Abwesenheiten');
		await u.click(screen.getByLabelText(/Ich habe die Vorschau/));
		await u.click(screen.getByTestId('commit'));
		expect(await screen.findByTestId('result-absences')).toHaveTextContent('2 Abwesenheiten angelegt');
		expect(await api.listAbsences('2026-03-01', '2026-03-31')).toHaveLength(2);
	});

	it('shows a typed conflict list when the rollback is refused', async () => {
		render(ImportWizard);
		const u = await openProfileStep();
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByTestId('worktime-step');
		await u.click(screen.getByTestId('wt-validate'));
		await screen.findByTestId('worktime-preview');
		await u.click(screen.getByRole('button', { name: 'Weiter zur Bestätigung' }));
		await u.click(screen.getByLabelText(/Ich habe die Vorschau/));
		await u.click(screen.getByTestId('commit'));
		await screen.findByTestId('result-created');
		const [first] = await api.listAbsences('2026-03-01', '2026-03-31');
		await api.updateAbsence(first.id, { kind: first.kind, startDate: first.startDate, endDate: first.endDate, status: first.status, note: 'x' }, first.version);
		await u.click(screen.getByTestId('rollback'));
		await u.click(screen.getByTestId('rollback-confirm'));
		const list = await screen.findByTestId('rollback-conflicts');
		expect(list).toHaveTextContent('Abwesenheit');
		expect(list.querySelector('[data-conflict-type="absence"]')).not.toBeNull();
	});

	it('stores and re-applies the worktime options as a template', async () => {
		render(ImportWizard);
		const u = await openProfileStep();
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByTestId('worktime-step');
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
	});
});

describe('worktime import wizard: holiday times, partial credit, balance split and model start (C23)', () => {
	async function toPreview(u: ReturnType<typeof user>) {
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByTestId('worktime-step');
		await u.click(screen.getByTestId('wt-validate'));
		await screen.findByTestId('worktime-preview');
	}
	const warning = (code: string) => screen.queryByTestId('wt-warnings')?.querySelector(`[data-code="${code}"]`) ?? null;

	it('defaults to discarding holiday times and importing partial credits as work', async () => {
		render(ImportWizard);
		const u = await openProfileStep(c23Workbook());
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByTestId('worktime-step');
		expect(screen.getByTestId('wt-holiday-discard')).toBeChecked();
		expect(screen.getByTestId('wt-credit-work')).toBeChecked();
		expect(screen.getByTestId('wt-day-options')).toHaveTextContent('Mehrarbeit');
		expect(screen.getByTestId('wt-day-options')).toHaveTextContent('Freigestellt mit wenigen Stunden');
	});

	it('lists the warnings with day counts and a short explanation, splits the balance and points to the model start', async () => {
		render(ImportWizard);
		const u = await openProfileStep(c23Workbook());
		await toPreview(u);
		expect(warning('holiday_times_discarded')).toHaveTextContent('1 Tage');
		expect(warning('school_on_holiday')).toHaveTextContent('Schulzeiten an Feiertagen nicht übernommen');
		expect(warning('credit_partial_as_work')).toHaveAttribute('data-count', '1');
		expect(warning('credit_partial_as_work')).toHaveTextContent('Was bedeutet das?');
		expect(screen.getByTestId('wt-count-segments')).toHaveTextContent(/^[1-9]/);
		expect(screen.getByTestId('wt-balance-value')).toHaveTextContent('-5:12');
		expect(screen.getByTestId('wt-balance-future')).toHaveTextContent('-4:12');
		expect(screen.getByTestId('wt-balance-total')).toHaveTextContent('-9:24');
		const hint = screen.getByTestId('wt-model-start');
		await waitFor(() => expect(hint).toBeInTheDocument());
		expect(hint).toHaveAttribute('data-kind', 'earlier');
		expect(hint).toHaveTextContent('17.09.2026');
		expect(screen.getByTestId('wt-model-start-link')).toHaveAttribute('href', '/settings/work-model?validFrom=2026-09-17');
	});

	it('switching to "keep" and "as absence" removes the warnings and is stored in a template', async () => {
		render(ImportWizard);
		const u = await openProfileStep(c23Workbook());
		await u.click(screen.getByRole('button', { name: 'Weiter' }));
		await screen.findByTestId('worktime-step');
		await u.click(screen.getByTestId('wt-holiday-keep'));
		await u.click(screen.getByTestId('wt-credit-absence'));
		await u.type(screen.getByLabelText('Name der neuen Vorlage'), 'C23');
		await u.click(screen.getByRole('button', { name: 'Als Vorlage speichern' }));
		await screen.findByTestId('import-notice');
		expect((await api.listImportTemplates())[0].mapping.worktime).toMatchObject({ holidayTimes: 'keep', partialCredit: 'absence' });
		await u.click(screen.getByTestId('wt-validate'));
		await screen.findByTestId('worktime-preview');
		expect(screen.queryByTestId('wt-warnings')).toBeNull();
		expect(screen.getByTestId('wt-count-absences')).toHaveTextContent('2');
	});

	it('shows the aggregated warnings again in the confirmation and in the result', async () => {
		render(ImportWizard);
		const u = await openProfileStep(c23Workbook());
		await toPreview(u);
		await u.click(screen.getByRole('button', { name: 'Weiter zur Bestätigung' }));
		expect(screen.getByTestId('confirm-warnings').querySelector('[data-code="school_on_holiday"]')).not.toBeNull();
		await u.click(screen.getByLabelText(/Ich habe die Vorschau/));
		await u.click(screen.getByTestId('commit'));
		const result = await screen.findByTestId('result-warnings');
		expect(result.querySelector('[data-code="holiday_times_discarded"]')).toHaveAttribute('data-count', '1');
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
