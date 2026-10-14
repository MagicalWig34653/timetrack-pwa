import { expect, test, type Browser, type Download, type Page } from '@playwright/test';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
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

// ---------------------------------------------------------------------------------------------------------------------
// File storage administration, uploads and absence attachments

const LOCAL_DIR = () => process.env.E2E_STORAGE_LOCAL_DIR!;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBytes = (size: number) => Buffer.concat([PNG_MAGIC, randomBytes(size - PNG_MAGIC.length)]);
const textBytes = (size: number) => Buffer.from('Zeile mit Text fuer den Speichertest.\n'.repeat(Math.ceil(size / 38)), 'ascii').subarray(0, size);

/** Files below the local storage directory: [relative path, size]. */
function localFiles(): [string, number][] {
	const out: [string, number][] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else out.push([path.relative(LOCAL_DIR(), full), fs.statSync(full).size]);
		}
	};
	walk(LOCAL_DIR());
	return out;
}

const ruleRow = (page: Page, n: number) => ({
	amount: page.getByLabel(`Größe ${n}`, { exact: true }),
	unit: page.getByLabel(`Einheit ${n}`, { exact: true }),
	backend: page.getByLabel(`Speicherort ${n}`, { exact: true })
});

test('storage admin: a non-admin sees a hint (UI) and gets 403 (API)', async () => {
	const { page } = bob;
	await page.goto('/settings/storage');
	await expect(page.getByTestId('storage-forbidden')).toHaveText('Der Dateispeicher kann nur von Administratoren eingestellt werden.');
	await expect(page.getByRole('link', { name: 'Dateispeicher' })).toHaveCount(0);
	await expect(page.getByLabel('Verzeichnis auf dem Server')).toHaveCount(0);
	expect((await api(page, 'GET', '/api/v1/admin/storage')).status).toBe(403);
	expect((await api(page, 'PUT', '/api/v1/admin/storage', { rules: [{ backend: 'db' }] })).status).toBe(403);
	// the admin sees the navigation entry
	await alice.page.goto('/settings/work-model');
	await expect(alice.page.getByRole('link', { name: 'Dateispeicher' })).toBeVisible();
});

test('storage admin: validation, then rules "up to 1 MiB -> database, above -> local path" are saved', async () => {
	const { page } = alice;
	const initial = await api(page, 'GET', '/api/v1/admin/storage');
	expect(initial.status).toBe(200);
	expect(initial.body).toMatchObject({ hasSecret: false, maxUploadBytes: 10 * MIB });
	expect(initial.body.rules).toEqual([{ backend: 'db' }]);

	await page.goto('/settings/storage');
	await expect(page.getByTestId('storage-only-new')).toContainText('Änderungen gelten nur für neue Uploads');
	await page.getByRole('button', { name: 'Regel hinzufügen' }).click();
	await ruleRow(page, 1).amount.fill('1');
	await ruleRow(page, 1).unit.selectOption('MiB');
	await ruleRow(page, 1).backend.selectOption('db');
	await page.getByLabel('Speicherort für alle größeren Dateien').selectOption('local');
	// a local rule without a directory is refused before anything is sent
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-error')).toHaveText('Bitte korrigiere die markierten Felder.');
	await expect(page.getByText('Gib das Verzeichnis an, weil eine Regel „Lokaler Pfad“ verwendet.')).toBeVisible();
	// the server refuses a directory that does not exist
	await page.getByLabel('Verzeichnis auf dem Server').fill(path.join(LOCAL_DIR(), 'gibt-es-nicht'));
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-error')).toHaveText('Die Eingaben sind ungültig.');
	expect((await api(page, 'GET', '/api/v1/admin/storage')).body.rules).toEqual([{ backend: 'db' }]);
	await page.getByLabel('Verzeichnis auf dem Server').fill(LOCAL_DIR());
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-saved')).toContainText('Einstellungen gespeichert');
	const saved = await api(page, 'GET', '/api/v1/admin/storage');
	expect(saved.body.rules).toEqual([{ maxBytes: MIB, backend: 'db' }, { backend: 'local' }]);
	expect(saved.body.localPath).toBe(LOCAL_DIR());
	// a reload shows the saved rules
	await page.reload();
	await expect(ruleRow(page, 1).amount).toHaveValue('1');
	await expect(ruleRow(page, 1).unit).toHaveValue('MiB');
	await expect(page.getByLabel('Speicherort für alle größeren Dateien')).toHaveValue('local');
	await expect(page.getByLabel('Verzeichnis auf dem Server')).toHaveValue(LOCAL_DIR());
});

