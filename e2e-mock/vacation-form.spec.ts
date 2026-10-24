import { readFile } from 'node:fs/promises';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { readFieldValues } from '../src/lib/vacation-form/pdf';
import { makeFlatPdf, makeFormPdf } from '../src/lib/vacation-form/test-pdf';
import { loginAsAdmin } from './helpers';

// Package P6 on the dev mock: upload a (synthetic) template, map fields, preview, save, generate and download.
// Only the generated neutral PDFs are used; no employer form is ever read here.
// Review screenshots are written only when SCREENSHOT_DIR is set.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

const viewports = [
	['phone', { width: 390, height: 844 }],
	['desktop', { width: 1280, height: 900 }]
] as const;

async function pick(page: Page, field: string, option: string | RegExp) {
	await page.locator(`[data-field-name="${field}"] select`).first().selectOption(option);
}

async function canvasHasInk(page: Page): Promise<boolean> {
	return page.getByTestId('vform-preview').getByTestId('pdf-canvas-element').evaluate((canvas: HTMLCanvasElement) => {
		const ctx = canvas.getContext('2d')!;
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		for (let i = 0; i < data.length; i += 4) if (data[i] < 200) return true;
		return false;
	});
}

async function uploadSynthetic(page: Page) {
	await page.goto('/settings/vacation-form');
	await expect(page.getByTestId('vform-upload')).toBeVisible();
	await page.getByTestId('vform-file-input').setInputFiles({ name: 'sample-form.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makeFormPdf()) });
	await expect(page.getByTestId('vform-field')).toHaveCount(16);
}

test('rejects files that are not a PDF', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await page.goto('/settings/vacation-form');
	await page.getByTestId('vform-file-input').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>no pdf</html>') });
	await expect(page.getByTestId('vform-problem')).toContainText('keine PDF-Datei');
	await expect(page.getByTestId('vform-field')).toHaveCount(0);
	await context.close();
});

test('upload, map, preview, save, generate from an absence and download', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await uploadSynthetic(page);
	await expect(page.getByTestId('vform-file-info')).toContainText('sample-form.pdf');
	await expect(page.getByTestId('vform-file-info')).toContainText('Gespeichert in deinem Konto');

	await page.getByLabel('Nachname', { exact: true }).fill('Mustermann');
	await page.getByLabel('Vorname', { exact: true }).fill('Max');
	await page.getByLabel('Personalnummer').fill('4711');
	await page.getByLabel('Bereich / Abteilung').fill('Technik');
	await page.getByTestId('vform-suggest').click();
	await expect(page.getByTestId('vform-notice')).toContainText('Vorschläge eingetragen');
	// suggestions are only a start; the rest is mapped by hand
	await expect(page.locator('[data-field-name="last_name"] select').first()).toHaveValue('lastName');
	await expect(page.locator('[data-field-name="free_from_1"] select').first()).toHaveValue('');
	await pick(page, 'last_name', 'lastName');
	await pick(page, 'first_name', 'firstName');
	await pick(page, 'personnel_no', 'personnelNo');
	await pick(page, 'department', 'department');
	await pick(page, 'date_from', 'dateFrom');
	await pick(page, 'date_to', 'dateTo');
	await pick(page, 'substitute', 'substitute');
	await pick(page, 'working_days', 'workingDays');
	await pick(page, 'rest_days', 'restAfter');
	await pick(page, 'entitlement_total', 'entitlementTotal');
	await pick(page, 'free_from_1', 'freeRangeFrom');
	await pick(page, 'free_to_1', 'freeRangeTo');
	await pick(page, 'company_box', 'fixedCheckbox');
	await pick(page, 'location', 'fixedText');
	await page.locator('[data-field-name="location"] input').fill('Magdeburg');

	await expect(page.getByTestId('vform-dirty')).toBeVisible();
	await expect(page.getByTestId('vform-preview').getByTestId('pdf-canvas-element')).toBeVisible();
	await expect.poll(() => canvasHasInk(page)).toBe(true);
	await page.getByTestId('vform-save').click();
	await expect(page.getByTestId('vform-notice')).toContainText('Zuordnung gespeichert');
	await expect(page.getByTestId('vform-dirty')).toHaveCount(0);

	// persisted on the (mock) server
	await page.reload();
	await expect(page.getByTestId('vform-field')).toHaveCount(16);
	await expect(page.getByLabel('Nachname', { exact: true })).toHaveValue('Mustermann');
	await expect(page.locator('[data-field-name="working_days"] select').first()).toHaveValue('workingDays');

	// use it on a planned vacation of the demo data
	await page.goto('/absences?kind=vacation&status=planned');
	const row = page.getByTestId('absence-row').first();
	await expect(row).toBeVisible();
	await row.getByTestId('absence-request-form').click();
	const dialog = page.getByTestId('request-dialog');
	await expect(dialog.getByTestId('request-substitute')).toBeVisible();
	await expect(dialog.getByTestId('request-working-days')).not.toHaveText('');
	await dialog.getByTestId('request-substitute').fill('Erika Beispiel');
	await dialog.getByTestId('request-generate').click();
	await expect(dialog.getByTestId('request-ready')).toBeVisible();
	const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('request-download').click()]);
	expect(download.suggestedFilename()).toMatch(/^Urlaubsantrag_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.pdf$/);
	const path = await download.path();
	const values = await readFieldValues(new Uint8Array(await readFile(path)));
	expect(values.last_name).toBe('Mustermann');
	expect(values.first_name).toBe('Max');
	expect(values.personnel_no).toBe('4711');
	expect(values.substitute).toBe('Erika Beispiel');
	expect(values.company_box).toBe(true);
	expect(values.location).toBe('Magdeburg');
	expect(values.date_from).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
	expect(values.working_days).toMatch(/^\d+(,5)?$/);
	await expect(dialog.getByTestId('request-open')).toBeVisible();
	await expect(dialog.getByTestId('request-print')).toBeVisible();
	await context.close();
});

