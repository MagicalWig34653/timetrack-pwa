import { type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// N4: company days (24.12./31.12.) per account: settings form and the display of half/full days.
test.describe.configure({ mode: 'serial' });
const dir = process.env.SCREENSHOT_DIR;

async function putSettings(page: Page, companyDays: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch('/api/v1/vacation/settings', {
		method: 'PUT',
		data: { region: 'DE-ST', annualEntitlementHalfDays: 60, companyDays },
		headers: { 'X-CSRF-Token': session.csrfToken }
	});
	expect(response.status()).toBe(200);
}

test('settings: choose treatments, add and remove an own rule, validation errors', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/vacation');
	const box = page.getByTestId('company-days');
	const save = page.getByRole('form', { name: 'Einstellungen' }).getByRole('button', { name: 'Speichern' });
	await expect(box).toBeVisible();
	await expect(page.getByTestId('company-12-24')).toHaveValue('none');
	await page.getByTestId('company-12-24').selectOption('half');
	await page.getByTestId('company-12-31').selectOption('full');
	await page.getByTestId('company-add').click();
	await box.getByLabel('Datum').fill('29.02.');
	await save.click();
	await expect(box).toContainText('29.02.');
	await expect(box.locator('[role=alert], .text-destructive').first()).toBeVisible();
	await box.getByLabel('Datum').fill('12.06.');
	await box.getByLabel('Name', { exact: true }).fill('Betriebsausflug');
	await save.click();
	await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('company-12-24')).toHaveValue('half');
	await expect(page.getByTestId('company-12-31')).toHaveValue('full');
	await expect(page.getByTestId('company-row')).toHaveCount(1);
	// duplicate of a fixed date is rejected
	await page.getByTestId('company-add').click();
	await box.getByLabel('Datum').nth(1).fill('24.12.');
	await save.click();
	await expect(page.getByText('Für dieses Datum gibt es schon eine Regel.')).toBeVisible();
	await page.getByTestId('company-remove').nth(1).click();
	await page.getByTestId('company-remove').first().click();
	await save.click();
	await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('company-row')).toHaveCount(0);
	await expect(page.getByTestId('company-12-24')).toHaveValue('half');
	const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
	expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
	await context.close();
});

test('week, day panel, planner and calendar show half and full company days', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await putSettings(page, [{ month: 12, day: 24, treatment: 'half' }, { month: 12, day: 31, treatment: 'full' }]);
	// 24.12.2035 is a Monday (2035-W52), 31.12.2035 a Monday too (2036-W01)
	await page.goto('/week?week=2035-W52');
	const half = page.getByTestId('week-day-2035-12-24');
	await expect(half).toHaveAttribute('data-mark', 'work');
	await expect(half.getByTestId('day-holiday')).toHaveAttribute('data-treatment', 'half');
	await expect(half.getByTestId('day-holiday')).toHaveAttribute('title', 'Heiligabend – halber Betriebstag, Soll halbiert');
	await expect(half.getByTestId('day-holiday')).toContainText('½');
	await expect(half).toHaveAttribute('aria-label', /halber Betriebstag, Soll halbiert/);
	await page.goto('/week?week=2036-W01');
	const full = page.getByTestId('week-day-2035-12-31');
	await expect(full).toHaveAttribute('data-mark', 'holiday');
	await expect(full.getByTestId('day-holiday')).toContainText('Silvester');
	await expect(full.getByTestId('day-mark')).toHaveCount(0);

	await page.goto('/week?week=2035-W52&day=2035-12-24');
	await expect(page.getByTestId('panel-holiday-badge')).toContainText('Heiligabend');

	await page.goto('/plan?week=2035-W52&view=list');
	await expect(page.getByTestId('plan-holiday-2035-12-24')).toHaveAttribute('data-treatment', 'half');
	await page.goto('/plan?week=2035-W52&view=grid');
	await expect(page.getByTestId('holiday-chip-2035-12-24')).toHaveAttribute('data-treatment', 'half');
	await expect(page.getByTestId('holiday-chip-2035-12-24')).toContainText('½');

	await page.goto('/calendar?date=2035-12-24&view=month');
	await expect(page.getByTestId('calendar-month')).toBeVisible();
	await expect(page.locator('[data-chip="holiday"][data-treatment="half"]').first()).toContainText('Heiligabend');
	await expect(page.locator('[data-chip="holiday"][data-treatment="full"]').first()).toContainText('Silvester');
	await context.close();
});

test('axe and screenshots', async ({ browser }) => {
	test.setTimeout(180_000);
	for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 1000 }]] as const) {
		for (const scheme of ['light', 'dark'] as const) {
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await putSettings(page, [{ month: 12, day: 24, treatment: 'half' }, { month: 12, day: 31, treatment: 'full' }]);
			for (const [slug, url, ready] of [
				['week', '/week?week=2035-W52', 'week-day-2035-12-24'],
				['settings', '/vacation', 'company-days']
			] as const) {
				await page.goto(url);
				await expect(page.getByTestId(ready)).toBeVisible();
				const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['label-content-name-mismatch']).analyze();
				expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
				if (dir) await page.screenshot({ path: `${dir}/n4-${slug}-${name}-${scheme}.png`, fullPage: true });
			}
			await context.close();
		}
	}
});