test('uploads follow the rules: <= 1 MiB -> database, above -> local path; downloads equal the upload', async () => {
	const { page } = alice;
	const small = textBytes(1024);
	const edge = textBytes(MIB); // exactly the limit still belongs to the first rule
	const big = textBytes(MIB + 1);
	const bigger = pngBytes(Math.floor(1.5 * MIB));
	const up = async (name: string, bytes: Buffer, type: string) => {
		const res = await apiUpload(page, '/api/v1/files', name, bytes, type);
		expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(201);
		return res.body;
	};
	const a = await up('klein.txt', small, 'text/plain');
	const b = await up('grenze.txt', edge, 'text/plain');
	const c = await up('gross.txt', big, 'text/plain');
	const d = await up('bild.png', bigger, 'image/png');
	expect([a.backend, b.backend, c.backend, d.backend]).toEqual(['db', 'db', 'local', 'local']);
	expect(a).toMatchObject({ name: 'klein.txt', size: 1024 });
	expect(a.contentType).toMatch(/^text\/plain/);
	expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
	Object.assign(ids, { fileSmall: a.id, fileBig: c.id, filePng: d.id });
	for (const [meta, bytes] of [[a, small], [b, edge], [c, big], [d, bigger]] as const) {
		const dl = await apiDownload(page, `/api/v1/files/${meta.id}`);
		expect(dl.status).toBe(200);
		expect(dl.body.equals(bytes)).toBe(true);
		expect(dl.headers['content-disposition']).toContain('attachment');
		expect(dl.headers['x-content-type-options']).toBe('nosniff');
		expect(dl.headers['cache-control']).toContain('no-store');
	}
	// the local files really are on disk with identical content; the database files are not
	const onDisk = localFiles();
	expect(onDisk.map(([, size]) => size).sort((x, y) => x - y)).toEqual([big.length, bigger.length].sort((x, y) => x - y));
	const bigOnDisk = onDisk.find(([, size]) => size === bigger.length)!;
	expect(fs.readFileSync(path.join(LOCAL_DIR(), bigOnDisk[0])).equals(bigger)).toBe(true);
	// storage keys are sharded and carry no user filename
	expect(onDisk.every(([rel]) => /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f-]{36}$/.test(rel))).toBe(true);
});

const goToYear = async (page: Page, testId: string, year: number) => {
	for (let i = 0; i < 6 && (await page.getByTestId(testId).textContent())?.trim() !== String(year); i++) {
		const now = Number((await page.getByTestId(testId).textContent())?.trim());
		await page.getByRole('button', { name: now > year ? 'Vorjahr' : 'Folgejahr' }).click();
		await page.waitForTimeout(150);
	}
	await expect(page.getByTestId(testId)).toHaveText(String(year));
};

/** Opens the edit form of the sick absence in the UI (year 2026) and returns the attachments section. */
async function openAbsenceEditor(page: Page) {
	await page.goto('/absences');
	await goToYear(page, 'absences-year', 2026);
	await page.getByTestId('absence-row').filter({ hasText: '02.11.2026' }).getByRole('button', { name: 'Bearbeiten' }).click();
	const section = page.getByTestId('attachments');
	await expect(section).toBeVisible();
	await expect(section.getByTestId('attachments-never-shared')).toContainText('Anhänge werden nie geteilt');
	return section;
}

async function setUploadLimitInUi(page: Page, amount: string, unit: string) {
	await page.goto('/settings/storage');
	await page.getByLabel('Maximale Uploadgröße', { exact: true }).fill(amount);
	await page.getByLabel('Einheit der maximalen Uploadgröße').selectOption(unit);
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-saved')).toBeVisible();
}

