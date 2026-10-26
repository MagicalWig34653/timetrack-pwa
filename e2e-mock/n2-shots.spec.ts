import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Review screenshots of package N2; only with SCREENSHOT_DIR (and SHOT_ROUTES, comma separated, default calendar/week/plan).
const dir = process.env.SCREENSHOT_DIR;
const routes = (process.env.SHOT_ROUTES ?? '/calendar,/week,/plan').split(',');

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`n2 shots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			for (const route of routes) {
				await page.goto(route);
				await page.waitForLoadState('networkidle');
				await expect(page.locator('main')).toBeVisible();
				await page.screenshot({ path: `${dir}/${route.replace(/[^a-z0-9]+/gi, '_')}-${name}-${scheme}.png`, fullPage: true });
			}
			await context.close();
		});
	}
}
