import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Screenshots of the planner with several blocks per day (P13); only with SCREENSHOT_DIR set.
const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, 'SCREENSHOT_DIR not set');
test.describe.configure({ mode: 'serial' });

const sizes = [
	{ name: 'desktop', width: 1440, height: 1400 },
	{ name: 'phone', width: 390, height: 844 }
];
// 2035-W21 = Monday 21.05.2035 (own week without holidays: no other spec writes there)
const MONDAY = '2035-05-21';
const addDays = (date: string, n: number) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8) + n)).toISOString().slice(0, 10);

async function paint(page: Page, date: string, from: number, to: number) {
	const grid = page.getByTestId('week-grid');
	const startHour = Number(await grid.getAttribute('data-start-hour'));
	const hh = Number(await grid.getAttribute('data-hour-height'));
	const box = (await page.getByTestId(`col-${date}`).boundingBox())!;
	const y = (m: number) => box.y + ((m - startHour * 60) / 60) * hh;
	await page.mouse.move(box.x + box.width / 2, y(from));
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, (y(from) + y(to)) / 2, { steps: 4 });
	await page.mouse.move(box.x + box.width / 2, y(to), { steps: 6 });
	await page.mouse.up();
}

for (const scheme of ['light', 'dark'] as const) {
	for (const size of sizes) {
		test(`planner with blocks ${size.name} ${scheme}`, async ({ browser }) => {
			const { page, context } = await loginAsAdmin(browser, { viewport: { width: size.width, height: size.height }, colorScheme: scheme });
			await page.goto(`/plan?week=2035-W21&view=grid`);
			await expect(page.getByTestId('week-grid')).toBeVisible();
			await page.getByTestId('week-grid-scroll').evaluate((el) => (el.scrollTop = 0));
			const days = size.name === 'phone' ? [MONDAY] : [MONDAY, addDays(MONDAY, 1), addDays(MONDAY, 2), addDays(MONDAY, 3)];
			if (size.name === 'phone') await page.getByTestId(`day-tab-${MONDAY}`).click();
			for (const date of days) {
				if (size.name === 'phone') {
					// touch path: the dialog adds each block
					for (const [kind, start, end] of [['school', '08:00', '12:00'], ['work', '12:30', '15:00'], ['travel', '15:30', '16:30']]) {
						await page.getByTestId('plan-add-block').click();
						await page.getByTestId('bd-day').selectOption(date);
						await page.getByTestId('bd-kind').selectOption(kind);
						await page.getByTestId('bd-start').fill(start);
						await page.getByTestId('bd-end').fill(end);
						await page.getByTestId('bd-submit').click();
						await expect(page.getByTestId('block-dialog')).toHaveCount(0);
					}
					continue;
				}
				await page.getByTestId('brush-school').click();
				await paint(page, date, 8 * 60, 12 * 60);
				await page.getByTestId('brush-work').click();
				await paint(page, date, 12 * 60 + 30, 15 * 60);
				await page.getByTestId('brush-travel').click();
				await paint(page, date, 15 * 60 + 30, 16 * 60 + 30);
			}
			if (size.name !== 'phone') {
				// one day without a break shows the planning hints
				await page.getByTestId('brush-office').click();
				await paint(page, addDays(MONDAY, 4), 8 * 60, 17 * 60);
			}
			await page.getByTestId('week-grid').scrollIntoViewIfNeeded();
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${dir}/p13-planner-${size.name}-${scheme}.jpg`, type: 'jpeg', quality: 70 });
			await page.getByTestId('view-list').click();
			await expect(page.getByTestId('plan-rows')).toBeVisible();
			await page.waitForTimeout(200);
			await page.screenshot({ path: `${dir}/p13-list-${size.name}-${scheme}.jpg`, type: 'jpeg', quality: 70 });
			await context.close();
		});
	}
}
