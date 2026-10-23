import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// Screenshots of the week grid (P11); only with SCREENSHOT_DIR set.
const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, 'SCREENSHOT_DIR not set');
test.describe.configure({ mode: 'serial' });

const sizes = [
	{ name: 'wide', width: 1680, height: 1000 },
	{ name: 'laptop', width: 1280, height: 800 },
	{ name: 'phone', width: 390, height: 844 }
];

for (const scheme of ['light', 'dark'] as const) {
	for (const size of sizes) {
		test(`grid ${size.name} ${scheme}`, async ({ browser }) => {
			const { page, context } = await loginAsAdmin(browser, { viewport: { width: size.width, height: size.height }, colorScheme: scheme });
			await page.goto('/plan?week=2033-W20&view=grid');
			await expect(page.getByTestId('week-grid')).toBeVisible();
			if (size.name !== 'phone') await page.getByTestId('plan-standard').click();
			else {
				await page.getByTestId('plan-add-block').click();
				await page.getByTestId('bd-start').fill('08:00');
				await page.getByTestId('bd-end').fill('16:30');
				await page.getByTestId('bd-submit').click();
			}
			await page.getByTestId('toggle-actuals').click();
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${dir}/grid-${size.name}-${scheme}.jpg`, type: 'jpeg', quality: 70 });
			await context.close();
		});
	}
}
