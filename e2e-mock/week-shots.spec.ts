import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Review screenshots of the week pages (package K1); only runs with SCREENSHOT_DIR. Light/dark x phone/desktop.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

const berlinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
	return addDays(date, 1 - wd);
};
const isoWeek = (monday: string) => {
	const thursday = addDays(monday, 3);
	const year = Number(thursday.slice(0, 4));
	const jan4 = `${year}-01-04`;
	const firstMonday = mondayOf(jan4);
	return `${year}-W${String(1 + Math.round((Date.parse(monday) - Date.parse(firstMonday)) / (7 * 86_400_000))).padStart(2, '0')}`;
};

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
}

const at = (date: string, time: string) => `${date}T${time}:00Z`;

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`week shots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			test.setTimeout(240_000);
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			const shot = async (file: string) => {
				await page.waitForLoadState('networkidle');
				await page.waitForTimeout(250);
				await page.screenshot({ path: `${dir}/${name}-${scheme}-${file}.png`, fullPage: true });
			};
			const today = berlinToday();
			const past = mondayOf(addDays(today, -21));
			if (name === 'phone' && scheme === 'light') {
				// data for the normal week (once; the mock state is shared): work Mon/Tue/Thu, vacation Wed, holiday via custom day, sick Fri
				const d = (n: number) => addDays(past, n);
				await call(page, 'POST', '/time/segments', { kind: 'work', startedAt: at(d(0), '06:07'), endedAt: at(d(0), '10:00') });
				await call(page, 'POST', '/time/segments', { kind: 'work', startedAt: at(d(0), '10:40'), endedAt: at(d(0), '14:35') });
				await call(page, 'POST', '/time/segments', { kind: 'travel', startedAt: at(d(1), '05:30'), endedAt: at(d(1), '06:15') });
				await call(page, 'POST', '/time/segments', { kind: 'work', startedAt: at(d(1), '06:15'), endedAt: at(d(1), '14:20') });
				await call(page, 'POST', '/absences', { kind: 'vacation', startDate: d(2), endDate: d(2), status: 'approved' });
				await call(page, 'POST', '/calendar/custom-days', { kind: 'holiday', startDate: d(3), endDate: d(3), name: 'Betriebsfeiertag' });
				await call(page, 'POST', '/absences', { kind: 'sick', startDate: d(4), endDate: d(4), status: 'taken' });
				await call(page, 'PUT', `/plan/weeks/${isoWeek(past)}`, { days: [0, 1, 2, 3, 4].map((n) => ({ date: d(n), mode: 'office', plannedStart: '08:00', plannedEnd: '16:30', plannedBreakMinutes: 30 })) });
				// the running week with a running timer today and a plan
				await call(page, 'POST', '/time/timer/start', { clientEventId: crypto.randomUUID() });
				await call(page, 'PUT', `/plan/days/${today}`, { mode: 'office', plannedStart: '08:00', plannedEnd: '16:30', plannedBreakMinutes: 30 });
				// a blocked week for the planner: vacation Tuesday, holiday Thursday, plan partly filled
				const nextNext = mondayOf(addDays(today, 28));
				await call(page, 'POST', '/absences', { kind: 'vacation', startDate: addDays(nextNext, 1), endDate: addDays(nextNext, 1), status: 'approved' });
				await call(page, 'POST', '/calendar/custom-days', { kind: 'holiday', startDate: addDays(nextNext, 3), endDate: addDays(nextNext, 3), name: 'Brückentag' });
			}
			const nextNext = mondayOf(addDays(today, 28));
			await page.goto(`/week?week=${isoWeek(past)}`);
			await expect(page.getByTestId('week-overview')).toBeVisible();
			await shot('week-overview-normal');
			await page.goto('/week');
			await expect(page.getByTestId('week-overview')).toBeVisible();
			await shot('week-overview-running');
			await page.goto(`/week?week=${isoWeek(addDays(today, 140))}`);
			await expect(page.getByTestId('week-empty')).toBeVisible();
			await shot('week-overview-empty');
			await page.goto(`/plan?week=${isoWeek(addDays(today, 7))}&view=list`);
			await expect(page.getByTestId('week-planner')).toBeVisible();
			await shot('plan-filled');
			await page.goto(`/plan?week=${isoWeek(nextNext)}&view=list`);
			await expect(page.getByTestId('week-planner')).toBeVisible();
			await page.getByTestId('plan-standard').click();
			await shot('plan-blocked-standard');
			await page.getByTestId(`plan-start-${addDays(nextNext, 0)}`.replace('plan-start', 'plan-row')).waitFor();
			await page.goto('/');
			await expect(page.getByTestId('today-plan')).toBeVisible();
			await shot('home-plan-line');
			await context.close();
		});
	}
}
