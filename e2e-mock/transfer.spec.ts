import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { readFileSync } from 'node:fs';
import { loginAsAdmin } from './helpers';

// Export, import, storage admin and attachments against the in-repo mock API, serially on one server.
// Dates lie in 2032 so the specs do not depend on the demo data relative to "today".
test.describe.configure({ mode: 'serial' });

const SAMPLE = 'Datum;Beginn;Ende;Art\r\n02.03.2032;8:00;12:00;Arbeit\r\n02.03.2032;12:30;16:45;Arbeit\r\n03.03.2032;8:00;11:30;Schule\r\nSumme;;;\r\n';
const csv = (text = SAMPLE, name = 'zeiten.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

async function walkToPreview(page: Page, file = csv()) {
	await page.goto('/import');
	await page.getByTestId('import-file').setInputFiles(file);
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Blatt und Kopfzeile');
	await expect(page.getByTestId('raw-table')).toContainText('Datum');
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Spalten');
	await page.getByRole('button', { name: 'Vorschau prüfen' }).click();
	await expect(page.getByTestId('preview-counts')).toBeVisible();
}

test('import: full wizard happy path writes only after the explicit confirmation, then the day shows the entries', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await walkToPreview(page);
	await expect(page.getByTestId('count-valid')).toHaveText('3');
	await expect(page.getByTestId('count-errors')).toHaveText('0');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await expect(page.getByTestId('commit')).toBeDisabled();
	// nothing written yet
	await page.goto('/time/2032-03-02');
	await expect(page.getByTestId('day-target')).toBeVisible();
	await expect(page.getByTestId('segment-row')).toHaveCount(0);

	await walkToPreview(page);
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toHaveText(/3 Einträge angelegt/);
	await page.getByRole('link', { name: 'Zum ersten importierten Tag' }).click();
	await expect(page).toHaveURL(/\/time\/2032-03-02$/);
	await expect(page.getByTestId('segment-row')).toHaveCount(2);
	await context.close();
});

test('import: the same file again is detected as duplicates and creates nothing', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await walkToPreview(page);
	await expect(page.getByTestId('count-valid')).toHaveText('0');
	await expect(page.getByTestId('count-duplicates')).toHaveText('3');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toHaveText(/0 Einträge angelegt/);
	await expect(page.getByTestId('result-skipped')).toContainText('3 übersprungen');
	await context.close();
});

test('import: rollback is refused with a conflict list after a change, and works once the batch is unchanged', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	const file = csv('Datum;Beginn;Ende\r\n09.03.2032;8:00;12:00\r\n10.03.2032;8:00;12:00\r\n', 'woche.csv');
	await walkToPreview(page, file);
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-created')).toBeVisible();
	// change one imported entry in a second tab through the API (PATCH with If-Match)
	const changed = await page.evaluate(async () => {
		const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
		const list = await (await fetch('/api/v1/time/segments?from=2032-03-09T00:00:00Z&to=2032-03-09T23:00:00Z', { credentials: 'include' })).json();
		const response = await fetch(`/api/v1/time/segments/${list[0].id}`, {
			method: 'PATCH',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'If-Match': String(list[0].version) },
			body: JSON.stringify({ endedAt: '2032-03-09T10:30:00Z', reason: 'Test' })
		});
		return response.status;
	});
	expect(changed).toBe(200);
	await page.getByTestId('rollback').click();
	await page.getByTestId('rollback-confirm').click();
	await expect(page.getByTestId('rollback-conflicts')).toContainText('Diese 1 Einträge wurden seit dem Import geändert');
	await expect(page.getByTestId('import-error')).toContainText('nicht zurückgenommen werden');

	// a fresh, untouched batch rolls back cleanly
	await walkToPreview(page, csv('Datum;Beginn;Ende\r\n16.03.2032;8:00;12:00\r\n', 'einzeln.csv'));
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await page.getByTestId('commit').click();
	await page.getByTestId('rollback').click();
	await page.getByTestId('rollback-confirm').click();
	await expect(page.getByTestId('rolled-back')).toBeVisible();
	await page.goto('/time/2032-03-16');
	await expect(page.getByTestId('segment-row')).toHaveCount(0);
	await context.close();
});

test('import: decimal hours note, row errors and template round trip', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/import');
	await page.getByTestId('import-file').setInputFiles(csv('Datum;Beginn;Dauer\r\n23.03.2032;8;7,7\r\nfalsch;8;7,7\r\n', 'dezimal.csv'));
	await page.getByRole('button', { name: 'Weiter' }).click();
	await page.getByRole('button', { name: 'Weiter' }).click();
	await page.getByLabel('Zeitformat').selectOption('decimal_hours');
	await expect(page.getByTestId('decimal-hours-note')).toContainText('7,7 Stunden sind 7:42 und nicht 7:07');
	await expect(page.getByTestId('probe')).toContainText('Dauer: „7,7“ wird gelesen als 7:42');
	await page.getByLabel('Vorlage', { exact: false }).first().isVisible();
	await page.getByLabel('Name der neuen Vorlage').fill('Dezimal');
	await page.getByRole('button', { name: 'Als Vorlage speichern' }).click();
	await expect(page.getByText('Vorlage „Dezimal“ gespeichert.')).toBeVisible();
	await page.getByRole('button', { name: 'Vorschau prüfen' }).click();
	await expect(page.getByTestId('count-valid')).toHaveText('1');
	await expect(page.getByTestId('error-table')).toContainText('Das Datum ist nicht lesbar.');
	await page.getByRole('button', { name: 'Import verwerfen' }).click();
	await expect(page.getByTestId('dropzone')).toBeVisible();
	await context.close();
});

