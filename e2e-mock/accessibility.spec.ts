import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './test';
import { loginAsAdmin } from './helpers';

test('login has accessible labels, contrast, and landmarks', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
	const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
	expect(results.violations).toEqual([]);
});

for (const route of ['/', '/time', '/reports', '/vacation', '/settings/profile']) {
	test(`${route} has accessible labels, contrast, and landmarks`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser);
		await page.goto(route);
		await expect(page.locator('main')).toBeVisible();
		const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
		expect(results.violations).toEqual([]);
		await context.close();
	});
}
