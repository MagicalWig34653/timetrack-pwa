import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Package P12 against the in-repo mock: week balance in the calendar, statistics, cancelled entries, /week memory and absences.
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
const isoWeek = (monday: string) => {
	const year = Number(addDays(monday, 3).slice(0, 4));
	const firstMonday = mondayOf(`${year}-01-04`);
	return `${year}-W${String(1 + Math.round((Date.parse(monday) - Date.parse(firstMonday)) / (7 * 86_400_000))).padStart(2, '0')}`;
};

async function call(page: Page, method: string, path: string, body?: unknown, allow = 300) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(allow);
	return response.status() === 204 ? null : response.json().catch(() => null);
}

// The first visit makes the dev server compile and optimise the page modules; do that once before the real specs sign in.
test('warm up the dev server', async ({ page }) => {
	test.setTimeout(120_000);
	for (const path of ['/login', '/']) {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	}
});

test('calendar shows the week difference under the KW number', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	// three weeks back: Mon-Fri 8:00-16:00 (over the 38:30 h Soll is not reached: under) in a completed week
	const monday = mondayOf(addDays(berlinToday(), -28));
	await call(page, 'POST', '/time/segments', { kind: 'work', startedAt: `${monday}T07:00:00Z`, endedAt: `${monday}T16:00:00Z` });
	await page.goto(`/calendar?date=${monday}`);
	const label = page.getByTestId('week-balance').first();
	await expect(label).toBeVisible();
	const done = page.locator('[data-testid="week-balance"][data-state="done"]');
	await expect(done.first()).toBeVisible();
	await expect(done.first()).toHaveAttribute('title', /Soll \d+:\d\d h · Ist \d+:\d\d h/);
	await expect(done.first()).toHaveAttribute('aria-label', /^Kalenderwoche \d+: /);
	// the running week is open and neutral
	await page.goto('/calendar');
	const open = page.locator('[data-testid="week-balance"][data-state="open"]').first();
	await expect(open).toBeVisible();
	await expect(open).toHaveAttribute('data-tone', /neutral|positive/);
	await context.close();
});

test('statistics page: charts, range, granularity, table alternative', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/stats');
	await expect(page.getByRole('heading', { name: 'Statistik', level: 1 })).toBeVisible();
	await expect(page.getByTestId('stats-ready')).toBeVisible();
	for (const id of ['chart-account', 'chart-soll-ist', 'chart-diff', 'chart-kinds', 'chart-absences', 'chart-times', 'chart-breaks']) await expect(page.getByTestId(id)).toBeVisible();
	await expect(page.getByTestId('stats-target')).not.toHaveText('0:00');
	await page.getByTestId('range-w4').click();
	await page.getByTestId('gran-day').click();
	await expect(page.getByTestId('gran-day')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('stats-ready')).toHaveAttribute('aria-busy', 'false');
	// tooltip on hover
	const svg = page.getByTestId('chart-soll-ist-svg');
	await svg.scrollIntoViewIfNeeded();
	const box = (await svg.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2, { steps: 3 });
	await expect(page.getByTestId('chart-soll-ist-tip')).toBeVisible();
	// keyboard
	await svg.focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('chart-soll-ist-tip')).toBeVisible();
	// table alternative
	await page.getByTestId('chart-soll-ist-toggle').click();
	await expect(page.getByTestId('chart-soll-ist-table').locator('tbody tr').first()).toBeVisible();
	// raw times switch
	await page.getByTestId('stats-rounded').uncheck();
	await expect(page.getByTestId('stats-ready')).toBeVisible();
	// custom range with no time shows the empty state
	await page.getByTestId('range-custom').click();
	await page.getByTestId('stats-from').fill('2020-01-06');
	await page.getByTestId('stats-to').fill('2020-01-12');
	await expect(page.getByTestId('stats-empty')).toBeVisible();
	await context.close();
});