test('changing the rules only affects new uploads; existing files keep their backend and stay readable', async () => {
	const { page } = alice;
	await page.goto('/settings/storage');
	await page.getByRole('button', { name: 'Regel 1 entfernen' }).click();
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-saved')).toBeVisible();
	expect((await api(page, 'GET', '/api/v1/admin/storage')).body.rules).toEqual([{ backend: 'local' }]);

	const bytes = textBytes(2048);
	const created = await apiUpload(page, '/api/v1/files', 'neu-klein.txt', bytes, 'text/plain');
	expect(created.status).toBe(201);
	expect(created.body.backend).toBe('local'); // the same size went to the database before the change
	ids.fileNewLocal = created.body.id;

	// sick absence with both files attached: the list tells which backend holds which file
	const absence = await api(page, 'POST', '/api/v1/absences', {
		kind: 'sick',
		startDate: '2026-11-02',
		endDate: '2026-11-03',
		status: 'approved',
		note: 'Geheime-Krankennotiz-xfer',
		documentStatus: 'pending'
	});
	expect(absence.status).toBe(201);
	ids.absence = absence.body.id;
	for (const fileId of [ids.fileSmall, ids.fileNewLocal]) {
		expect((await api(page, 'POST', `/api/v1/absences/${ids.absence}/attachments`, { fileId })).status).toBe(201);
	}
	const list = await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`);
	expect(list.body.map((f: any) => [f.name, f.backend]).sort()).toEqual([
		['klein.txt', 'db'],
		['neu-klein.txt', 'local']
	]);
	const old = await apiDownload(page, `/api/v1/files/${ids.fileSmall}`);
	expect(old.status).toBe(200);
	expect(old.body.length).toBe(1024);
	// attaching twice is idempotent
	expect((await api(page, 'POST', `/api/v1/absences/${ids.absence}/attachments`, { fileId: ids.fileSmall })).status).toBe(201);
	expect((await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`)).body).toHaveLength(2);
});

test('absence attachment in the UI: upload, list, download equals the bytes, remove', async () => {
	const { page } = alice;
	const section = await openAbsenceEditor(page);
	await expect(section.getByTestId('attachment')).toHaveCount(2);
	const png = pngBytes(1500);
	await section.getByTestId('attachment-file').setInputFiles({ name: 'krankmeldung.png', mimeType: 'image/png', buffer: png });
	await expect(section.getByTestId('attachment-picked')).toContainText('krankmeldung.png (1,5 KiB)');
	await section.getByRole('button', { name: 'Hochladen' }).click();
	await expect(section.getByTestId('attachment-notice')).toHaveText('Anhang hochgeladen.');
	await expect(section.getByTestId('attachment')).toHaveCount(3);
	const row = section.getByTestId('attachment').filter({ hasText: 'krankmeldung.png' });
	await expect(row).toContainText('1,5 KiB');
	// download equals the uploaded bytes
	const { download, bytes } = await downloadOf(page, () => row.getByRole('button', { name: 'krankmeldung.png herunterladen' }).click());
	expect(download.suggestedFilename()).toBe('krankmeldung.png');
	expect(bytes.equals(png)).toBe(true);
	// the API agrees (and the PWA stored it by the current rule: local)
	const apiList = await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`);
	const meta = apiList.body.find((f: any) => f.name === 'krankmeldung.png');
	expect(meta).toMatchObject({ size: 1500, contentType: 'image/png', backend: 'local' });
	ids.filePngUi = meta.id;
	// remove: link and file are gone
	await row.getByRole('button', { name: 'krankmeldung.png entfernen' }).click();
	await expect(section.getByTestId('attachment-notice')).toHaveText('Anhang entfernt.');
	await expect(section.getByTestId('attachment')).toHaveCount(2);
	expect((await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`)).body.map((f: any) => f.name)).not.toContain('krankmeldung.png');
	expect((await apiDownload(page, `/api/v1/files/${ids.filePngUi}`)).status).toBe(404);
});

