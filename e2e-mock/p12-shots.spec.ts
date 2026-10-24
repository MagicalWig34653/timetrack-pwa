import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Review screenshots of package P12 (calendar week balance, statistics, cancelled entries, /week absences); only with SCREENSHOT_DIR.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });
let seeded = false;

const berlinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	return addDays(date, 1 - (new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7));
};
const isoWeek = (monday: string) => {
	const year = Number(addDays(monday, 3).slice(0, 4));
	return `${year}-W${String(1 + Math.round((Date.parse(monday) - Date.parse(mondayOf(`${year}-01-04`))) / (7 * 86_400_000))).padStart(2, '0')}`;
};

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
	return response.status() === 204 ? null : response.json().catch(() => null);
}

test('warm up the dev server', async ({ page }) => {
	test.skip(!dir, 'set SCREENSHOT_DIR');
	test.setTimeout(120_000);
	for (const path of ['/login', '/']) {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`p12 shots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			test.setTimeout(240_000);
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			const shot = async (file: string) => page.screenshot({ path: `${dir}/p12-${file}-${name}-${scheme}.png`, fullPage: true, type: 'jpeg', quality: 70 });
			const today = berlinToday();
			if (!seeded) {
				seeded = true;
				// data for the shots: completed weeks with different hours, cancelled entries, open absences next week
				for (let w = 3; w <= 12; w++) {
					const monday = addDays(mondayOf(today), -7 * w);
					for (let i = 0; i < 5; i++) {
						const hours = 6 + ((w * 3 + i * 2) % 5);
						await call(page, 'POST', '/time/segments', { kind: i === 3 && w % 3 === 0 ? 'school' : 'work', startedAt: `${addDays(monday, i)}T06:00:00Z`, endedAt: `${addDays(monday, i)}T${String(6 + hours).padStart(2, '0')}:00:00Z` });
					}
				}
				for (let i = 0; i < 6; i++) {
					const s = await call(page, 'POST', '/time/segments', { kind: i % 3 === 0 ? 'travel' : 'work', startedAt: `${addDays(today, -130 - i)}T06:00:00Z`, endedAt: `${addDays(today, -130 - i)}T09:30:00Z` });
					await call(page, 'DELETE', `/time/segments/${s.id}?reason=test`);
				}
				const next = addDays(mondayOf(today), 70);
				await call(page, 'POST', '/absences', { kind: 'vacation', startDate: next, endDate: addDays(next, 1), status: 'planned' });
				await call(page, 'POST', '/absences', { kind: 'vacation', startDate: addDays(next, 2), endDate: addDays(next, 2), status: 'requested' });
				await call(page, 'POST', '/absences', { kind: 'sick', startDate: addDays(mondayOf(today), -105), endDate: addDays(mondayOf(today), -104), status: 'taken' });
			}
			await page.goto('/calendar');
			await expect(page.locator('[data-testid="week-balance"]:visible').first()).toBeVisible({ timeout: 30_000 });
			await shot('calendar');
			await page.goto('/stats');
			await expect(page.getByTestId('stats-ready')).toBeVisible();
			await page.getByTestId('range-w26').click();
			await expect(page.getByTestId('chart-account-svg')).toBeVisible();
			await shot('stats');
			await page.goto('/time/cancelled');
			await expect(page.getByTestId('trash-row').first()).toBeVisible();
			await shot('trash');
			await page.goto(`/week?week=${isoWeek(addDays(mondayOf(today), 70))}`);
			await expect(page.getByTestId('week-absences')).toBeVisible();
			await shot('week');
			await context.close();
		});
	}
}
