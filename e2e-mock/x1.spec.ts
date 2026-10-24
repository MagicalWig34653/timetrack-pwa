import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// X1 review fixes against the in-repo mock API.
test.describe.configure({ mode: 'serial' });

// 2033-W22 = 30.05.-05.06.2033: ordinary week, not used by the other specs.
const MONDAY = '2033-05-30';
const WEEK = '2033-W22';
const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const day = (n: number) => addDays(MONDAY, n);

async function point(page: Page, date: string, minute: number) {
	const grid = page.getByTestId('week-grid');
	const startHour = Number(await grid.getAttribute('data-start-hour'));
	const hh = Number(await grid.getAttribute('data-hour-height'));
	const box = (await page.getByTestId(`col-${date}`).boundingBox())!;
	return { x: box.x + box.width * 0.5, y: box.y + ((minute - startHour * 60) / 60) * hh };
}
async function paint(page: Page, date: string, from: number, to: number) {
	const a = await point(page, date, from);
	const b = await point(page, date, to);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(b.x, (a.y + b.y) / 2, { steps: 4 });
	await page.mouse.move(b.x, b.y, { steps: 6 });
	await page.mouse.up();
}

test('edits made while the plan is being saved are kept and stay unsaved', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.goto(`/plan?week=${WEEK}&view=grid`);
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await page.getByTestId('week-grid-scroll').evaluate((el) => (el.scrollTop = 0));

	await paint(page, day(1), 9 * 60, 12 * 60);
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('09:00–12:00');

	// hold the PUT response back so the second edit happens while the save is in flight
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route(`**/plan/weeks/${WEEK}`, async (route) => {
		if (route.request().method() !== 'PUT') return route.fallback();
		const response = await route.fetch();
		await gate;
		await route.fulfill({ response });
	});
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-save')).toHaveAttribute('aria-busy', 'true');

	await paint(page, day(2), 10 * 60, 13 * 60);
	await expect(page.getByTestId(`block-time-${day(2)}`)).toHaveText('10:00–13:00');
	release();

	await expect(page.getByTestId('plan-save')).toHaveAttribute('aria-busy', 'false');
	// the newer edit survived the response, the saved one is still there, and the plan is dirty again
	await expect(page.getByTestId(`block-time-${day(2)}`)).toHaveText('10:00–13:00');
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('09:00–12:00');
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'true');

	// the second edit can still be saved and undone history is coherent
	await page.unroute(`**/plan/weeks/${WEEK}`);
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');
	await expect(page.getByTestId(`block-time-${day(2)}`)).toHaveText('10:00–13:00');
	await context.close();
});

test('the offline page returns to the requested page and ignores external targets', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/offline?from=%2Fweek%3Fweek%3D2033-W22');
	await expect(page.getByTestId('offline-retry')).toHaveAttribute('data-target', '/week?week=2033-W22');
	await page.getByTestId('offline-retry').click();
	await expect(page).toHaveURL(/\/week\?week=2033-W22$/);

	for (const bad of ['https%3A%2F%2Fevil.example%2F', '%2F%2Fevil.example', 'javascript%3Aalert(1)', '%2Foffline']) {
		await page.goto(`/offline?from=${bad}`);
		await expect(page.getByTestId('offline-retry')).toHaveAttribute('data-target', '/');
	}
	await context.close();
});
