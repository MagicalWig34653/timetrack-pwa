import { expect, test, type Browser, type Download, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiCall as api, apiDownload, apiUpload, newActor as baseActor, registerViaInvite, type Actor } from './helpers';
import { buildXlsx, parseCsv, pdfText, readXlsx, zip } from './files';

// Stage-3b (export, import wizard, file storage, absence attachments) against the real Swift backend.
// One serial story on a fourth backend instance (E2E_TRANSFER_PORT, own SQLite DB, STORAGE_SECRET_KEY set, temp local dir).
// Alice (bootstrap admin) owns the data, Bob (invited, member) is the non-admin and the "foreign account".
test.describe.configure({ mode: 'serial' });

const BASE = `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 3}`;
test.use({ baseURL: BASE });
const newActor = (browser: Browser) => baseActor(browser, [], BASE);

// Fixed dates in 2026 (work model Mon-Fri 38:30 from 2026-01-05, Europe/Berlin).
const EXAMPLE_DAY = '2026-09-16'; // Wednesday: 08:07-12:00 + 13:00-16:02 -> raw 6:55, evaluated 7:15
const EXPORT_FROM = '2026-09-14';
const EXPORT_TO = '2026-09-18';
const MIB = 1024 * 1024;

let alice: Actor;
let bob: Actor;
const ids: Record<string, string> = {};

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
});

const german = (date: string) => date.split('-').reverse().join('.');

async function downloadOf(page: Page, click: () => Promise<void>): Promise<{ download: Download; bytes: Buffer }> {
	const [download] = await Promise.all([page.waitForEvent('download'), click()]);
	const file = await download.path();
	return { download, bytes: fs.readFileSync(file) };
}