test('flat PDF: place a text position by clicking the page and use it', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await page.goto('/settings/vacation-form');
	await page.getByTestId('vform-file-input').setInputFiles({ name: 'flat.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makeFlatPdf()) });
	await expect(page.getByTestId('vform-no-fields')).toBeVisible();
	await expect(page.getByTestId('vform-fields')).toHaveCount(0);
	const canvas = page.getByTestId('vform-overlay').getByTestId('pdf-canvas-element');
	await expect(canvas).toBeVisible();
	await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0).toBeGreaterThan(300);
	await canvas.click({ position: { x: 60, y: 120 } });
	await expect(page.getByTestId('vform-overlay-item')).toHaveCount(1);
	await expect(page.getByTestId('pdf-marker')).toHaveText('1');
	await page.getByTestId('vform-overlay-item').locator('select').first().selectOption('fixedText');
	await page.locator('#ov-0-text').fill('Beispieltext');
	await expect.poll(() => canvasHasInk(page)).toBe(true);
	await page.getByTestId('vform-save').click();
	await expect(page.getByTestId('vform-notice')).toContainText('Zuordnung gespeichert');
	await page.reload();
	await expect(page.getByTestId('vform-overlay-item')).toHaveCount(1);
	await context.close();
});

test('planner: a taken suggestion offers the request form, a removed template shows the hint', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await page.goto('/vacation/planner');
	const card = page.locator('[data-testid="suggestion-card"][data-conflicts="no"]').first();
	await expect(card).toBeVisible();
	await card.getByTestId('take-over').click();
	await card.getByTestId('take-over-confirm-button').click();
	await expect(page.getByTestId('planner-notice')).toContainText('eingetragen');
	await page.getByTestId('planner-request-form').first().click();
	await expect(page.getByTestId('request-dialog').getByTestId('request-substitute')).toBeVisible();
	await page.getByTestId('request-close').click();

	await page.goto('/settings/vacation-form');
	await page.getByTestId('vform-remove').click();
	await page.getByRole('dialog').getByRole('button', { name: 'Vorlage entfernen' }).click();
	await expect(page.getByTestId('vform-notice')).toContainText('entfernt');
	await page.goto('/absences?kind=vacation');
	await page.getByTestId('absence-request-form').first().click();
	await expect(page.getByTestId('request-no-template')).toBeVisible();
	await context.close();
});

