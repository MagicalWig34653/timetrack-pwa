import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// Vacation planner (V2) against the in-repo mock API. Relative to "today" because the mock seeds its demo data that way.
test.describe.configure({ mode: 'serial' });

const dir = process.env.SCREENSHOT_DIR;

test('planner: reachable from the vacation page, shows budget, filters and ranked cards', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/vacation');
	await page.getByTestId('open-planner').click();
	await expect(page).toHaveURL(/\/vacation\/planner$/);
	await expect(page.getByRole('heading', { name: 'Urlaubsplanung' })).toBeVisible();
	await expect(page.getByTestId('planner-budget')).toContainText('Anspruch');
	await expect(page.getByTestId('budget-remaining')).toContainText('Tage');
	await expect(page.getByTestId('planner-filters')).toBeVisible();
	const cards = page.getByTestId('suggestion-card');
	await expect(cards.first()).toBeVisible();
	await expect(cards.first().getByTestId('suggestion-summary')).toContainText(/Urlaubstage? → \d+ Tage frei/);
	await expect(cards.first().getByTestId('suggestion-factor')).toContainText('Faktor');
	await expect(page.getByTestId('planner-hidden')).toContainText('Faktor unter 2');
	// the navigation keeps "Urlaub" highlighted on the subpage
	await expect(page.locator('nav a[aria-current="page"]').filter({ hasText: 'Urlaub' }).first()).toBeVisible();
	if (dir) await page.screenshot({ path: `${dir}/planner-desktop-light.png`, fullPage: true });
	await context.close();
});

test('planner: filters are remembered per browser and the efficiency minimum can be lowered', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/vacation/planner');
	await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
	await page.getByLabel('Höchstens Urlaubstage').fill('3');
	await page.getByTestId('filter-apply').click();
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
	await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
	for (const days of await page.getByTestId('suggestion-summary').allTextContents()) {
		expect(Number(days.match(/^(\d+)/)![1])).toBeLessThanOrEqual(3);
	}
	await page.reload();
	await expect(page.getByLabel('Höchstens Urlaubstage')).toHaveValue('3');
	await page.getByLabel('Mindest-Faktor').fill('1.5');
	await page.getByLabel('Mindest-Faktor').blur();
	await page.reload();
	await expect(page.getByLabel('Mindest-Faktor')).toHaveValue('1.5');
	await page.getByRole('button', { name: 'Zurücksetzen' }).click();
	await expect(page.getByLabel('Höchstens Urlaubstage')).toHaveValue('10');
	await expect(page.getByLabel('Mindest-Faktor')).toHaveValue('2');
	await context.close();
});

test('planner: conflicts warn prominently and need an explicit acknowledgement before booking', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/vacation/planner');
	await page.getByTestId('planner-show-all').click();
	const card = page.locator('[data-testid="suggestion-card"][data-conflicts="yes"]').first();
	await expect(card).toBeVisible();
	await expect(card.getByTestId('suggestion-conflicts')).toContainText('Achtung');
	await card.getByTestId('take-over').click();
	const confirm = card.getByTestId('take-over-confirm-button');
	await expect(confirm).toBeDisabled();
	await card.getByTestId('ack-conflicts').check();
	await expect(confirm).toBeEnabled();
	await card.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(card.getByTestId('take-over-confirm')).toHaveCount(0);
	await context.close();
});

test('planner: take a suggestion over, see feedback and the vacation in the absences', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await page.goto('/vacation/planner');
	const card = page.locator('[data-testid="suggestion-card"][data-conflicts="no"]').first();
	await expect(card).toBeVisible();
	const range = (await card.getByTestId('suggestion-range').textContent())!;
	await card.getByTestId('take-over').click();
	await expect(card.getByTestId('take-over-blocks')).toContainText('Urlaubstag');
	if (dir) await page.screenshot({ path: `${dir}/planner-phone-confirm.png` });
	await card.getByTestId('take-over-confirm-button').click();
	await expect(page.getByTestId('planner-notice')).toContainText('eingetragen');
	// the booked days no longer appear as a suggestion with the same range
	await expect(page.getByTestId('suggestion-range').filter({ hasText: range })).toHaveCount(0);
	await page.getByTestId('planner-notice').getByRole('link', { name: 'Abwesenheiten ansehen' }).click();
	await expect(page).toHaveURL(/\/absences$/);
	await context.close();
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`planner screenshots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await page.goto('/vacation/planner');
			await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${dir}/planner-${name}-${scheme}.png`, fullPage: true });
			await context.close();
		});
	}
}
