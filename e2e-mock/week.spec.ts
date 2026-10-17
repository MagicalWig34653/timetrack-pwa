import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// Week overview and week planner against the in-repo mock API (package K1). Serial: the mock state lives in one server process.
test.describe.configure({ mode: 'serial' });

const berlinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	return addDays(date, 1 - (new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7));
};

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
}

test('overview: numbers, marks and aria labels of a past week', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	// three weeks back: no seeded segments; Mon 8:00 h, Tue 7:45 h, Wed vacation, Thu sick, Fri without entries
	const monday = mondayOf(addDays(berlinToday(), -21));
	const d = (n: number) => addDays(monday, n);
	await call(page, 'POST', '/time/segments', { kind: 'work', startedAt: `${d(0)}T07:00:00Z`, endedAt: `${d(0)}T15:00:00Z` });
	await call(page, 'POST', '/time/segments', { kind: 'work', startedAt: `${d(1)}T07:00:00Z`, endedAt: `${d(1)}T14:45:00Z` });
	await call(page, 'POST', '/absences', { kind: 'vacation', startDate: d(2), endDate: d(2), status: 'approved' });
	await call(page, 'POST', '/absences', { kind: 'sick', startDate: d(3), endDate: d(3), status: 'taken' });
	await page.goto(`/week?week=${await weekLabel(page, monday)}`);
	await expect(page.getByTestId('week-overview')).toBeVisible();
	await expect(page.getByTestId('week-actual')).toHaveText('15:45');
	await expect(page.getByTestId('week-target')).toHaveText('23:06');
	await expect(page.getByTestId('week-balance')).toHaveText('-7:21');
	await expect(page.getByTestId('week-sentence')).toContainText(/^KW \d+: 15:45 Std\. gearbeitet, 7:21 Std\. unter Soll; 1 Urlaubstag, 1 Krankheitstag\.$/);
	await expect(page.getByTestId('chip-workdays')).toContainText('2');
	await expect(page.getByTestId('chip-vacation')).toBeVisible();
	await expect(page.getByTestId('chip-sick')).toBeVisible();
	const marks = await page.getByTestId('week-days').locator('[data-mark]').evaluateAll((els) => els.map((el) => el.getAttribute('data-mark')));
	expect(marks).toEqual(['work', 'work', 'vacation', 'sick', 'work', 'off', 'off']);
	await expect(page.getByTestId(`week-day-${d(0)}`)).toHaveAttribute('aria-label', /8:00 Stunden, Saldo plus 0:18/);
	await expect(page.getByTestId(`week-day-${d(4)}`)).toHaveAttribute('aria-label', /Saldo minus 7:42/);
	// a day card opens the day
	await page.getByTestId(`week-day-${d(0)}`).click();
	await expect(page).toHaveURL(new RegExp(`/time/${d(0)}$`));
	await context.close();
});

async function weekLabel(page: Page, monday: string) {
	return page.evaluate((m) => {
		const thursday = new Date(Date.parse(m) + 3 * 86_400_000);
		const year = thursday.getUTCFullYear();
		const jan4 = new Date(Date.UTC(year, 0, 4));
		const firstMonday = new Date(jan4.getTime() - (((jan4.getUTCDay() || 7) - 1) * 86_400_000));
		return `${year}-W${String(1 + Math.round((Date.parse(m) - firstMonday.getTime()) / (7 * 86_400_000))).padStart(2, '0')}`;
	}, monday);
}

test('overview: empty week and navigation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/week?week=2033-W20');
	await expect(page.getByTestId('week-empty')).toBeVisible();
	await expect(page.getByTestId('week-kw')).toHaveText('KW 20');
	await page.getByTestId('week-next').click();
	await expect(page.getByTestId('week-kw')).toHaveText('KW 21');
	await page.getByTestId('week-today').click();
	await expect(page.getByTestId('week-overview')).toBeVisible();
	await expect(page.getByTestId('week-today')).toHaveCount(0);
	await page.getByTestId('tab-plan').click();
	await expect(page.getByTestId('week-planner')).toBeVisible();
	await context.close();
});

