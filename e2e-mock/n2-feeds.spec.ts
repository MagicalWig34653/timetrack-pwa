import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

test('calendar feeds: create shows the URL once, list hides it, revoke needs confirmation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/calendar-feeds');
	await expect(page.getByRole('heading', { name: 'Kalender-Abos', level: 1 })).toBeVisible();
	await page.getByLabel('Bezeichnung').fill('Apple Kalender');
	await page.getByLabel('Geplante Arbeitstage').check();
	await page.getByRole('button', { name: 'Abo erzeugen' }).click();
	await expect(page.getByTestId('feed-url')).toContainText('/ics/');
	await expect(page.getByTestId('feed-url')).toContainText('.ics');
	await expect(page.getByTestId('feed-list')).toContainText('Abwesenheiten, Feiertage und Schulferien, Geplante Arbeitstage');
	const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
	expect(results.violations).toEqual([]);
	await page.getByRole('button', { name: 'Ich habe sie gespeichert' }).click();
	await expect(page.getByTestId('feed-url')).toHaveCount(0);
	await page.getByRole('button', { name: 'Abo „Apple Kalender“ widerrufen' }).click();
	await page.getByRole('button', { name: 'Endgültig widerrufen' }).click();
	await expect(page.getByText('Abo widerrufen.')).toBeVisible();
	await expect(page.getByTestId('feed-list')).toHaveCount(0);
	await context.close();
});

test('calendar feeds: validation and phone width', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await page.goto('/settings/calendar-feeds');
	await page.getByRole('button', { name: 'Abo erzeugen' }).click();
	await expect(page.getByText('Bitte gib eine Bezeichnung an.')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
	await context.close();
});
