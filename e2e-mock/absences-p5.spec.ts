import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Package P5 on the dev mock: calendar tile backgrounds, absence list filters, attachment preview.
// Review screenshots (light/dark x phone/desktop) are written only when SCREENSHOT_DIR is set.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

const viewports = [
	['phone', { width: 390, height: 844 }],
	['desktop', { width: 1280, height: 900 }]
] as const;

test('calendar tiles differ by work state in the computed background', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await page.goto('/calendar');
	const tiles = page.getByTestId('month-grid').locator('button[data-work-state]');
	await expect(tiles.first()).toBeVisible();
	const backgrounds = async (state: string) => tiles.evaluateAll((els, s) => els.filter((e) => e.getAttribute('data-work-state') === s).map((e) => getComputedStyle(e).backgroundColor), state);
	const work = await backgrounds('work');
	const free = await backgrounds('free');
	expect(work.length).toBeGreaterThan(0);
	expect(free.length).toBeGreaterThan(0);
	expect(work[0]).not.toBe(free[0]);
	await expect(page.getByTestId('tile-legend').getByRole('listitem')).toHaveCount(6);
	await context.close();
});

test('absence list: filter, sort, URL and attachment preview with the seeded files', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: viewports[1][1] });
	await page.goto('/absences');
	const rows = page.getByTestId('absence-row');
	await expect(rows).toHaveCount(4);
	await page.getByLabel('Art', { exact: true }).selectOption('sick');
	await expect(rows).toHaveCount(1);
	await expect(page).toHaveURL(/kind=sick/);
	await page.getByRole('button', { name: /^Anhänge \(2\)$/ }).click();
	await page.getByRole('button', { name: 'Attest-Scan.png ansehen' }).click();
	const dialog = page.getByTestId('preview-dialog');
	await expect(dialog.getByTestId('preview-image')).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Krankmeldung.pdf ansehen' }).click();
	await expect(dialog.getByTestId('preview-pdf').or(dialog.getByTestId('preview-unsupported'))).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByTestId('absences-reset').click();
	await expect(rows).toHaveCount(4);
	await context.close();
});

for (const [name, viewport] of viewports) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`p5 shots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			// demo data: approved vacation starts 14 days after this week's Monday, planned vacation after 42 days
			const monday = new Date();
			monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
			const day = (offset: number) => new Date(monday.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
			for (const [label, offset] of [['approved', 15], ['planned', 43]] as const) {
				await page.goto(`/calendar?date=${day(offset)}`);
				await expect(page.getByTestId('tile-legend')).toBeVisible();
				await page.waitForTimeout(400);
				await page.screenshot({ path: `${dir}/calendar-${label}-${name}-${scheme}.png`, fullPage: true });
			}
			// vacation weeks of the demo data (approved in 2 weeks, planned in 6)
			await page.goto('/absences?kind=vacation&sort=date_desc');
			await expect(page.getByTestId('absence-row').first()).toBeVisible();
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${dir}/absences-${name}-${scheme}.png`, fullPage: true });
			await page.goto('/absences?kind=sick');
			await page.getByRole('button', { name: /^Anhänge \(2\)$/ }).click();
			await page.getByRole('button', { name: 'Attest-Scan.png ansehen' }).click();
			await expect(page.getByTestId('preview-image')).toBeVisible();
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${dir}/preview-image-${name}-${scheme}.png` });
			await page.keyboard.press('Escape');
			await page.getByRole('button', { name: 'Krankmeldung.pdf ansehen' }).click();
			await expect(page.getByTestId('preview-pdf').or(page.getByTestId('preview-unsupported'))).toBeVisible();
			await page.waitForTimeout(800);
			await page.screenshot({ path: `${dir}/preview-pdf-${name}-${scheme}.png` });
			await context.close();
		});
	}
}
