import { test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// Review screenshots of the accent picker (AC2); only runs with SCREENSHOT_DIR.
const dir = process.env.SCREENSHOT_DIR;

for (const scheme of ['light', 'dark'] as const) {
	test(`accent picker ${scheme}`, async ({ browser }) => {
		test.skip(!dir, 'set SCREENSHOT_DIR');
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 }, colorScheme: scheme });
		await page.goto('/settings/appearance');
		await page.getByTestId(`mode-${scheme}`).click();
		await page.getByTestId('accent-picker').first().waitFor();
		await page.waitForLoadState('networkidle');
		await page.getByTestId('accent-picker').first().screenshot({ path: `${dir}/${scheme}-picker.png` });
		for (const id of ['wine', 'ink', 'ocean']) {
			await page.getByTestId(`accent-${id}`).click();
			await page.goto('/');
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${dir}/${scheme}-${id}-home.png` });
			await page.goto('/settings/appearance');
		}
		await page.getByTestId('accent-blue').click();
		await page.getByTestId('mode-system').click();
		await page.waitForFunction(() => document.querySelector('[data-testid=appearance-sync]')?.getAttribute('data-state') === 'saved');
		await context.close();
	});
}
