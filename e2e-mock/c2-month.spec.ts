import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// C2: redesigned month calendar. Dates lie in 2033 so they do not collide with other specs on the shared mock server.
test.describe.configure({ mode: 'serial' });

const tile = (page: Page, date: string) => page.locator(`[data-testid="month-grid"] [data-date="${date}"]`);
const dir = process.env.SCREENSHOT_DIR;

test('range drag shows the floating bar and plans vacation; summary counts it', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.goto('/calendar?date=2033-03-07');
	await expect(page.getByTestId('calendar-month')).toHaveText('März 2033');
	await expect(page.getByTestId('month-summary')).toBeVisible();
	const a = (await tile(page, '2033-03-07').boundingBox())!;
	const b = (await tile(page, '2033-03-09').boundingBox())!;
	await page.mouse.move(a.x + 12, a.y + 20);
	await page.mouse.down();
	await page.mouse.move(a.x + 40, a.y + 24, { steps: 3 });
	await page.mouse.move(b.x + 12, b.y + 20, { steps: 8 });
	await page.mouse.up();
	const bar = page.getByTestId('selection-bar');
	await expect(bar).toBeVisible();
	await expect(page.getByTestId('bar-count')).toHaveText('3 Tage ausgewählt');
	for (const key of ['vacation', 'sick', 'plan', 'excused']) await expect(bar.getByTestId(`select-${key}`)).toBeVisible();
	await bar.getByTestId('select-vacation').click();
	await page.getByRole('dialog').getByTestId('pd-submit').click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	// planned vacation is hatched
	await expect(tile(page, '2033-03-08')).toHaveClass(/cell-vac-open/);
	await expect(page.getByTestId('sum-vacation')).toContainText('offen');
	await context.close();
});

test('keyboard: arrows move, Shift+arrows extend the range, Enter opens the day panel', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.goto('/calendar?date=2033-04-12');
	await tile(page, '2033-04-12').focus();
	await page.keyboard.press('ArrowRight');
	await expect(tile(page, '2033-04-13')).toBeFocused();
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await expect(page.getByTestId('bar-count')).toHaveText('3 Tage ausgewählt');
	await page.keyboard.press('Escape');
	await tile(page, '2033-04-14').focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('inspector')).toContainText('14');
	await context.close();
});

test('context menu on a day via right click', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.goto('/calendar?date=2033-04-12');
	await tile(page, '2033-04-19').click({ button: 'right' });
	await expect(page.getByRole('menuitem', { name: 'Krank eintragen' })).toBeVisible();
	await page.keyboard.press('Escape');
	await context.close();
});

test('switching the month keeps the layout in place', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.goto('/calendar?date=2033-05-10');
	await expect(page.getByTestId('calendar-month')).toHaveText('Mai 2033');
	const top = async () => (await page.getByTestId('month-grid').boundingBox())!.y;
	const wrap = async () => (await page.getByTestId('board-wrap').boundingBox())!.height;
	const y0 = await top();
	const h0 = await wrap();
	for (const [name, label] of [['Nächster Monat', 'Juni 2033'], ['Nächster Monat', 'Juli 2033'], ['Vorheriger Monat', 'Juni 2033']] as const) {
		await page.getByRole('link', { name }).and(page.locator(':visible')).click();
		await expect(page.getByTestId('calendar-month')).toHaveText(label);
		expect(Math.abs((await top()) - y0)).toBeLessThanOrEqual(1);
		expect(Math.abs((await wrap()) - h0)).toBeLessThanOrEqual(1);
	}
	await context.close();
});

test('year overview toggles and jumps to a month', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.goto('/calendar?date=2033-05-10');
	await page.getByTestId('view-year').click();
	await expect(page.getByTestId('year-overview')).toBeVisible();
	await expect(page.getByTestId('year-overview').locator('[data-date]')).toHaveCount(365);
	await page.getByTestId('year-month-9').getByRole('button').click();
	await expect(page.getByTestId('year-overview')).toHaveCount(0);
	await expect(page.getByTestId('calendar-month')).toHaveText('September 2033');
	await context.close();
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe clean (${scheme}) on desktop and phone`, async ({ browser }) => {
		for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await page.goto('/calendar?date=2033-06-06');
			await expect(page.getByTestId('month-summary')).toBeVisible();
			const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag412']).analyze();
			expect(results.violations).toEqual([]);
			await context.close();
		}
	});
}

test('screenshots', async ({ browser }) => {
	test.skip(!dir, 'SCREENSHOT_DIR not set');
	for (const scheme of ['light', 'dark'] as const) {
		for (const [name, viewport] of [['desktop', { width: 1440, height: 1300 }], ['phone', { width: 390, height: 844 }]] as const) {
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await page.goto('/calendar?date=2033-06-06');
			await expect(page.getByTestId('month-summary')).toBeVisible();
			await page.screenshot({ path: `${dir}/c2-month-${name}-${scheme}.png`, fullPage: name === 'phone' });
			if (name === 'desktop') {
				await page.getByTestId('view-year').click();
				await expect(page.getByTestId('year-overview')).toBeVisible();
				await page.screenshot({ path: `${dir}/c2-year-${scheme}.png` });
			}
			await context.close();
		}
	}
});
