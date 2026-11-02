import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// PLAN-OFFDAY (ADR-0035, contract 0.42.0): plan blocks on vacation, sick, excused and holiday days are allowed and count as
// planned extra time. 2036-W20 = 12.-18.05.2036: Tuesday vacation, Wednesday sick, Thursday holiday, Friday half vacation.
test.describe.configure({ mode: 'serial' });

const WEEK = '2036-W20';
const MONDAY = '2036-05-12';
const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const day = (n: number) => addDays(MONDAY, n);

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
}

async function point(page: Page, date: string, minute: number) {
	const grid = page.getByTestId('week-grid');
	const startHour = Number(await grid.getAttribute('data-start-hour'));
	const hh = Number(await grid.getAttribute('data-hour-height'));
	const box = (await page.getByTestId(`col-${date}`).boundingBox())!;
	return { x: box.x + box.width * 0.5, y: box.y + ((minute - startHour * 60) / 60) * hh };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, alt = false) {
	if (alt) await page.keyboard.down('Alt');
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
	await page.mouse.move(to.x, to.y, { steps: 6 });
	await page.mouse.up();
	if (alt) await page.keyboard.up('Alt');
}

const paint = async (page: Page, date: string, from: number, to: number) => drag(page, await point(page, date, from), await point(page, date, to));

test('grid: paint, move, copy and sum on vacation, sick, holiday and half-day columns', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await call(page, 'POST', '/absences', { kind: 'vacation', startDate: day(1), endDate: day(1), status: 'approved' });
	await call(page, 'POST', '/absences', { kind: 'sick', startDate: day(2), endDate: day(2), status: 'recorded' });
	await call(page, 'POST', '/calendar/custom-days', { kind: 'holiday', startDate: day(3), endDate: day(3), name: 'Brückentag' });
	await call(page, 'POST', '/absences', { kind: 'vacation', startDate: day(4), endDate: day(4), status: 'approved', halfDayStart: true });
	await page.goto(`/plan?week=${WEEK}&view=grid`);
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await page.getByTestId('week-grid-scroll').evaluate((el) => (el.scrollTop = 0));
	for (const n of [1, 2, 3]) {
		await expect(page.getByTestId(`col-${day(n)}`)).toHaveAttribute('data-blocked', /.+/);
		await expect(page.getByTestId(`add-${day(n)}`)).toBeEnabled();
	}

	// paint on the vacation, sick and holiday columns and on the half day
	await paint(page, day(1), 8 * 60, 12 * 60);
	await expect(page.getByTestId(`block-time-${day(1)}-0`)).toHaveText('08:00–12:00');
	await expect(page.getByTestId(`day-plan-${day(1)}`)).toHaveText('4:00');
	await paint(page, day(2), 9 * 60, 11 * 60);
	await expect(page.getByTestId(`block-time-${day(2)}-0`)).toHaveText('09:00–11:00');
	await paint(page, day(3), 8 * 60, 10 * 60);
	await expect(page.getByTestId(`block-time-${day(3)}-0`)).toHaveText('08:00–10:00');
	await paint(page, day(4), 8 * 60, 12 * 60);
	await expect(page.getByTestId(`block-time-${day(4)}-0`)).toHaveText('08:00–12:00');
	// the marks stay; the planned time of the marked days counts in the sum (4 + 2 + 2 + 4 hours)
	await expect(page.getByTestId(`blocked-chip-${day(1)}`)).toBeVisible();
	await expect(page.getByTestId('plan-total-text')).toContainText('Plan 12:00');
	await expect(page.getByTestId('plan-offday-hint')).toContainText('Plan an einem Urlaubstag zählt als geplante Mehrzeit.');
	await expect(page.getByTestId('plan-offday-hint')).toContainText('Plan an einem Krankheitstag zählt als geplante Mehrzeit.');

	// move the vacation block onto Monday (ordinary day) and back to a holiday column
	await drag(page, await point(page, day(1), 10 * 60), await point(page, day(0), 10 * 60));
	await expect(page.getByTestId(`block-time-${day(0)}-0`)).toHaveText('08:00–12:00');
	await expect(page.getByTestId(`block-${day(1)}-0`)).toHaveCount(0);
	await drag(page, await point(page, day(0), 10 * 60), await point(page, day(1), 11 * 60));
	await expect(page.getByTestId(`block-time-${day(1)}-0`)).toHaveText('09:00–13:00');
	await expect(page.getByTestId(`block-${day(0)}-0`)).toHaveCount(0);

	// Alt-drag copies from the sick day onto the holiday column (second block there)
	await drag(page, await point(page, day(2), 10 * 60), await point(page, day(3), 13 * 60), true);
	await expect(page.getByTestId(`block-time-${day(2)}-0`)).toHaveText('09:00–11:00');
	await expect(page.getByTestId(`block-${day(3)}-1`)).toBeVisible();

	// save, reload: the blocks and the sums survive
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');
	await page.reload();
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await expect(page.getByTestId(`block-time-${day(1)}-0`)).toHaveText('09:00–13:00');
	await expect(page.getByTestId(`day-plan-${day(1)}`)).toHaveText('4:00');
	await expect(page.getByTestId(`block-time-${day(4)}-0`)).toHaveText('08:00–12:00');
	await expect(page.getByTestId('plan-total-text')).toContainText('Plan 14:00');
	await context.close();
});

test('list view: marked days are editable, the hint is shown, the server counts the plan', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(`/plan?week=${WEEK}&view=list`);
	await expect(page.getByTestId('week-planner')).toBeVisible();
	await expect(page.locator(`#plan-mode-${day(1)}`)).toBeEnabled();
	await expect(page.getByTestId(`plan-blocked-${day(1)}`)).toContainText('Plan an einem Urlaubstag zählt als geplante Mehrzeit.');
	await expect(page.getByTestId(`plan-blocked-${day(3)}`)).toContainText('Plan an einem Feiertag zählt als geplante Mehrzeit.');
	await expect(page.getByTestId(`plan-hours-${day(1)}`)).toHaveText('4:00');
	// the plan of a marked day can be changed
	await page.locator(`#plan-end-0-${day(1)}`).fill('14:00');
	await expect(page.getByTestId(`plan-hours-${day(1)}`)).toHaveText('5:00');
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('toast')).toHaveText('Woche gespeichert.');
	// plan/actual overview of the server: planned time on the vacation day is no longer 0
	const week = await page.evaluate(async () => (await (await fetch('/api/v1/plan/weeks/2036-W20')).json()) as { days: { date: string; plannedSeconds: number | null }[] });
	expect(week.days.find((d) => d.date === '2036-05-13')?.plannedSeconds).toBe(5 * 3600);
	await context.close();
});
