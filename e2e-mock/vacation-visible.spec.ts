import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// V7: a day marked as vacation must be clearly visible in the month grid, the phone grid and the year overview, in every
// status (planned, requested, approved, half day), also right after saving while the day is still selected.
// Dates lie in February 2035 (Mon 2035-02-05) so they do not collide with the other planning specs on the shared mock server.
test.describe.configure({ mode: 'serial' });

const tile = (page: Page, date: string) => page.locator(`[data-testid="month-grid"] [data-date="${date}"]`);

/** Alpha channel of a computed colour such as "oklab(0.7 -0.1 -0.1 / 0.12)" or "rgba(0, 0, 0, 0.1)". */
const alphaOf = (color: string) => {
	const m = /\/\s*([\d.]+%?)\s*\)/.exec(color) ?? /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(color);
	if (!m) return color.startsWith('rgb(') || color.startsWith('oklab(') || color.startsWith('oklch(') ? 1 : 0;
	return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
};

async function mark(page: Page, date: string, status: string, half = false) {
	await tile(page, date).click();
	await page.getByTestId('select-vacation').click();
	await page.locator('#pd-status').selectOption(status);
	if (half) await page.locator('#pd-half-start').check();
	await page.getByTestId('pd-submit').click();
	await expect(page.getByTestId('plan-dialog')).toHaveCount(0);
}

test('month grid: every vacation status is visible right after saving and after leaving the selection', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2035-02-05');
	await expect(page.getByTestId('calendar-month')).toHaveText('Februar 2035');
	const days = { planned: '2035-02-06', requested: '2035-02-07', approved: '2035-02-08' } as const;
	for (const [status, date] of Object.entries(days)) {
		await mark(page, date, status);
		const chip = tile(page, date).locator('[data-chip="absence"]');
		await expect(chip, `${status}: pill right after saving (day still selected)`).toBeVisible();
		await expect(chip).toHaveAttribute('data-status', status);
		await expect(chip).toContainText('Urlaub');
		const box = (await chip.boundingBox())!;
		expect(box.height, `${status}: pill is not clipped`).toBeGreaterThanOrEqual(16);
	}
	await mark(page, '2035-02-09', 'approved', true);
	await expect(tile(page, '2035-02-09').locator('[data-chip="absence"]')).toContainText('½');

	await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
	for (const date of [...Object.values(days), '2035-02-09']) {
		const cell = tile(page, date);
		const bg = await cell.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(alphaOf(bg), `${date}: the cell is tinted (${bg})`).toBeGreaterThanOrEqual(0.1);
		const pillBg = await cell.locator('[data-chip="absence"]').evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(alphaOf(pillBg), `${date}: pill background (${pillBg})`).toBeGreaterThanOrEqual(0.2);
	}
	// the summary counts what the grid shows
	await expect(page.getByTestId('sum-vacation')).toContainText('1,5 genehmigt · 2 offen');
	await context.close();
});

test('year overview and phone grid mark the same days', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2035-02-05');
	await expect(page.getByTestId('calendar-month')).toHaveText('Februar 2035');
	await page.getByTestId('view-year').click();
	const year = page.getByTestId('year-overview');
	await expect(year).toBeVisible();
	for (const date of ['2035-02-06', '2035-02-07', '2035-02-08']) {
		const cell = year.locator(`[data-date="${date}"]`);
		// the year loads its own data after opening
		await expect.poll(async () => alphaOf(await cell.evaluate((el) => getComputedStyle(el).backgroundColor)), { message: `${date}: year cell is tinted` }).toBeGreaterThan(0);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByTestId('view-month').click();
	const phone = (date: string) => page.locator(`[data-testid="phone-month"] [data-date="${date}"]`);
	await expect(phone('2035-02-06').locator('[data-dot="vacation"]')).toHaveCount(1);
	await expect(phone('2035-02-08').locator('[data-dot="vacation"]')).toHaveCount(1);
	for (const date of ['2035-02-06', '2035-02-08']) {
		const bg = await phone(date).evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(alphaOf(bg), `${date}: phone cell is tinted (${bg})`).toBeGreaterThanOrEqual(0.1);
	}
	await context.close();
});

test('hiding vacation in the legend is announced on the filter button', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2035-02-05');
	await expect(page.getByTestId('calendar-month')).toHaveText('Februar 2035');
	await expect(page.getByTestId('filter-hidden')).toHaveCount(0);
	await page.getByTestId('calendar-legends').locator('summary').click();
	await page.getByTestId('calendar-legend').getByRole('button', { name: 'Urlaub' }).click();
	await expect(tile(page, '2035-02-06').locator('[data-chip="absence"]')).toHaveCount(0);
	await expect(page.getByTestId('filter-hidden')).toHaveText('1 ausgeblendet');
	await page.getByTestId('calendar-legend').getByRole('button', { name: 'Urlaub' }).click();
	await expect(page.getByTestId('filter-hidden')).toHaveCount(0);
	await expect(tile(page, '2035-02-06').locator('[data-chip="absence"]')).toBeVisible();
	await context.close();
});
