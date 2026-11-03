import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// VB1 (ADR-0034): bookings on vacation days are allowed and count as overtime; the day stays vacation. Nothing is disabled,
// the PWA only shows a quiet hint. Dates lie in March 2035 (Tue 2035-03-06, Wed 2035-03-07) so they do not collide with other specs;
// the timer test uses today and cleans up after itself.
test.describe.configure({ mode: 'serial' });

const HINT = 'Buchung an Urlaubstag: Die gebuchte Zeit zählt als Überstunde.';
const FULL = '2035-03-06';
const HALF = '2035-03-07';

async function api(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
	return response.status() === 204 ? null : response.json();
}

async function addManual(page: Page, date: string, from: string, to: string) {
	await page.goto(`/time/${date}`);
	await page.getByRole('button', { name: 'Eintrag manuell ergänzen' }).click();
	await page.getByLabel('Beginn').fill(`${date}T${from}`);
	await page.getByLabel('Ende').fill(`${date}T${to}`);
	await page.getByRole('form', { name: 'Eintrag ergänzen' }).getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Eintrag ergänzt.')).toBeVisible();
}

test('manual entry on a full vacation day: allowed, hint shown, positive balance, still vacation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await api(page, 'POST', '/absences', { kind: 'vacation', startDate: FULL, endDate: FULL, status: 'approved' });
	await page.goto(`/time/${FULL}`);
	const add = page.getByRole('button', { name: 'Eintrag manuell ergänzen' });
	await expect(add).toBeVisible();
	await expect(add).toBeEnabled();
	await expect(page.getByTestId('day-off-booking')).toHaveCount(0);
	await addManual(page, FULL, '08:00', '16:30');
	await expect(page.getByTestId('segment-row')).toHaveCount(1);
	await expect(page.getByTestId('day-off-booking')).toHaveText(HINT);
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await expect(page.getByTestId('day-delta')).toContainText('+');
	await expect(page.getByTestId('day-summary')).toContainText('Urlaub');
	await context.close();
});

test('manual entry on a half vacation day: hint, target halved, still vacation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await api(page, 'POST', '/absences', { kind: 'vacation', startDate: HALF, endDate: HALF, status: 'approved', halfDayStart: true });
	await addManual(page, HALF, '08:00', '16:30');
	await expect(page.getByTestId('day-off-booking')).toHaveText(HINT);
	await expect(page.getByTestId('day-target-note')).toContainText('halber Urlaubstag');
	await expect(page.getByTestId('day-delta')).toContainText('+');
	await context.close();
});

test('week and month keep the booked time visible next to the vacation mark', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/week?week=2035-W10');
	const card = page.getByTestId(`week-day-${FULL}`);
	await expect(card).toHaveAttribute('data-mark', 'vacation');
	await expect(card.getByTestId('day-hours')).not.toHaveText('–');
	await expect(card.getByTestId('day-off-booking')).toBeVisible();
	await expect(card.getByTestId('day-off-booking')).toHaveAttribute('title', HINT);
	await expect(card).toHaveAttribute('aria-label', new RegExp(HINT.replace('.', '\\.')));
	await expect(card.getByTestId('day-plan-diff')).toHaveCount(0);
	await page.goto(`/calendar?date=${FULL}`);
	const cell = page.locator(`[data-testid="month-grid"] [data-date="${FULL}"]`);
	await expect(cell.locator('[data-chip="absence"]')).toContainText('Urlaub');
	await expect(cell.locator('[data-chip="worked"]')).toContainText('Ist ');
	await context.close();
});

test('timer start on today works on a vacation day and shows the hint', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
	const absence = await api(page, 'POST', '/absences', { kind: 'vacation', startDate: today, endDate: today, status: 'approved' });
	try {
		await page.goto('/');
		const start = page.getByRole('button', { name: 'Start' });
		await expect(start).toBeEnabled();
		await start.click();
		await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
		await expect(page.getByTestId('day-off-booking')).toHaveText(HINT);
		await page.getByRole('button', { name: 'Stopp' }).click();
		await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
		// clean up: cancel today's booking so later specs see an untouched today
		const day = await api(page, 'GET', `/time/segments?from=${today}T00:00:00Z&to=${today}T23:59:59Z`);
		for (const segment of day.items ?? day) await api(page, 'DELETE', `/time/segments/${segment.id}?reason=Test`);
	} finally {
		await api(page, 'DELETE', `/absences/${absence.id}`);
	}
	await context.close();
});


test('past vacation day shows plan and actual difference alongside the booking and vacation mark', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	const date = '2025-03-04';
	const [model] = await api(page, 'GET', '/work-models');
	try {
		// The demo model starts only 60 days before today; absence effects require a workday in an effective model.
		await api(page, 'PUT', `/work-models/${model.id}`, { ...model, validFrom: '2025-01-01' });
		await api(page, 'POST', '/absences', { kind: 'vacation', startDate: date, endDate: date, status: 'approved' });
		await api(page, 'PUT', `/plan/days/${date}`, { mode: 'office', blocks: [{ start: '08:00', end: '10:00', kind: 'office' }] });
		await addManual(page, date, '08:00', '11:00');
		await page.goto('/week?week=2025-W10');
		const card = page.getByTestId(`week-day-${date}`);
		await expect(card).toHaveAttribute('data-mark', 'vacation');
		await expect(card.getByTestId('day-off-booking')).toHaveAttribute('title', HINT);
		await expect(card.getByTestId('day-plan-diff')).toContainText('+1:00');
		await expect(card).toContainText('Büro');
		const week = await api(page, 'GET', '/time/weeks/2025-W10');
		const day = week.days.find((item: { date: string }) => item.date === date);
		expect(day.mark).toBe('vacation');
		expect(day.plannedSeconds).toBe(7200);
		expect(day.planActualDifferenceSeconds).toBe(3600);
		expect(day.targetSeconds).toBe(0);
		expect(day.balanceSeconds).toBe(10800);
	} finally {
		try {
			await api(page, 'PUT', `/work-models/${model.id}`, model);
		} finally {
			await context.close();
		}
	}
});
