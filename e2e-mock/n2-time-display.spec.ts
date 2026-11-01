import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

test('clicking a duration toggles h:mm and decimal hours everywhere and survives reload', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/stats');
	const actual = page.getByTestId('stats-actual');
	await expect(actual).toBeVisible();
	await expect(actual).toHaveText(/^\d+:\d{2}$/);
	const button = actual.getByRole('button');
	await expect(button).toHaveAttribute('title', /Dezimalstunden/);
	await button.focus();
	await page.keyboard.press('Enter');
	await expect(actual).toHaveText(/^\d+,\d{2} h$/);
	await page.reload();
	await expect(page.getByTestId('stats-actual')).toHaveText(/^\d+,\d{2} h$/);
	await page.goto('/week');
	await expect(page.getByTestId('week-actual')).toHaveText(/^\d+,\d{2} h$/);
	await page.getByTestId('week-actual').getByRole('button').click();
	await expect(page.getByTestId('week-actual')).toHaveText(/^\d+:\d{2}$/);
	await context.close();
});
