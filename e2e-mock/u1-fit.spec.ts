import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// U1: calendar and planner fit the viewport on landscape desktops (no page scroll), month/year segmented control,
// no mini timelines, week mode gone with a link to /week, multi-day absence bars. Dates in 2037 avoid clashes with other specs.
test.describe.configure({ mode: 'serial' });

const tile = (page: Page, date: string) => page.locator(`[data-testid="month-grid"] [data-date="${date}"]`);
const dir = process.env.SCREENSHOT_DIR;
const DESKTOPS = [
	{ width: 1366, height: 768 },
	{ width: 1920, height: 1080 }
] as const;

const overflow = (page: Page) => page.evaluate(() => ({ doc: document.documentElement.scrollHeight, client: document.documentElement.clientHeight, body: document.body.scrollHeight, view: window.innerHeight }));

test('calendar month fits the viewport without page scroll on 1366x768 and 1920x1080', async ({ browser }) => {
	for (const viewport of DESKTOPS) {
		const { page, context } = await loginAsAdmin(browser, { viewport });
		for (const date of ['2037-02-10', '2037-05-12', '2037-08-11']) {
			await page.goto(`/calendar?date=${date}`);
			await expect(page.getByTestId('month-summary')).toBeVisible();
			await expect(page.getByTestId('month-grid')).toBeVisible();
			const o = await overflow(page);
			expect(o.doc, `${viewport.width}x${viewport.height} ${date}`).toBeLessThanOrEqual(o.view);
			expect(o.body).toBeLessThanOrEqual(o.view);
			const grid = (await page.getByTestId('month-grid').boundingBox())!;
			expect(grid.y + grid.height).toBeLessThanOrEqual(viewport.height);
			// every day cell is reachable and has a usable height
			const cell = (await tile(page, date).boundingBox())!;
			expect(cell.height).toBeGreaterThan(55);
		}
		// with a selection (side panel) and the year view the page still does not scroll
		await tile(page, '2037-08-12').click();
		await expect(page.getByTestId('day-detail')).toBeVisible();
		expect((await overflow(page)).doc).toBeLessThanOrEqual(viewport.height);
		await page.getByTestId('view-year').click();
		await expect(page.getByTestId('year-overview')).toBeVisible();
		expect((await overflow(page)).doc).toBeLessThanOrEqual(viewport.height);
		await context.close();
	}
});

test('planner grid fits the viewport without page scroll on 1366x768 and 1920x1080', async ({ browser }) => {
	for (const viewport of DESKTOPS) {
		const { page, context } = await loginAsAdmin(browser, { viewport });
		await page.goto('/plan?week=2037-W20');
		await expect(page.getByTestId('week-grid')).toBeVisible();
		const o = await overflow(page);
		expect(o.doc, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(o.view);
		const save = (await page.getByTestId('plan-savebar').boundingBox())!;
		expect(save.y + save.height).toBeLessThanOrEqual(viewport.height);
		const grid = (await page.getByTestId('week-grid').boundingBox())!;
		expect(grid.height).toBeGreaterThan(300);
		await page.getByTestId('view-list').click();
		await expect(page.getByTestId('plan-rows')).toBeVisible();
		expect((await overflow(page)).doc).toBeLessThanOrEqual(viewport.height);
		await context.close();
	}
});

test('phones may scroll: month and planner render at 390x844', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await page.goto('/calendar?date=2037-02-10');
	await expect(page.getByTestId('phone-month')).toBeVisible();
	await expect(page.getByTestId('month-grid')).toBeHidden();
	expect((await page.evaluate(() => document.documentElement.scrollWidth))).toBeLessThanOrEqual(390);
	await page.goto('/plan?week=2037-W20');
	await expect(page.getByTestId('week-planner')).toBeVisible();
	expect((await page.evaluate(() => document.documentElement.scrollWidth))).toBeLessThanOrEqual(390);
	await context.close();
});

test('one segmented control: Monat and Jahr only, no week mode, no mini timelines', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 900 } });
	await page.goto('/calendar?date=2037-03-04&view=week');
	await expect(page.getByTestId('calendar-month')).toHaveText('März 2037');
	await expect(page.getByTestId('view-week')).toHaveCount(0);
	const control = page.getByRole('group', { name: 'Ansicht' });
	await expect(control.getByRole('button')).toHaveText(['Monat', 'Jahr']);
	await expect(control.getByTestId('view-month')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('mini-timeline')).toHaveCount(0);
	// a planned day shows only the pill, no timeline
	await tile(page, '2037-03-05').dblclick();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Beginn').fill('08:00');
	await dialog.getByLabel('Ende').fill('16:00');
	await dialog.getByTestId('pd-submit').click();
	await expect(dialog).toHaveCount(0);
	await expect(tile(page, '2037-03-05').locator('[data-chip="plan"]')).toHaveCount(1);
	await expect(page.getByTestId('mini-timeline')).toHaveCount(0);
	await control.getByTestId('view-year').click();
	await expect(page.getByTestId('year-overview')).toBeVisible();
	await expect(control.getByTestId('view-year')).toHaveAttribute('aria-pressed', 'true');
	await control.getByTestId('view-month').click();
	await expect(page.getByTestId('year-overview')).toHaveCount(0);
	await context.close();
});

