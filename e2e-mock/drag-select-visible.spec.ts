import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Bug 26.11.2026 (Lino): in the month grid, days marked by dragging with the mouse button held down were not all highlighted.
// The selection used Tailwind utilities (ring-2, bg-primary/10), but the unlayered cell rules for vacation (.cell-vac-*: box-shadow)
// and holidays (.cell-holiday: background-color) and the hover tint beat them, so a vacation day lost its selection ring, a
// holiday kept its amber tint and the day under the pointer turned grey. Every selected day must look the same, during the drag
// and after releasing the button, light and dark. Screenshots go to SCREENSHOT_DIR when it is set.
test.describe.configure({ mode: 'serial' });

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
}

const cases = [
	{ scheme: 'light', days: ['2037-07-06', '2037-07-07', '2037-07-08', '2037-07-09'], plain: '2037-07-13' },
	{ scheme: 'dark', days: ['2037-08-10', '2037-08-11', '2037-08-12', '2037-08-13'], plain: '2037-08-17' }
] as const;

for (const { scheme, days, plain } of cases) {
	test(`${scheme}: every day marked by dragging is highlighted the same, also vacation, holiday and the day under the pointer`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
		// Mon plain, Tue approved vacation, Wed planned vacation, Thu holiday
		await call(page, 'POST', '/absences', { kind: 'vacation', startDate: days[1], endDate: days[1], status: 'approved' });
		await call(page, 'POST', '/absences', { kind: 'vacation', startDate: days[2], endDate: days[2], status: 'planned' });
		await call(page, 'POST', '/calendar/custom-days', { kind: 'holiday', startDate: days[3], endDate: days[3], name: 'Brückentag' });
		await page.goto(`/calendar?date=${days[0]}`);
		const tile = (date: string) => page.locator(`[data-testid="month-grid"] [data-date="${date}"]`);
		await expect(tile(days[1])).toHaveAttribute('data-work-state', 'vacation_booked');
		const look = (date: string) => tile(date).evaluate((el) => `${getComputedStyle(el).backgroundColor} | ${getComputedStyle(el).boxShadow}`);
		const unselected = await look(plain);
		const sameLook = async (label: string) => {
			// transitions settle within 150 ms; poll until every marked day shows the same highlight
			await expect
				.poll(async () => new Set(await Promise.all(days.map(look))).size, { message: `${label}: all marked days look the same (${(await Promise.all(days.map(look))).join(' / ')})` })
				.toBe(1);
			expect(await look(days[0]), `${label}: marked differs from an unmarked day`).not.toBe(unselected);
		};

		// press on Monday, drag to Thursday and keep the pointer there
		const from = (await tile(days[0]).boundingBox())!;
		const to = (await tile(days[3]).boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(from.x + from.width * 1.5, from.y + from.height / 2, { steps: 4 });
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
		await sameLook('while dragging');
		if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/drag-select-during-${scheme}.png` });
		await page.mouse.up();
		for (const date of days) await expect(tile(date)).toHaveAttribute('aria-pressed', 'true');
		await sameLook('after releasing the button (pointer still on the last day)');
		if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/drag-select-after-${scheme}.png` });

		// leaving the selection gives every day its own tint back
		await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
		await expect(tile(days[1])).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(() => look(days[1])).not.toBe(unselected);
		await context.close();
	});
}