test('attachments: a PNG named .pdf, an unknown type, an empty and an oversize file are refused in German', async () => {
	const { page } = alice;
	const section = await openAbsenceEditor(page);
	const before = (await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`)).body.length;
	const input = section.getByTestId('attachment-file');
	// type spoof: the extension says pdf, the content is a PNG -> the server refuses (415)
	await input.setInputFiles({ name: 'krank.pdf', mimeType: 'application/pdf', buffer: pngBytes(800) });
	await section.getByRole('button', { name: 'Hochladen' }).click();
	await expect(section.getByTestId('attachment-error')).toHaveText('Dieser Dateityp ist nicht erlaubt. Erlaubt sind PDF, PNG, JPG, HEIC und TXT.');
	// unknown extension is stopped before any upload
	await input.setInputFiles({ name: 'programm.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
	await expect(section.getByTestId('attachment-error')).toHaveText('Dieser Dateityp ist nicht erlaubt. Erlaubt sind PDF, PNG, JPG, HEIC und TXT.');
	await expect(section.getByTestId('attachment-picked')).toHaveCount(0);
	await input.setInputFiles({ name: 'leer.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
	await expect(section.getByTestId('attachment-error')).toHaveText('Die Datei ist leer.');
	// the server also refuses a script behind a .txt? (text with a NUL byte is no text)
	await input.setInputFiles({ name: 'binaer.txt', mimeType: 'text/plain', buffer: Buffer.from([0x41, 0x00, 0x42]) });
	await section.getByRole('button', { name: 'Hochladen' }).click();
	await expect(section.getByTestId('attachment-error')).toHaveText('Dieser Dateityp ist nicht erlaubt. Erlaubt sind PDF, PNG, JPG, HEIC und TXT.');

	// oversize: the admin lowers the limit to 2 KiB, a 3 KiB file is refused with 413
	await setUploadLimitInUi(page, '2', 'KiB');
	const again = await openAbsenceEditor(page);
	await again.getByTestId('attachment-file').setInputFiles({ name: 'zu-gross.txt', mimeType: 'text/plain', buffer: textBytes(3 * 1024) });
	await again.getByRole('button', { name: 'Hochladen' }).click();
	await expect(again.getByTestId('attachment-error')).toHaveText('Die Datei ist zu groß. Wähle eine kleinere Datei.');
	const api413 = await apiUpload(page, '/api/v1/files', 'zu-gross.txt', textBytes(2049), 'text/plain');
	expect(api413.status).toBe(413);
	expect(api413.body.error.code).toBe('file_too_large');
	expect((await apiUpload(page, '/api/v1/files', 'passt.txt', textBytes(2048), 'text/plain')).status).toBe(201); // exactly the limit
	await setUploadLimitInUi(page, '10', 'MiB');
	expect((await api(page, 'GET', '/api/v1/admin/storage')).body.maxUploadBytes).toBe(10 * MIB);
	// nothing was attached by the refused uploads
	expect((await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`)).body).toHaveLength(before);
});