test('cancelled entries: filter, restore, delete one, bulk, delete all with typed word', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const monday = mondayOf(addDays(berlinToday(), -42));
	const ids: string[] = [];
	for (let i = 0; i < 5; i++) {
		const day = addDays(monday, i);
		const segment = await call(page, 'POST', '/time/segments', { kind: i === 4 ? 'travel' : 'work', startedAt: `${day}T06:00:00Z`, endedAt: `${day}T10:00:00Z` });
		ids.push(segment.id);
		await call(page, 'DELETE', `/time/segments/${segment.id}?reason=test`);
	}
	await page.goto('/week');
	await page.getByTestId('cancelled-link').click();
	await expect(page).toHaveURL(/\/time\/cancelled$/);
	await expect(page.getByTestId('trash-row')).toHaveCount(5);
	// kind filter
	await page.getByTestId('trash-kind').selectOption('travel');
	await expect(page.getByTestId('trash-row')).toHaveCount(1);
	await page.getByTestId('trash-kind').selectOption('all');
	// restore the first row
	await page.getByTestId('trash-restore').first().click();
	await expect(page.getByTestId('trash-notice')).toHaveText('Eintrag wiederhergestellt.');
	await expect(page.getByTestId('trash-row')).toHaveCount(4);
	// delete one for good
	await page.getByTestId('trash-delete').first().click();
	await expect(page.getByTestId('confirm-dialog')).toBeVisible();
	await page.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('trash-notice')).toHaveText('Eintrag endgültig gelöscht.');
	await expect(page.getByTestId('trash-row')).toHaveCount(3);
	// bulk: select two
	await page.getByTestId('trash-select').nth(0).check();
	await page.getByTestId('trash-select').nth(1).check();
	await expect(page.getByTestId('trash-selected')).toHaveText('2 ausgewählt');
	await page.getByTestId('trash-delete-selected').click();
	await page.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('trash-notice')).toHaveText('2 Einträge endgültig gelöscht.');
	await expect(page.getByTestId('trash-row')).toHaveCount(1);
	// delete all: count preview and typed word
	await page.getByTestId('trash-delete-all').click();
	await expect(page.getByTestId('trash-all-count')).toContainText('1 stornierte Einträge');
	await expect(page.getByTestId('confirm-submit')).toBeDisabled();
	await page.getByTestId('confirm-handle').fill('LÖSCHEN');
	await page.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('trash-empty')).toBeVisible();
	// the restored entry is still active
	const day = addDays(monday, 4); // newest first: the restored row is the travel entry
	const list = await call(page, 'GET', `/time/segments?from=${day}T00:00:00Z&to=${addDays(day, 1)}T00:00:00Z`);
	expect(list.length).toBe(1);
	await context.close();
});

test('cancelled entries degrade gracefully on a server without purge', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const day = addDays(berlinToday(), -50);
	const segment = await call(page, 'POST', '/time/segments', { kind: 'work', startedAt: `${day}T06:00:00Z`, endedAt: `${day}T08:00:00Z` });
	await call(page, 'DELETE', `/time/segments/${segment.id}?reason=test`);
	await call(page, 'POST', '/mock/trash', { purge: false, restore: false });
	await page.goto('/time/cancelled');
	await expect(page.getByTestId('trash-no-purge')).toBeVisible();
	await expect(page.getByTestId('trash-delete-all')).toHaveCount(0);
	await page.getByTestId('trash-restore').first().click();
	await expect(page.getByTestId('trash-error')).toContainText('noch nicht wiederherstellen');
	await call(page, 'POST', '/mock/trash', { purge: true, restore: true });
	await context.close();
});

test('/week remembers the last viewed week and shows open absences with warnings', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	const monday = mondayOf(addDays(berlinToday(), 70));
	await call(page, 'POST', '/absences', { kind: 'vacation', startDate: monday, endDate: addDays(monday, 1), status: 'planned' });
	await call(page, 'POST', '/absences', { kind: 'vacation', startDate: addDays(monday, 2), endDate: addDays(monday, 2), status: 'requested' });
	await call(page, 'POST', '/absences', { kind: 'vacation', startDate: addDays(monday, 3), endDate: addDays(monday, 3), status: 'approved' });
	await page.goto(`/week?week=${isoWeek(monday)}`);
	await expect(page.getByTestId('week-overview')).toBeVisible();
	await expect(page.getByTestId('week-absences')).toBeVisible();
	await expect(page.getByTestId('week-absence-run')).toHaveCount(3);
	await expect(page.getByTestId('week-absences')).toContainText('noch nicht beantragt');
	await expect(page.getByTestId('week-absences')).toContainText('beantragt, noch nicht genehmigt');
	await expect(page.getByTestId(`week-day-${monday}`).getByTestId('day-absence')).toContainText('noch nicht beantragt');
	await expect(page.getByTestId('week-absence-planner')).toHaveAttribute('href', '/vacation/planner');
	// leave and come back without ?week: the remembered week is restored
	await page.goto('/calendar');
	await page.goto('/week');
	await expect(page).toHaveURL(new RegExp(`/week\\?week=${isoWeek(monday)}$`));
	await expect(page.getByTestId('week-overview')).toHaveAttribute('data-week', isoWeek(monday));
	// the URL stays the source of truth
	await page.goto(`/week?week=${isoWeek(addDays(monday, -7))}`);
	await expect(page.getByTestId('week-overview')).toHaveAttribute('data-week', isoWeek(addDays(monday, -7)));
	await context.close();
});