test('two fresh accounts register via invite', async ({ browser }) => {
	alice = await newActor(browser);
	await registerViaInvite(alice, new URL(process.env.E2E_TRANSFER_BOOTSTRAP_LINK!).pathname, 'alice.xfer', 'Alice Transfer', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Transfer' })).toBeVisible();
	const invite = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	expect(invite.status).toBe(201);
	bob = await newActor(browser);
	await registerViaInvite(bob, `/invite/${invite.body.token}`, 'bob.xfer', 'Bob Transfer', 'Passkey');
	await bob.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(bob.page.getByRole('heading', { name: 'Hallo, Bob Transfer' })).toBeVisible();
});

test('work model 38:30 h and the ADR example day (08:07-12:00 + 13:00-16:02)', async () => {
	const { page } = alice;
	const model = await api(page, 'POST', '/api/v1/work-models', { validFrom: '2026-01-05', weeklyTargetSeconds: 138600, workdays: [1, 2, 3, 4, 5] });
	expect(model.status).toBe(201);
	// Berlin summer time: 08:07 local = 06:07Z
	for (const [start, end] of [
		['06:07:00Z', '10:00:00Z'],
		['11:00:00Z', '14:02:00Z']
	]) {
		const seg = await api(page, 'POST', '/api/v1/time/segments', { kind: 'work', startedAt: `${EXAMPLE_DAY}T${start}`, endedAt: `${EXAMPLE_DAY}T${end}` });
		expect(seg.status).toBe(201);
	}
	const day = await api(page, 'GET', `/api/v1/time/days/${EXAMPLE_DAY}`);
	expect(day.body).toMatchObject({ rawWorkSeconds: 24900, evaluatedWorkSeconds: 26100 });
});

async function openExport(page: Page, from = EXPORT_FROM, to = EXPORT_TO) {
	await page.goto('/export');
	await expect(page.getByRole('heading', { name: 'Export', exact: true })).toBeVisible();
	await page.getByLabel('Von').fill(from);
	await page.getByLabel('Bis').fill(to);
}

test('export CSV: downloads, comma table with actual vs evaluated values and a sum row', async () => {
	const { page } = alice;
	await openExport(page);
	await page.getByRole('radio', { name: /CSV/ }).check();
	const { download, bytes } = await downloadOf(page, () => page.getByRole('button', { name: 'Exportieren' }).click());
	expect(download.suggestedFilename()).toBe(`zeitnachweis_${EXPORT_FROM}_${EXPORT_TO}.csv`);
	await expect(page.getByTestId('export-done')).toContainText('Export erstellt: zeitnachweis_');
	const rows = parseCsv(bytes.toString('utf8'), ',');
	expect(rows[0]).toEqual(['Zeitnachweis']);
	expect(rows[1]).toEqual(['Name', 'Alice Transfer']);
	expect(rows[2]).toEqual(['Zeitraum', '14.09.2026 bis 18.09.2026']);
	const head = rows.find((r) => r[0] === 'Datum')!;
	expect(head).toEqual(expect.arrayContaining(['Beginn (tatsächlich)', 'Ende (tatsächlich)', 'Arbeitszeit tatsächlich', 'Arbeitszeit bewertet', 'Soll', 'Differenz']));
	const col = (name: string) => head.indexOf(name);
	const wed = rows.find((r) => r[0] === german(EXAMPLE_DAY))!;
	expect(wed[col('Wochentag')]).toBe('Mittwoch');
	// ADR example: raw 6:55, rounding +0:07 / +0:13, evaluated 7:15; the one-hour gap is not deducted
	expect(wed[col('Beginn (tatsächlich)')]).toBe('08:07');
	expect(wed[col('Ende (tatsächlich)')]).toBe('16:02');
	expect(wed[col('Arbeitszeit tatsächlich')]).toBe('6:55');
	expect(wed[col('Pausenabzug')]).toBe('0:00');
	expect(wed[col('Rundung Beginn')]).toBe('+0:07');
	expect(wed[col('Rundung Ende')]).toBe('+0:13');
	expect(wed[col('Arbeitszeit bewertet')]).toBe('7:15');
	expect(wed[col('Soll')]).toBe('7:42');
	expect(wed[col('Differenz')]).toBe('-0:27');
	// an empty day only has the target
	const mon = rows.find((r) => r[0] === german(EXPORT_FROM))!;
	expect(mon[col('Arbeitszeit bewertet')]).toBe('');
	expect(mon[col('Differenz')]).toBe('-7:42');
	const sum = rows.find((r) => r[0] === 'Summe')!;
	expect(sum[col('Arbeitszeit bewertet')]).toBe('7:15');
	expect(sum[col('Soll')]).toBe('38:30');
	expect(sum[col('Differenz')]).toBe('-31:15');
});

test('export XLSX: real workbook, durations are typed day fractions with [h]:mm, no formulas', async () => {
	const { page } = alice;
	await openExport(page);
	await page.getByRole('radio', { name: /Excel/ }).check();
	const { download, bytes } = await downloadOf(page, () => page.getByRole('button', { name: 'Exportieren' }).click());
	expect(download.suggestedFilename()).toBe(`zeitnachweis_${EXPORT_FROM}_${EXPORT_TO}.xlsx`);
	expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
	const wb = readXlsx(bytes);
	expect(wb.files).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']));
	expect(wb.sheetNames).toEqual(['Zeitnachweis']);
	expect(wb.sheetXml).not.toContain('<f>');
	expect(wb.cell('B2')?.value).toBe('Alice Transfer');
	// header row 6, Wednesday row 9
	const head = Object.fromEntries(wb.cells.filter((c) => /^[A-Z]+6$/.test(c.ref)).map((c) => [c.value, c.ref.replace('6', '')]));
	expect(Object.keys(head)).toEqual(expect.arrayContaining(['Datum', 'Arbeitszeit tatsächlich', 'Arbeitszeit bewertet', 'Soll', 'Differenz']));
	const at = (name: string, row = 9) => wb.cell(`${head[name]}${row}`);
	expect(at('Wochentag')?.value).toBe('Mittwoch');
	expect(Number(at('Datum')?.value)).toBe(46281); // 2026-09-16 as Excel serial
	expect(wb.formatOf(`${head['Datum']}9`)).toBe('dd\\.mm\\.yyyy');
	const day = (seconds: number) => seconds / 86400;
	expect(Number(at('Arbeitszeit tatsächlich')?.value)).toBeCloseTo(day(24900), 9);
	expect(Number(at('Arbeitszeit bewertet')?.value)).toBeCloseTo(day(26100), 9); // 7:15
	expect(Number(at('Soll')?.value)).toBeCloseTo(day(27720), 9); // 7:42
	expect(Number(at('Differenz')?.value)).toBeCloseTo(-day(1620), 9); // -0:27
	expect(Number(at('Beginn (tatsächlich)')?.value)).toBeCloseTo((8 * 60 + 7) / 1440, 9);
	expect(Number(at('Ende (tatsächlich)')?.value)).toBeCloseTo((16 * 60 + 2) / 1440, 9);
	expect(wb.formatOf(`${head['Arbeitszeit bewertet']}9`)).toBe('[h]:mm');
	expect(wb.formatOf(`${head['Beginn (tatsächlich)']}9`)).toBe('hh:mm');
	expect(wb.formatOf(`${head['Differenz']}9`)).toContain('[h]:mm');
	const sumRow = wb.cells.find((c) => c.value === 'Summe')!.ref.replace('A', '');
	expect(Number(at('Soll', Number(sumRow))?.value)).toBeCloseTo(day(138600), 9); // 38:30
});

test('export PDF: valid PDF with the expected text', async () => {
	const { page } = alice;
	await openExport(page);
	await page.getByRole('radio', { name: /PDF/ }).check();
	const { download, bytes } = await downloadOf(page, () => page.getByRole('button', { name: 'Exportieren' }).click());
	expect(download.suggestedFilename()).toBe(`zeitnachweis_${EXPORT_FROM}_${EXPORT_TO}.pdf`);
	expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
	expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
	const lines = pdfText(bytes).split('\n');
	for (const expected of ['Mittwoch', '08:07', '16:02', '6:55', '+0:07', '+0:13', '7:15', '7:42', '-0:27', '38:30', '-31:15', 'Seite 1 von 1']) {
		expect(lines, expected).toContain(expected);
	}
});

test('export: client range check and the server limit range_too_large (367 days)', async () => {
	const { page } = alice;
	await openExport(page, '2026-01-01', '2027-01-02'); // 367 days
	await page.getByRole('button', { name: 'Exportieren' }).click();
	await expect(page.getByText('Der Zeitraum ist länger als 366 Tage.')).toBeVisible();
	await openExport(page, '2026-01-01', '2026-12-31'); // 365 days is fine
	await page.getByRole('radio', { name: /CSV/ }).check();
	const ok = await downloadOf(page, () => page.getByRole('button', { name: 'Exportieren' }).click());
	expect(ok.bytes.length).toBeGreaterThan(100);
	// the server enforces it too
	const tooLong = await api(page, 'GET', '/api/v1/export/time?from=2026-01-01&to=2027-01-02&format=csv');
	expect(tooLong.status).toBe(400);
	expect(tooLong.body.error.code).toBe('range_too_large');
	// the server message is English; the PWA localizes by code (error.range_too_large)
	const reversed = await api(page, 'GET', '/api/v1/export/time?from=2026-02-02&to=2026-02-01&format=csv');
	expect(reversed.status).toBe(400);
});

// ---------------------------------------------------------------------------------------------------------------------
// Import wizard

const IMPORT_RANGE = 'from=2026-08-01T00:00:00Z&to=2026-08-31T23:59:59Z';
const csvBuffer = (lines: string[]) => Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');

// Semicolon, dd.MM.yyyy, HH:mm, with a summary row and three broken rows (overlap, impossible date, unreadable time).
const CSV_CLOCK = csvBuffer([
	'Datum;Beginn;Ende;Art;Notiz',
	'03.08.2026;08:00;12:00;Arbeit;Frühdienst',
	'03.08.2026;13:00;16:30;Arbeit;',
	'04.08.2026;08:00;12:00;Arbeit;',
	'04.08.2026;09:00;10:00;Arbeit;Doppelt belegt',
	'31.02.2026;08:00;12:00;Arbeit;',
	'05.08.2026;08:00;abc;Arbeit;',
	'Summe;;;;'
]);

// Decimal hours: 8,5 = 8:30 and 7,7 = 7:42 (not 7:07), 4,25 = 4:15.
const CSV_DECIMAL = csvBuffer(['Datum;Beginn;Dauer', '10.08.2026;8,5;7,7', '11.08.2026;9;4,25']);

async function importUpTo(page: Page, name: string, buffer: Buffer, mimeType: string, step: 'sheet' | 'mapping') {
	await page.goto('/import');
	await expect(page.getByTestId('step-heading')).toHaveText('Datei');
	await page.getByTestId('import-file').setInputFiles({ name, mimeType, buffer });
	await expect(page.getByTestId('picked-file')).toContainText(name);
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Blatt und Kopfzeile');
	if (step === 'sheet') return;
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Spalten');
}

async function toPreview(page: Page) {
	await page.getByRole('button', { name: 'Vorschau prüfen' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Vorschau');
}

async function segmentsIn(page: Page, range = IMPORT_RANGE) {
	return (await api(page, 'GET', `/api/v1/time/segments?${range}`)).body as any[];
}

test('import wizard (CSV): raw preview, suggested columns, preview with errors and a summary row', async () => {
	const { page } = alice;
	await importUpTo(page, 'zeiten.csv', CSV_CLOCK, 'text/csv', 'sheet');
	// raw preview shows the file as is
	await expect(page.getByText('Blatt: CSV')).toBeVisible();
	await expect(page.getByRole('table').first()).toContainText('03.08.2026');
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Spalten');
	// columns were suggested from the header names
	await expect(page.locator('#map-date')).toHaveValue('0');
	await expect(page.locator('#map-start')).toHaveValue('1');
	await expect(page.locator('#map-end')).toHaveValue('2');
	await expect(page.locator('#map-kind')).toHaveValue('3');
	await expect(page.locator('#map-note')).toHaveValue('4');
	await expect(page.getByTestId('probe')).toContainText('wird gelesen als');
	await toPreview(page);
	await expect(page.getByTestId('count-valid')).toHaveText('3');
	await expect(page.getByTestId('count-duplicates')).toHaveText('0');
	await expect(page.getByTestId('count-errors')).toHaveText('3');
	const errors = await page.getByTestId('error-table').locator('tr[data-code]').evaluateAll((rows) => rows.map((r) => [r.getAttribute('data-code'), r.querySelector('td')?.textContent?.trim()]));
	// row numbers are 1-based sheet rows (header = 1)
	expect(errors).toEqual([
		['overlap', '5'],
		['date_invalid', '6'],
		['time_invalid', '7']
	]);
	await expect(page.getByTestId('error-table')).toContainText('Das Datum ist nicht lesbar.');
	await expect(page.getByTestId('error-table')).toContainText('überschneidet sich');
	await expect(page.getByTestId('error-table')).toContainText('Uhrzeit oder Dauer ist nicht lesbar');
	await expect(page.getByTestId('sample-table').locator('tbody tr')).not.toHaveCount(0);
	// nothing is written before the explicit confirmation
	expect(await segmentsIn(page)).toHaveLength(0);
});

test('import wizard: only an explicit confirmation (and an explicit error skip) commits', async () => {
	const { page } = alice;
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Bestätigen');
	await expect(page.getByTestId('confirm-summary')).toContainText('3 neue Einträge werden angelegt, 0 Duplikate übersprungen.');
	const commit = page.getByTestId('commit');
	await expect(commit).toBeDisabled();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await expect(commit).toBeDisabled(); // error rows must be skipped explicitly as well
	await page.getByLabel(/Fehlerzeilen überspringen/).check();
	await expect(commit).toBeEnabled();
	expect(await segmentsIn(page)).toHaveLength(0);
	await commit.click();
	await expect(page.getByTestId('step-heading')).toHaveText('Ergebnis');
	await expect(page.getByTestId('result-created')).toHaveText('3 Einträge angelegt');
	await expect(page.getByTestId('result-skipped')).toContainText('3 übersprungen');
	const segs = await segmentsIn(page);
	expect(segs).toHaveLength(3);
	expect(segs.every((s) => s.source === 'import' && s.kind === 'work' && s.version === 1)).toBe(true);
	// Berlin summer time: 08:00-12:00 local = 06:00-10:00Z
	expect(segs.map((s) => [s.startedAt, s.endedAt]).sort()[0]).toEqual(['2026-08-03T06:00:00Z', '2026-08-03T10:00:00Z']);
	expect(segs.find((s) => s.note === 'Frühdienst')).toBeTruthy();
});

test('import rollback voids the batch; the same file can then be imported again', async () => {
	const { page } = alice;
	await page.getByTestId('rollback').click();
	await page.getByTestId('rollback-confirm').click();
	await expect(page.getByTestId('rolled-back')).toBeVisible();
	expect(await segmentsIn(page)).toHaveLength(0);
	// after a rollback the file is no duplicate any more
	await importUpTo(page, 'zeiten.csv', CSV_CLOCK, 'text/csv', 'mapping');
	await toPreview(page);
	await expect(page.getByTestId('count-valid')).toHaveText('3');
	await expect(page.getByTestId('count-duplicates')).toHaveText('0');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByLabel(/Fehlerzeilen überspringen/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toHaveText('3 Einträge angelegt');
	expect(await segmentsIn(page)).toHaveLength(3);
});

test('import is idempotent: the same file again only reports duplicates and skips them', async () => {
	const { page } = alice;
	await importUpTo(page, 'zeiten.csv', CSV_CLOCK, 'text/csv', 'mapping');
	await toPreview(page);
	await expect(page.getByTestId('count-valid')).toHaveText('0');
	await expect(page.getByTestId('count-duplicates')).toHaveText('3');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByLabel(/Fehlerzeilen überspringen/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toHaveText('0 Einträge angelegt');
	await expect(page.getByTestId('result-skipped')).toContainText('6 übersprungen');
	await expect(page.getByText('Wahrscheinlich war die Datei schon importiert.')).toBeVisible();
	expect(await segmentsIn(page)).toHaveLength(3);
});

test('import wizard (XLSX built in the test): second sheet, header row, saved template', async () => {
	const { page } = alice;
	const xlsx = buildXlsx([
		{ name: 'Info', rows: [['Hinweis', 'Nur zur Information']] },
		{
			name: 'Zeiten',
			rows: [
				['Datum', 'Beginn', 'Ende', 'Art'],
				['17.08.2026', '07:30', '11:45', 'Arbeit'],
				['17.08.2026', '12:30', '15:00', 'Fahrt'],
				['18.08.2026', '08:00', '14:00', 'Schule']
			]
		}
	]);
	await importUpTo(page, 'zeiten.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'sheet');
	// two sheets: choose the second; raw preview switches
	await page.locator('#sheet-select').selectOption('Zeiten');
	await expect(page.getByRole('table').first()).toContainText('17.08.2026');
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Spalten');
	await expect(page.locator('#map-date')).toHaveValue('0');
	await expect(page.locator('#map-end')).toHaveValue('2');
	// save the mapping as a template
	await page.locator('#template-name').fill('Excel Zeiten');
	await page.getByRole('button', { name: 'Als Vorlage speichern' }).click();
	await expect(page.getByTestId('import-notice')).toContainText('Vorlage „Excel Zeiten“ gespeichert.');
	const templates = await api(page, 'GET', '/api/v1/import-templates');
	expect(templates.body).toHaveLength(1);
	expect(templates.body[0]).toMatchObject({ name: 'Excel Zeiten', mapping: { sheet: 'Zeiten', dateFormat: 'dd.MM.yyyy', timeFormat: 'HH:mm', columns: { date: 0, start: 1, end: 2, kind: 3 } } });
	await toPreview(page);
	await expect(page.getByTestId('count-valid')).toHaveText('3');
	await expect(page.getByTestId('count-errors')).toHaveText('0');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await expect(page.getByLabel(/Fehlerzeilen überspringen/)).toHaveCount(0); // no errors: no extra checkbox
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toHaveText('3 Einträge angelegt');
	await expect(page.getByTestId('result-skipped')).toContainText('0 übersprungen');
	const segs = (await segmentsIn(page)).filter((s) => s.startedAt.startsWith('2026-08-1'));
	expect(segs.map((s) => s.kind).sort()).toEqual(['school', 'travel', 'work']);
	expect(segs.find((s) => s.kind === 'work')).toMatchObject({ startedAt: '2026-08-17T05:30:00Z', endedAt: '2026-08-17T09:45:00Z' });
	// imported XLSX again: pure duplicates
	await importUpTo(page, 'zeiten.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'sheet');
	await page.locator('#sheet-select').selectOption('Zeiten');
	await page.getByRole('button', { name: 'Weiter' }).click();
	await toPreview(page);
	await expect(page.getByTestId('count-duplicates')).toHaveText('3');
	await expect(page.getByTestId('count-valid')).toHaveText('0');
	// leaving without committing discards nothing but also writes nothing
	await page.getByRole('button', { name: 'Import verwerfen' }).click();
	await expect(page.getByTestId('import-notice')).toContainText('verworfen');
	expect(await segmentsIn(page)).toHaveLength(6);
});

test('import wizard: decimal hours 7,7 are 7:42 (not 7:07); templates can be applied and deleted', async () => {
	const { page } = alice;
	await importUpTo(page, 'dezimal.csv', CSV_DECIMAL, 'text/csv', 'mapping');
	await expect(page.locator('#map-duration')).toHaveValue('2'); // "Dauer" header suggests duration mode
	await page.locator('#time-format').selectOption('decimal_hours');
	await expect(page.getByTestId('decimal-hours-note')).toContainText('7,7 Stunden sind 7:42 und nicht 7:07');
	await expect(page.getByTestId('probe')).toContainText('„7,7“ wird gelesen als 7:42');
	await expect(page.getByTestId('probe')).toContainText('„8,5“ wird gelesen als 8:30');
	// save as template for later
	await page.locator('#template-name').fill('Dezimalstunden');
	await page.getByRole('button', { name: 'Als Vorlage speichern' }).click();
	await expect(page.getByTestId('import-notice')).toContainText('Dezimalstunden');
	await toPreview(page);
	await expect(page.getByTestId('count-valid')).toHaveText('2');
	const sample = page.getByTestId('sample-table').locator('tbody tr');
	await expect(sample.first()).toContainText('7:42');
	await expect(page.getByTestId('sample-table')).not.toContainText('7:07');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toHaveText('2 Einträge angelegt');
	const segs = (await segmentsIn(page)).filter((s) => s.startedAt.startsWith('2026-08-10') || s.startedAt.startsWith('2026-08-11'));
	segs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
	// 8,5 h = 08:30 local = 06:30Z, + 7,7 h = 7:42 -> 16:12 local = 14:12Z
	expect([segs[0].startedAt, segs[0].endedAt]).toEqual(['2026-08-10T06:30:00Z', '2026-08-10T14:12:00Z']);
	// 9 h + 4,25 h = 4:15
	expect([segs[1].startedAt, segs[1].endedAt]).toEqual(['2026-08-11T07:00:00Z', '2026-08-11T11:15:00Z']);
	ids.decimalSegment = segs[0].id;
	ids.decimalSegmentSecond = segs[1].id;

	// templates: a new upload, apply the decimal template (formats switch), delete the Excel template
	await importUpTo(page, 'dezimal.csv', CSV_DECIMAL, 'text/csv', 'mapping');
	await expect(page.locator('#time-format')).toHaveValue('HH:mm');
	await page.locator('#template-select').selectOption({ label: 'Dezimalstunden' });
	await page.getByRole('button', { name: 'Anwenden' }).click();
	await expect(page.getByTestId('import-notice')).toContainText('Vorlage „Dezimalstunden“ angewendet.');
	await expect(page.locator('#time-format')).toHaveValue('decimal_hours');
	await page.locator('#template-select').selectOption({ label: 'Excel Zeiten' });
	await page.getByRole('button', { name: 'Vorlage löschen' }).click();
	await expect(page.getByTestId('import-notice')).toContainText('Vorlage gelöscht.');
	const left = await api(page, 'GET', '/api/v1/import-templates');
	expect(left.body.map((x: any) => x.name)).toEqual(['Dezimalstunden']);
	await page.getByRole('button', { name: 'Import verwerfen' }).first().click();
	await expect(page.getByTestId('step-heading')).toHaveText('Datei');
});

test('import rollback conflict: editing an imported segment blocks the rollback and lists it', async () => {
	const { page } = alice;
	// a third decimal-hours import for fresh days, then edit one of its segments
	const csv = csvBuffer(['Datum;Beginn;Dauer', '24.08.2026;8;3,5', '25.08.2026;8;2']);
	await importUpTo(page, 'konflikt.csv', csv, 'text/csv', 'mapping');
	await page.locator('#time-format').selectOption('decimal_hours');
	await toPreview(page);
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toHaveText('2 Einträge angelegt');
	const imported = (await segmentsIn(page)).filter((s) => s.startedAt.startsWith('2026-08-24') || s.startedAt.startsWith('2026-08-25'));
	expect(imported).toHaveLength(2);
	const edited = imported.find((s) => s.startedAt.startsWith('2026-08-24'))!;
	const patch = await api(page, 'PATCH', `/api/v1/time/segments/${edited.id}`, { reason: 'Nachträglich korrigiert', note: 'geändert' }, { 'If-Match': String(edited.version) });
	expect(patch.status).toBe(200);
	await page.getByTestId('rollback').click();
	await page.getByTestId('rollback-confirm').click();
	await expect(page.getByTestId('import-error')).toContainText('kann nicht zurückgenommen werden');
	await expect(page.getByTestId('rollback-conflicts')).toContainText('Diese 1 Einträge wurden seit dem Import geändert.');
	await expect(page.getByTestId('rollback-conflicts')).toContainText(edited.id);
	await expect(page.getByTestId('rolled-back')).toHaveCount(0);
	// nothing was changed: both segments are still there, the edited one keeps its note
	const after = (await segmentsIn(page)).filter((s) => s.startedAt.startsWith('2026-08-24') || s.startedAt.startsWith('2026-08-25'));
	expect(after).toHaveLength(2);
	expect(after.find((s) => s.id === edited.id)?.note).toBe('geändert');
});

test('import: unreadable, unsuitable and oversize uploads give German messages', async () => {
	const { page } = alice;
	const upload = async (name: string, bytes: Buffer) => {
		await page.goto('/import');
		await page.getByTestId('import-file').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
		return page.getByRole('button', { name: 'Weiter' });
	};
	// text that is no ZIP, binary data as CSV: the server refuses by content (415)
	for (const [name, bytes] of [
		['kaputt.xlsx', Buffer.from('das ist kein zip')],
		['binaer.csv', Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, 0, 7, 8, 9])]
	] as [string, Buffer][]) {
		await (await upload(name, bytes)).click();
		await expect(page.getByTestId('import-error')).toHaveText('Dieser Dateityp wird nicht angenommen.');
		await expect(page.getByTestId('step-heading')).toHaveText('Datei');
	}
	// a ZIP that is no workbook
	const probe = await apiUpload(page, '/api/v1/imports', 'leer.xlsx', Buffer.from(zip({ 'readme.txt': 'hallo' })));
	expect(probe.status).toBe(415);
	expect(probe.body.error.code).toBe('unsupported_type');
	// client side checks (before any upload)
	await upload('doc.txt', Buffer.from('x'));
	await expect(page.getByTestId('import-error')).toHaveText('Es werden nur CSV- und XLSX-Dateien angenommen.');
	await upload('gross.csv', Buffer.alloc(5 * MIB + 1024, 'a'));
	await expect(page.getByTestId('import-error')).toHaveText('Die Datei ist größer als 5 MiB.');
	// the server enforces the limit too
	const big = await apiUpload(page, '/api/v1/imports', 'gross.csv', Buffer.alloc(5 * MIB + 1024, 'a'));
	expect(big.status).toBe(413);
	expect(big.body.error.code).toBe('file_too_large');
});