test('server errors of the template endpoints show German messages (413, 415, 409)', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await uploadSynthetic(page);
	const answer = (status: number, code: string) => (route: any) =>
		route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code, message: code } }) });

	await page.route('**/api/v1/vacation/request-form/mapping', answer(413, 'mapping_too_large'));
	await page.getByLabel('Nachname', { exact: true }).fill('Mustermann');
	await page.getByTestId('vform-save').click();
	await expect(page.getByTestId('vform-problem')).toContainText('Die Zuordnung ist zu groß');
	await page.unroute('**/api/v1/vacation/request-form/mapping');

	await page.route('**/api/v1/vacation/request-form/mapping', answer(409, 'no_template'));
	await page.getByTestId('vform-save').click();
	await expect(page.getByTestId('vform-problem')).toContainText('keine Vorlage für dein Konto');
	await page.unroute('**/api/v1/vacation/request-form/mapping');

	await page.route('**/api/v1/vacation/request-form/file', (route) => (route.request().method() === 'PUT' ? answer(415, 'unsupported_type')(route) : route.continue()));
	await page.getByTestId('vform-file-input').setInputFiles({ name: 'again.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makeFormPdf()) });
	await expect(page.getByTestId('vform-problem')).toContainText('keine PDF-Datei');
	await page.unroute('**/api/v1/vacation/request-form/file');

	await page.route('**/api/v1/vacation/request-form/file', (route) => (route.request().method() === 'PUT' ? answer(413, 'file_too_large')(route) : route.continue()));
	await page.getByTestId('vform-file-input').setInputFiles({ name: 'again.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makeFormPdf()) });
	await expect(page.getByTestId('vform-problem')).toContainText('größer als 5 MB');
	await context.close();
});

test('offline: the browser copy is shown when the server is unreachable, writes are refused', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await uploadSynthetic(page);
	await page.reload(); // a successful server load fills the browser cache
	await expect(page.getByTestId('vform-field')).toHaveCount(16);
	await page.route('**/api/v1/vacation/request-form**', (route) => route.abort('failed'));
	await page.reload();
	await expect(page.getByTestId('vform-field')).toHaveCount(16);
	await expect(page.getByTestId('vform-file-info')).toContainText('Server nicht erreichbar');
	await page.getByLabel('Nachname', { exact: true }).fill('Offline');
	await page.getByTestId('vform-save').click();
	await expect(page.getByTestId('vform-problem')).toContainText('nicht erreichbar');
	await context.close();
});

test('module gating: the page is gone when planning is switched off', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await page.goto('/settings/modules');
	const toggle = page.getByRole('switch', { name: /Planung/ });
	await toggle.click();
	await page.goto('/settings/vacation-form');
	await expect(page.getByText('Dieses Modul ist deaktiviert')).toBeVisible();
	await page.goto('/settings/modules');
	await page.getByRole('switch', { name: /Planung/ }).click();
	await context.close();
});

for (const [name, viewport] of viewports) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`p6 shots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await uploadSynthetic(page);
			await page.getByLabel('Nachname', { exact: true }).fill('Mustermann');
			await page.getByLabel('Vorname', { exact: true }).fill('Max');
			await pick(page, 'last_name', 'lastName');
			await pick(page, 'first_name', 'firstName');
			await pick(page, 'date_from', 'dateFrom');
			await pick(page, 'date_to', 'dateTo');
			await pick(page, 'working_days', 'workingDays');
			await pick(page, 'company_box', 'fixedCheckbox');
			await expect.poll(() => canvasHasInk(page)).toBe(true);
			await page.waitForTimeout(500);
			await page.screenshot({ path: `${dir}/vform-settings-${name}-${scheme}.png`, fullPage: true });
			await page.getByTestId('vform-save').click();
			await expect(page.getByTestId('vform-notice')).toContainText('gespeichert');
			await page.goto('/absences?kind=vacation&status=planned');
			await page.getByTestId('absence-request-form').first().click();
			await page.getByTestId('request-substitute').fill('Erika Beispiel');
			await page.getByTestId('request-generate').click();
			await expect(page.getByTestId('request-ready')).toBeVisible();
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${dir}/vform-dialog-${name}-${scheme}.png` });
			await context.close();
		});
	}
}