test('detach only removes the link; deleting the file removes the bytes (database and local path)', async () => {
	const { page } = alice;
	const localBefore = localFiles().length;
	const detach = await api(page, 'DELETE', `/api/v1/absences/${ids.absence}/attachments/${ids.fileSmall}`);
	expect(detach.status).toBe(204);
	expect((await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`)).body.map((f: any) => f.name)).toEqual(['neu-klein.txt']);
	expect((await apiDownload(page, `/api/v1/files/${ids.fileSmall}`)).status).toBe(200); // the file itself still exists
	expect((await api(page, 'DELETE', `/api/v1/files/${ids.fileSmall}`)).status).toBe(204);
	expect((await apiDownload(page, `/api/v1/files/${ids.fileSmall}`)).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/files/${ids.fileSmall}`)).status).toBe(404);
	// local file: delete removes the object from disk
	expect((await api(page, 'DELETE', `/api/v1/files/${ids.fileNewLocal}`)).status).toBe(204);
	await expect.poll(() => localFiles().length).toBe(localBefore - 1);
	expect((await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`)).body).toEqual([]);
	// unlinked uploads (spoof leftovers, test files) did not leave anything behind that can be downloaded
	expect((await apiDownload(page, `/api/v1/files/${ids.fileNewLocal}`)).status).toBe(404);
});

test('account separation: Bob cannot read, delete, list or attach Alice\'s files and absences (404)', async () => {
	const { page } = bob;
	const own = await apiUpload(page, '/api/v1/files', 'bob.txt', textBytes(300), 'text/plain');
	expect(own.status).toBe(201);
	const fileId = ids.fileBig; // Alice's, still stored
	expect((await apiDownload(page, `/api/v1/files/${fileId}`)).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/files/${fileId}`)).status).toBe(404);
	expect((await api(page, 'GET', `/api/v1/absences/${ids.absence}/attachments`)).status).toBe(404);
	expect((await api(page, 'POST', `/api/v1/absences/${ids.absence}/attachments`, { fileId: own.body.id })).status).toBe(404);
	const bobAbsence = await api(page, 'POST', '/api/v1/absences', { kind: 'sick', startDate: '2026-11-04', endDate: '2026-11-04', status: 'approved' });
	expect(bobAbsence.status).toBe(201);
	expect((await api(page, 'POST', `/api/v1/absences/${bobAbsence.body.id}/attachments`, { fileId })).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/absences/${ids.absence}/attachments/${fileId}`)).status).toBe(404);
	// Alice's file is untouched
	const still = await apiDownload(alice.page, `/api/v1/files/${fileId}`);
	expect(still.status).toBe(200);
	// not logged in: the API refuses
	const anonymous = await page.context().browser()!.newContext({ baseURL: BASE });
	expect((await anonymous.request.get(`/api/v1/files/${fileId}`)).status()).toBe(401);
	await anonymous.close();
});

test('shared views never contain file information', async () => {
	const { page } = alice;
	const share = await api(page, 'POST', '/api/v1/shares', { recipientHandle: 'bob.xfer', scopes: { plan: true, actual: true, vacation: true } });
	expect(share.status).toBe(201);
	// a vacation absence (shared with the vacation scope) with an attachment: there would be something to leak
	const vacation = await api(page, 'POST', '/api/v1/absences', { kind: 'vacation', startDate: '2026-11-09', endDate: '2026-11-10', status: 'approved', note: 'Geheime-Urlaubsnotiz-xfer' });
	expect(vacation.status).toBe(201);
	const fresh = await apiUpload(page, '/api/v1/files', 'sichtbar-nicht.txt', textBytes(500), 'text/plain');
	expect((await api(page, 'POST', `/api/v1/absences/${vacation.body.id}/attachments`, { fileId: fresh.body.id })).status).toBe(201);
	expect((await api(page, 'GET', `/api/v1/absences/${vacation.body.id}/attachments`)).body).toHaveLength(1);
	const incoming = await api(bob.page, 'GET', '/api/v1/shares/incoming');
	expect(incoming.body).toHaveLength(1);
	const view = await api(bob.page, 'GET', `/api/v1/shares/incoming/${incoming.body[0].id}/view?from=2026-11-01&to=2026-11-30`);
	expect(view.status).toBe(200);
	const json = JSON.stringify(view.body);
	expect(json).toContain('2026-11-09'); // the vacation period itself is shared ...
	for (const forbidden of [fresh.body.id, 'sichtbar-nicht', fresh.body.sha256, 'attachment', 'Anhang', 'Geheime-Urlaubsnotiz-xfer', 'Geheime-Krankennotiz-xfer', 'contentType']) {
		expect(json, forbidden).not.toContain(forbidden);
	}
	// the incoming-shares UI of Bob does not show attachments either
	await bob.page.goto('/shared');
	await expect(bob.page.getByText('sichtbar-nicht')).toHaveCount(0);
	expect((await api(page, 'DELETE', `/api/v1/shares/${share.body.id}`)).status).toBe(204);
});
