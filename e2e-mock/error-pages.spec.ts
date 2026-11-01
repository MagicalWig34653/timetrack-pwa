import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Designed error pages (E1). Screenshots only with SCREENSHOT_DIR. Light/dark x phone/desktop.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

test('unknown address, signed out: designed 404 with links, focus on the heading', async ({ page }) => {
	await page.goto('/gibt-es-nicht');
	const heading = page.getByRole('heading', { level: 1, name: 'Seite nicht gefunden' });
	await expect(heading).toBeVisible();
	await expect(heading).toBeFocused();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByTestId('error-path')).toHaveText('/gibt-es-nicht');
	for (const name of ['Heute', 'Kalender', 'Woche']) await expect(page.getByRole('link', { name }).first()).toBeVisible();
	await expect(page.locator('body')).not.toContainText('Not Found');
});

test('unknown address, signed in: 404 inside the app navigation leads back to Heute', async ({ browser }) => {
	const { context, page } = await loginAsAdmin(browser);
	await page.goto('/time/gibt-es-nicht/zusatz');
	await expect(page.getByRole('heading', { level: 1, name: 'Seite nicht gefunden' })).toBeVisible();
	await page.getByRole('link', { name: 'Heute' }).first().click();
	await expect(page.getByRole('heading', { name: /^Hallo, / })).toBeVisible();
	await context.close();
});

for (const colorScheme of ['light', 'dark'] as const) {
	for (const [label, viewport] of [['phone', { width: 390, height: 780 }], ['desktop', { width: 1280, height: 800 }]] as const) {
		test(`screenshot 404 ${colorScheme} ${label}`, async ({ browser }) => {
			test.skip(!dir, 'SCREENSHOT_DIR not set');
			const context = await browser.newContext({ colorScheme, viewport });
			const page = await context.newPage();
			await page.goto('/gibt-es-nicht');
			await expect(page.getByTestId('error-page')).toBeVisible();
			await page.screenshot({ path: `${dir}/404-${colorScheme}-${label}.png` });
			await context.close();
		});
	}
}