test('export: download triggers with the server filename and a real CSV', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/export');
	await page.getByLabel('Von').fill('2032-03-01');
	await page.getByLabel('Bis').fill('2032-03-31');
	await page.getByLabel(/CSV/).check();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportieren' }).click()]);
	expect(download.suggestedFilename()).toBe('Arbeitszeit_2032-03-01_2032-03-31.csv');
	const text = readFileSync((await download.path())!, 'utf8');
	expect(text).toContain('Beginn (tatsächlich)');
	expect(text).toContain('02.03.2032;Di;08:00;');
	await expect(page.getByTestId('export-done')).toContainText('Arbeitszeit_2032-03-01_2032-03-31.csv');

	await page.getByLabel(/PDF/).check();
	const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportieren' }).click()]);
	expect(pdf.suggestedFilename()).toBe('Arbeitszeit_2032-03-01_2032-03-31.pdf');
	expect(readFileSync((await pdf.path())!).subarray(0, 8).toString()).toBe('%PDF-1.4');

	// more than 366 days is stopped before any request
	await page.getByLabel('Bis').fill('2033-03-31');
	await page.getByRole('button', { name: 'Exportieren' }).click();
	await expect(page.getByText('Der Zeitraum ist länger als 366 Tage.')).toBeVisible();
	await context.close();
});

test('storage admin: edit rules, save, secret stays write-only', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/storage');
	await expect(page.getByTestId('storage-only-new')).toBeVisible();
	await page.getByRole('button', { name: 'Regel hinzufügen' }).click();
	await page.getByLabel('Größe 1').fill('256');
	await page.getByLabel('Einheit 1').selectOption('KiB');
	await page.getByLabel('Speicherort 1').selectOption('db');
	await page.getByLabel('Speicherort für alle größeren Dateien').selectOption('s3');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText(/Endpunkt, Region, Bucket und Schlüssel-ID sind nötig/)).toBeVisible();
	await page.getByLabel('Endpunkt').fill('https://s3.example.org');
	await page.getByLabel('Region').fill('eu-central-1');
	await page.getByLabel('Bucket').fill('timetrack');
	await page.getByLabel('Zugriffsschlüssel-ID').fill('AKIATEST');
	await page.getByLabel('Geheimer Zugriffsschlüssel').fill('streng-geheim');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-saved')).toBeVisible();
	await expect(page.getByLabel('Geheimer Zugriffsschlüssel')).toHaveValue('');
	await expect(page.getByTestId('secret-stored')).toHaveText('Geheimnis gespeichert');
	await page.reload();
	await expect(page.getByLabel('Größe 1')).toHaveValue('256');
	await expect(page.getByLabel('Speicherort für alle größeren Dateien')).toHaveValue('s3');
	await expect(page.getByTestId('secret-stored')).toBeVisible();
	expect(await page.content()).not.toContain('streng-geheim');
	// back to the database for everything so later specs upload without S3
	await page.getByLabel('Speicherort für alle größeren Dateien').selectOption('db');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-saved')).toBeVisible();
	await context.close();
});

test('attachments: upload on an absence, download, remove; wrong type is refused', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/absences');
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	await expect(page.getByTestId('attachments-save-first')).toBeVisible();
	const form = page.getByTestId('absence-form');
	await form.getByLabel('Art').selectOption('sick');
	await form.getByLabel('Von', { exact: true }).fill('2032-05-04');
	await form.getByLabel('Bis', { exact: true }).fill('2032-05-05');
	await form.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Abwesenheit gespeichert.')).toBeVisible();
	for (let i = new Date().getFullYear(); i < 2032; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
	const row = page.getByTestId('absence-row').first();
	await row.getByRole('button', { name: 'Bearbeiten' }).click();
	const attachments = page.getByTestId('attachments');
	await expect(attachments).toContainText('nie geteilt');
	await attachments.getByTestId('attachment-file').setInputFiles({ name: 'krank.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
	await expect(page.getByTestId('attachment-error')).toContainText('Dieser Dateityp ist nicht erlaubt');
	await attachments.getByTestId('attachment-file').setInputFiles({ name: 'Krankmeldung.txt', mimeType: 'text/plain', buffer: Buffer.from('Attest vom Arzt') });
	await expect(page.getByTestId('attachment-picked')).toContainText('Krankmeldung.txt (15 B)');
	await attachments.getByRole('button', { name: 'Hochladen' }).click();
	const item = attachments.getByTestId('attachment');
	await expect(item).toContainText('Krankmeldung.txt');
	const [download] = await Promise.all([page.waitForEvent('download'), item.getByRole('button', { name: /herunterladen/ }).click()]);
	expect(download.suggestedFilename()).toBe('Krankmeldung.txt');
	expect(readFileSync((await download.path())!, 'utf8')).toBe('Attest vom Arzt');
	await item.getByRole('button', { name: /entfernen/ }).click();
	await expect(attachments.getByTestId('attachment')).toHaveCount(0);
	await context.close();
});

test('phone width: no horizontal page scroll on the new pages and wizard steps', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	for (const route of ['/export', '/import', '/settings/storage']) {
		await page.goto(route);
		await page.waitForLoadState('networkidle');
		expect(await overflow(), route).toBeLessThanOrEqual(0);
	}
	await walkToPreview(page, csv('Datum;Beginn;Ende;Notiz\r\n24.03.2032;8:00;12:00;Eine sehr lange Notiz die die Tabelle breit macht und trotzdem nicht die Seite sprengen darf\r\nx;8:00;9:00;\r\n', 'breit.csv'));
	expect(await overflow(), 'preview').toBeLessThanOrEqual(0);
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	expect(await overflow(), 'confirm').toBeLessThanOrEqual(0);
	await context.close();
});
