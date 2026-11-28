import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Bug 26.11.2026: days marked as vacation (and sick, excused, holiday) were not highlighted in the week planner grid.
// PWA-OFFDAY removed the lock hatching of `.wg-col[data-blocked]` together with its whole background, so a marked column
// looked like an ordinary working day; plan-offday.spec.ts only asserted that the hatching was gone, never that the mark
// stayed visible. This spec marks a vacation day in the calendar like a user does and checks the highlight in the month
// grid and in the planner, light and dark. Screenshots go to SCREENSHOT_DIR when it is set.
// Weeks in 2037 keep the data apart from the other planning specs on the shared mock server.
test.describe.configure({ mode: 'serial' });

const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Alpha channel of a computed colour such as "oklab(0.7 -0.1 -0.1 / 0.12)", "color-mix(...)" result or "rgba(0, 0, 0, 0.1)". */
const alphaOf = (color: string) => {
	const m = /\/\s*([\d.]+%?)\s*\)/.exec(color) ?? /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(color);
	if (!m) return /^(rgb|oklab|oklch|color|lab|lch)\(/.test(color) ? 1 : 0;
	return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
};

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
}

const shot = async (page: Page, name: string) => {
	if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` });
};

const cases = [
	{ scheme: 'light', monday: '2037-03-09', week: '2037-W11' },
	{ scheme: 'dark', monday: '2037-03-16', week: '2037-W12' }
] as const;

for (const { scheme, monday, week } of cases) {
	test(`${scheme}: a day marked as vacation in the calendar is highlighted in the month grid and the planner`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
		const day = (n: number) => addDays(monday, n);
		// Monday excused, Wednesday sick, Thursday holiday, Friday planned vacation; Tuesday is marked through the UI.
		await call(page, 'POST', '/absences', { kind: 'excused', startDate: day(0), endDate: day(0), status: 'recorded' });
		await call(page, 'POST', '/absences', { kind: 'sick', startDate: day(2), endDate: day(2), status: 'recorded' });
		await call(page, 'POST', '/calendar/custom-days', { kind: 'holiday', startDate: day(3), endDate: day(3), name: 'Brückentag' });
		await call(page, 'POST', '/absences', { kind: 'vacation', startDate: day(4), endDate: day(4), status: 'planned' });

		// mark Tuesday as approved vacation in the month calendar
		await page.goto(`/calendar?date=${day(1)}`);
		const tile = page.locator(`[data-testid="month-grid"] [data-date="${day(1)}"]`);
		await tile.click();
		await page.getByTestId('select-vacation').click();
		await page.locator('#pd-status').selectOption('approved');
		await page.getByTestId('pd-submit').click();
		await expect(page.getByTestId('plan-dialog')).toHaveCount(0);
		await page.getByRole('button', { name: 'Auswahl aufheben' }).click();
		await expect(tile).toHaveAttribute('data-work-state', 'vacation_booked');
		expect(alphaOf(await tile.evaluate((el) => getComputedStyle(el).backgroundColor)), 'month cell is tinted').toBeGreaterThanOrEqual(0.1);
		await shot(page, `calendar-month-${scheme}`);

		// the planner grid of the same week highlights every marked column
		await page.goto(`/plan?week=${week}&view=grid`);
		await expect(page.getByTestId('week-grid')).toBeVisible();
		await page.getByTestId('week-grid-scroll').evaluate((el) => (el.scrollTop = 0));
		const col = (n: number) => page.getByTestId(`col-${day(n)}`);
		await expect(col(1)).toHaveAttribute('data-blocked', 'vacation');
		await expect(col(4)).toHaveAttribute('data-vacation', 'planned');
		const background = (n: number) => col(n).evaluate((el) => ({ color: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage }));
		const tints: Record<string, string> = {};
		for (const [n, mark] of [
			[0, 'excused'],
			[1, 'vacation'],
			[2, 'sick'],
			[3, 'holiday']
		] as const) {
			await expect(col(n)).toHaveAttribute('data-blocked', mark);
			const { color } = await background(n);
			expect(alphaOf(color), `${mark} column is tinted (${color})`).toBeGreaterThanOrEqual(0.08);
			tints[mark] = color;
		}
		expect(new Set(Object.values(tints)).size, 'each mark has its own tint').toBe(4);
		// planned vacation keeps its lighter dashed hatching
		expect((await background(4)).image).toMatch(/repeating-linear-gradient/);
		// a column without a mark stays untinted (Saturday is the plain free day)
		const plain = (await page.getByTestId(`col-${day(5)}`).evaluate((el) => getComputedStyle(el).backgroundColor)) ?? '';
		expect(plain).not.toBe(tints.vacation);
		await shot(page, `planner-week-${scheme}`);
		await context.close();
	});
}
