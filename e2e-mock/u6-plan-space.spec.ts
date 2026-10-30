import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// U6: the planning grid gets the vertical space. Landscape desktops: one toolbar block above, one row below the grid;
// from 1600 px wide the summary, actions, notices and the save bar move into a side panel. Dates in 2037 avoid clashes.
test.describe.configure({ mode: 'serial' });

const SIZES = [
	{ width: 1280, height: 720, minGrid: 400, side: false },
	{ width: 1440, height: 900, minGrid: 580, side: false },
	{ width: 1920, height: 1080, minGrid: 820, side: true }
] as const;

for (const size of SIZES) {
	test(`grid keeps the height on ${size.width}x${size.height} (${size.side ? 'side panel' : 'bottom row'}), no page scroll, save reachable`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: size.width, height: size.height } });
		await page.goto('/plan?week=2037-W20');
		await expect(page.getByTestId('week-grid')).toBeVisible();
		await expect(page.getByTestId('planner-board')).toHaveAttribute('data-layout', size.side ? 'side' : 'stack');
		await page.getByTestId('plan-standard').click();
		const grid = (await page.getByTestId('week-grid').boundingBox())!;
		expect(grid.height).toBeGreaterThan(size.minGrid);
		const o = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, view: window.innerHeight }));
		expect(o.doc).toBeLessThanOrEqual(o.view);
		// everything stays reachable and inside the viewport
		for (const id of ['plan-save', 'plan-discard', 'plan-standard', 'plan-copy', 'plan-follow', 'plan-same', 'plan-clear', 'view-list', 'plan-total-text', 'plan-dirty']) {
			const box = await page.getByTestId(id).boundingBox();
			expect(box, id).not.toBeNull();
			expect(box!.y + box!.height, id).toBeLessThanOrEqual(size.height);
			expect(box!.x + box!.width, id).toBeLessThanOrEqual(size.width);
		}
		if (size.side) {
			const side = (await page.getByTestId('plan-side').boundingBox())!;
			expect(grid.x + grid.width).toBeLessThanOrEqual(side.x + 1);
		}
		// saving works from here
		await page.getByTestId('plan-save').click();
		await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');
		const axe = await new AxeBuilder({ page }).analyze();
		expect(axe.violations.map((v) => v.id)).toEqual([]);
		await context.close();
	});
}

test('phone and tablet keep a sticky save bar and scroll the page', async ({ browser }) => {
	for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }]) {
		const { page, context } = await loginAsAdmin(browser, { viewport });
		await page.goto('/plan?week=2037-W21');
		await expect(page.getByTestId('week-grid')).toBeVisible();
		const save = (await page.getByTestId('plan-savebar').boundingBox())!;
		expect(save.y + save.height).toBeLessThanOrEqual(viewport.height + 1);
		await expect(page.getByTestId('plan-total-text')).toBeVisible();
		await context.close();
	}
});
