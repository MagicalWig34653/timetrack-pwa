import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { DEFAULT_FORM_LAYOUT, SYNTHETIC_TEXT_FIELDS, makeFormPdf } from '../src/lib/vacation-form/test-pdf';
import { loginAsAdmin } from './helpers';

// Package V6: remaining days as of the request (earlier vacation is deducted), "davon abgegolten", and replacing the template PDF
// without losing the assignment. Synthetic PDFs only. Screenshots are written only when SCREENSHOT_DIR is set.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

const viewports = [
	['phone', { width: 390, height: 844 }],
	['desktop', { width: 1280, height: 900 }]
] as const;

const select = (page: Page, field: string) => page.locator(`[data-field-name="${field}"] select`).first();
const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

async function version2() {
	// "rest_days" is gone, "compensated_days" is new; everything else stays
	return Buffer.from(await makeFormPdf({ textFields: [...SYNTHETIC_TEXT_FIELDS.filter((n) => n !== 'rest_days'), 'compensated_days'], checkboxes: DEFAULT_FORM_LAYOUT.checkboxes, dropdowns: DEFAULT_FORM_LAYOUT.dropdowns }));
}

async function uploadAndMapV1(page: Page) {
	await page.goto('/settings/vacation-form');
	await expect(page.getByTestId('vform-upload')).toBeVisible();
	// the mock account may still hold a template from an earlier test
	if (await page.getByTestId('vform-remove').isVisible()) {
		await page.getByTestId('vform-remove').click();
		await page.getByRole('dialog').getByRole('button', { name: 'Vorlage entfernen' }).click();
		await expect(page.getByTestId('vform-notice')).toContainText('entfernt');
	}
	await page.getByTestId('vform-file-input').setInputFiles({ name: 'form-v1.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await makeFormPdf()) });
	await expect(page.getByTestId('vform-field')).toHaveCount(16);
	await page.getByLabel('Nachname', { exact: true }).fill('Mustermann');
	await select(page, 'last_name').selectOption('lastName');
	await select(page, 'rest_days').selectOption('restAfter');
	await select(page, 'company_box').selectOption('fixedCheckbox');
	await page.getByTestId('vform-save').click();
	await expect(page.getByTestId('vform-notice')).toContainText('Zuordnung gespeichert');
}

test('replacing the PDF keeps the assignment of same-named fields and flags new ones', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await uploadAndMapV1(page);

	await page.getByTestId('vform-file-input').setInputFiles({ name: 'form-v2.pdf', mimeType: 'application/pdf', buffer: await version2() });
	await expect(page.getByTestId('vform-file-info')).toContainText('form-v2.pdf');
	const review = page.getByTestId('vform-replace-review');
	await expect(review).toBeVisible();
	await expect(page.getByTestId('vform-replace-summary')).toContainText('2 Zuordnungen übernommen, 1 neue Felder, 1 entfernte Felder');
	await expect(page.getByTestId('vform-replace-kept')).toContainText('last_name');
	await expect(page.getByTestId('vform-replace-fresh')).toContainText('compensated_days');
	await expect(page.getByTestId('vform-replace-gone')).toContainText('rest_days');

	// preserved, removed and new fields in the list
	await expect(select(page, 'last_name')).toHaveValue('lastName');
	await expect(select(page, 'company_box')).toHaveValue('fixedCheckbox');
	await expect(page.locator('[data-field-name="rest_days"]')).toHaveCount(0);
	await expect(select(page, 'compensated_days')).toHaveValue('');
	await expect(page.locator('[data-field-name="compensated_days"]').getByTestId('vform-field-new')).toBeVisible();
	await expect(page.locator('[data-field-name="last_name"]').getByTestId('vform-field-new')).toHaveCount(0);
	await expect(page.getByLabel('Nachname', { exact: true })).toHaveValue('Mustermann');
	// the carried assignment is already saved
	await expect(page.getByTestId('vform-dirty')).toHaveCount(0);
	expect((await axe(page)).violations).toEqual([]);
	if (dir) await page.screenshot({ path: `${dir}/v6-replace-review-desktop.png`, fullPage: true });

	// assigning the new field takes the flag away; the scope option defaults to "all earlier vacation"
	await select(page, 'compensated_days').selectOption('compensated');
	await expect(page.locator('[data-field-name="compensated_days"]').getByTestId('vform-field-new')).toHaveCount(0);
	await expect(page.locator('[data-field-name="compensated_days"] select').nth(1)).toHaveValue('all');
	await page.locator('[data-field-name="compensated_days"] select').nth(1).selectOption('decided');
	await page.getByTestId('vform-save').click();
	await expect(page.getByTestId('vform-notice')).toContainText('Zuordnung gespeichert');

	await page.reload();
	await expect(select(page, 'last_name')).toHaveValue('lastName');
	await expect(select(page, 'compensated_days')).toHaveValue('compensated');
	await expect(page.locator('[data-field-name="compensated_days"] select').nth(1)).toHaveValue('decided');
	await expect(page.getByTestId('vform-replace-review')).toHaveCount(0);
	await context.close();
});

test('request dialog: earlier vacation is deducted with a list, later vacation only shows in the year-end figure', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await uploadAndMapV1(page);
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const create = async (data: object) => {
		const response = await page.request.fetch('/api/v1/absences', { method: 'POST', data: { kind: 'vacation', ...data }, headers: { 'X-CSRF-Token': session.csrfToken } });
		expect(response.status()).toBeLessThan(300);
		return response.json();
	};
	// 2034: Monday 03-06..Friday 03-10 (earlier, planned), the request 06-12..06-16, Monday 09-04..Friday 09-08 (later, requested)
	const earlier = await create({ startDate: '2034-03-06', endDate: '2034-03-10', status: 'planned' });
	await create({ startDate: '2034-06-12', endDate: '2034-06-16', status: 'planned' });
	const later = await create({ startDate: '2034-09-04', endDate: '2034-09-08', status: 'requested' });
	const balance = await (await page.request.get('/api/v1/vacation/balance?year=2034')).json();
	const total = balance.entitlementHalfDays + balance.carryOverHalfDays + balance.adjustmentHalfDays;
	const days = (halfDays: number) => String(halfDays / 2).replace('.', ',');

	await page.goto('/absences?kind=vacation&year=2034');
	await page.getByTestId('absence-row').filter({ hasText: '12.06.2034' }).getByTestId('absence-request-form').click();
	const dialog = page.getByTestId('request-dialog');
	await expect(dialog.getByTestId('request-breakdown')).toBeVisible();
	const requestHalf = 10;
	await expect(dialog.getByTestId('request-before-item')).toHaveCount(1);
	await expect(dialog.getByTestId('request-before-item')).toContainText('06.03.2034');
	await expect(dialog.getByTestId('request-before-item')).toContainText('Geplant');
	await expect(dialog.getByTestId('request-before-sum')).toContainText(days(earlier.countedHalfDays));
	await expect(dialog.getByTestId('request-later-item')).toHaveCount(1);
	await expect(dialog.getByTestId('request-later-item')).toContainText('04.09.2034');
	await expect(dialog.getByTestId('request-rest-at')).toHaveText(`${days(total - earlier.countedHalfDays)} / ${days(total - earlier.countedHalfDays - requestHalf)}`);
	await expect(dialog.getByTestId('request-rest-year-end')).toHaveText(days(total - earlier.countedHalfDays - requestHalf - later.countedHalfDays));
	expect((await axe(page)).violations).toEqual([]);
	if (dir) await page.screenshot({ path: `${dir}/v6-dialog-desktop.png` });
	await context.close();
});

for (const [name, viewport] of viewports) {
	test(`v6 shots ${name}`, async ({ browser }) => {
		test.skip(!dir, 'set SCREENSHOT_DIR');
		const { page, context } = await loginAsAdmin(browser, { viewport });
		await uploadAndMapV1(page);
		await page.getByTestId('vform-file-input').setInputFiles({ name: 'form-v2.pdf', mimeType: 'application/pdf', buffer: await version2() });
		await expect(page.getByTestId('vform-replace-review')).toBeVisible();
		await page.waitForTimeout(500);
		await page.screenshot({ path: `${dir}/v6-replace-${name}.png`, fullPage: true });
		await context.close();
	});
}