test('planner: standard week, same for all workdays, blocked day, save, reload, copy, clear and the leave guard', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	// 2032-W12 = 15.-21.03.2032: Wednesday vacation; 2032-W13 contains Karfreitag (26.03.)
	await call(page, 'POST', '/absences', { kind: 'vacation', startDate: '2032-03-17', endDate: '2032-03-17', status: 'approved' });
	await page.goto('/plan?week=2032-W12');
	await expect(page.getByTestId('week-planner')).toBeVisible();
	await expect(page.getByTestId('plan-blocked-2032-03-17')).toContainText('Urlaub eingetragen.');
	await expect(page.locator('#plan-mode-2032-03-17')).toBeDisabled();
	await expect(page.getByTestId('plan-total-text')).toContainText('von 30:48 Soll');
	await expect(page.getByTestId('plan-save')).toBeDisabled();

	await page.getByTestId('plan-standard').click();
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'true');
	for (const date of ['2032-03-15', '2032-03-16', '2032-03-18', '2032-03-19']) await expect(page.locator(`#plan-mode-${date}`)).toHaveValue('office');
	await expect(page.locator('#plan-mode-2032-03-20')).toHaveValue('');

	// edit Monday precisely, apply to all workdays
	await page.locator('#plan-mode-2032-03-15').selectOption('home');
	await page.locator('#plan-start-2032-03-15').fill('08:00');
	await page.locator('#plan-end-2032-03-15').fill('16:30');
	await page.locator('#plan-break-2032-03-15').fill('30');
	await expect(page.getByTestId('plan-hours-2032-03-15')).toHaveText('8:00');
	await page.getByTestId('plan-same').click();
	await expect(page.locator('#plan-mode-2032-03-19')).toHaveValue('home');
	await expect(page.getByTestId('plan-hours-2032-03-19')).toHaveText('8:00');
	await expect(page.getByTestId('plan-total-text')).toHaveText('Plan 32:00 von 30:48 Soll');
	await expect(page.getByTestId('plan-diff')).toHaveText('1:12 über Soll');

	// validation: end before start blocks saving and names the day
	await page.locator('#plan-end-2032-03-16').fill('07:00');
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-problem-2032-03-16')).toHaveText('Das Ende muss nach dem Beginn liegen.');
	await page.locator('#plan-end-2032-03-16').fill('16:30');

	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('toast')).toHaveText('Woche gespeichert.');
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');
	await page.reload();
	await expect(page.locator('#plan-end-2032-03-18')).toHaveValue('16:30');
	await expect(page.getByTestId('plan-total-text')).toHaveText('Plan 32:00 von 30:48 Soll');

	// overview shows the plan as ghost bars and the plan card
	await page.getByTestId('tab-overview').click();
	await expect(page.getByTestId('week-plan-card')).toContainText('Geplant 32:00');
	await expect(page.getByTestId('week-day-2032-03-15').getByTestId('bar-planned')).toBeVisible();

	// copy last week into the week with the holiday: Karfreitag stays blocked and empty
	await page.goto('/plan?week=2032-W13');
	await expect(page.getByTestId('plan-blocked-2032-03-26')).toContainText('Feiertag');
	await page.getByTestId('plan-copy').click();
	await expect(page.locator('#plan-mode-2032-03-22')).toHaveValue('home');
	await expect(page.locator('#plan-mode-2032-03-26')).toHaveValue('');

	// leave guard: dismissing keeps the page, accepting leaves
	const dialogs: string[] = [];
	page.once('dialog', (dialog) => {
		dialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await page.getByTestId('week-next').click();
	await expect.poll(() => dialogs.length).toBe(1);
	expect(dialogs[0]).toContain('ungespeicherte Änderungen');
	await expect(page.getByTestId('week-kw')).toHaveText('KW 13');
	page.once('dialog', (dialog) => void dialog.accept());
	await page.getByTestId('week-next').click();
	await expect(page.getByTestId('week-kw')).toHaveText('KW 14');

	// clear and save the first week again
	await page.goto('/plan?week=2032-W12');
	await page.getByTestId('plan-clear').click();
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('toast')).toHaveText('Woche gespeichert.');
	await expect(page.getByTestId('plan-total-text')).toHaveText('Plan 0:00 von 30:48 Soll');
	await context.close();
});

test('today line, calendar detail and an older server without the endpoints', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const today = berlinToday();
	await call(page, 'PUT', `/plan/days/${today}`, { mode: 'office', plannedStart: '08:00', plannedEnd: '16:30', plannedBreakMinutes: 30 });
	await page.goto('/');
	await expect(page.getByTestId('today-plan')).toHaveText('Heute geplant: 08:00–16:30 Büro');
	await page.goto(`/calendar?date=${today}`);
	await page.locator(`[data-date="${today}"]:visible`).click();
	await expect(page.getByTestId('panel-plan-times')).toHaveText('Geplant 08:00–16:30, 30 Min. Pause');
	// editing mode/note in the calendar keeps the times
	await page.getByRole('button', { name: 'Planung ändern' }).click();
	await page.getByLabel('Notiz (optional)').fill('Kunde ruft an');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('panel-plan-times')).toBeVisible();

	await page.route('**/api/v1/time/weeks/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"not_found","message":"x"}}' }));
	await page.route('**/api/v1/plan/weeks/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"not_found","message":"x"}}' }));
	await page.goto('/week');
	await expect(page.getByTestId('week-unavailable')).toContainText('neuere Serverversion');
	await page.goto('/plan');
	await expect(page.getByTestId('plan-unavailable')).toContainText('neuere Serverversion');
	await context.close();
});