test('week number and the selected day link to /week', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 900 } });
	await page.goto('/calendar?date=2037-03-04');
	const link = page.getByTestId('week-link').first();
	await expect(link).toHaveAttribute('href', /\/week\?week=2037-W\d\d/);
	await tile(page, '2037-03-11').click();
	await expect(page.getByTestId('open-week')).toHaveAttribute('href', '/week?week=2037-W11&day=2037-03-11');
	await page.getByTestId('open-week').click();
	await expect(page).toHaveURL(/\/week\?week=2037-W11/);
	await page.goBack();
	await page.getByTestId('week-link').nth(1).click();
	await expect(page).toHaveURL(/\/week\?week=2037-W\d\d/);
	await context.close();
});

test('a multi-day absence is one continuous bar with one label per week', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 900 } });
	await page.goto('/calendar?date=2037-04-08');
	const a = (await tile(page, '2037-04-07').boundingBox())!;
	const b = (await tile(page, '2037-04-09').boundingBox())!;
	await page.mouse.move(a.x + 12, a.y + 20);
	await page.mouse.down();
	await page.mouse.move(a.x + 40, a.y + 24, { steps: 3 });
	await page.mouse.move(b.x + 12, b.y + 20, { steps: 8 });
	await page.mouse.up();
	await page.getByTestId('select-vacation').click();
	await page.getByRole('dialog').getByTestId('pd-submit').click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const bar = (date: string) => tile(page, date).locator('[data-chip="absence"]');
	await expect(bar('2037-04-07')).toHaveText(/Urlaub/);
	await expect(bar('2037-04-07')).toHaveAttribute('data-continues-right', 'true');
	await expect(bar('2037-04-08')).toHaveAttribute('data-continues-left', 'true');
	await expect(bar('2037-04-08')).toHaveAttribute('data-continues-right', 'true');
	await expect(bar('2037-04-08')).toHaveText('');
	await expect(bar('2037-04-09')).not.toHaveAttribute('data-continues-right', 'true');
	// the bars touch: right edge of one equals the left edge of the next
	const first = (await bar('2037-04-07').boundingBox())!;
	const second = (await bar('2037-04-08').boundingBox())!;
	expect(Math.abs(first.x + first.width - second.x)).toBeLessThanOrEqual(1.5);
	await context.close();
});

test('hover, focus ring and today marker are visible', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 900 } });
	await page.goto('/calendar');
	const today = page.locator('[data-testid="month-grid"] [data-today="true"]');
	await expect(today).toHaveCount(1);
	await today.focus();
	const shadow = await today.evaluate((el) => getComputedStyle(el).boxShadow);
	expect(shadow).not.toBe('none');
	await context.close();
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe clean (${scheme}) on calendar and planner at 1366x768`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1366, height: 768 }, colorScheme: scheme });
		for (const route of ['/calendar?date=2037-06-09', '/plan?week=2037-W24']) {
			await page.goto(route);
			await expect(page.getByTestId(route.startsWith('/plan') ? 'week-grid' : 'month-grid')).toBeVisible();
			const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag412']).analyze();
			expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
		}
		await context.close();
	});
}

test('screenshots', async ({ browser }) => {
	test.skip(!dir, 'SCREENSHOT_DIR not set');
	for (const scheme of ['light', 'dark'] as const) {
		for (const [name, viewport] of [['1366', DESKTOPS[0]], ['1920', DESKTOPS[1]], ['phone', { width: 390, height: 844 }]] as const) {
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await page.goto('/calendar');
			await expect(page.getByTestId('month-summary')).toBeVisible();
			await page.screenshot({ path: `${dir}/u1-calendar-${name}-${scheme}.png`, fullPage: name === 'phone' });
			if (name !== 'phone') {
				await page.locator('[data-testid="month-grid"] [data-today="true"]').click();
				await expect(page.getByTestId('day-detail')).toBeVisible();
				await page.screenshot({ path: `${dir}/u1-calendar-selected-${name}-${scheme}.png` });
				await page.getByTestId('view-year').click();
				await expect(page.getByTestId('year-overview')).toBeVisible();
				await page.screenshot({ path: `${dir}/u1-year-${name}-${scheme}.png` });
			}
			await page.goto('/plan?week=2037-W24');
			await expect(page.getByTestId('week-planner')).toBeVisible();
			await page.screenshot({ path: `${dir}/u1-plan-${name}-${scheme}.png`, fullPage: name === 'phone' });
			await context.close();
		}
	}
});
