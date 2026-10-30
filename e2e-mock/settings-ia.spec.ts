import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// U8: settings landing page, grouped navigation, old URLs keep working.
test('settings landing lists grouped entries and is axe clean', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 800 } });
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Einstellungen', level: 1 })).toBeVisible();
	await expect(page.getByTestId('settings-landing').locator('[data-settings-group="work"]')).toBeVisible();
	await page.getByTestId('settings-landing-search').fill('papierkorb');
	await expect(page.getByTestId('settings-landing').getByRole('link')).toHaveCount(1);
	const result = await new AxeBuilder({ page }).analyze();
	expect(result.violations).toEqual([]);
	await context.close();
});

test('old settings URLs still render', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 800 } });
	for (const path of ['/settings/work-model', '/settings/passkeys', '/settings/privacy', '/settings/appearance']) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	}
	await context.close();
});
