import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// "Fortführen" (package W2, backend contract 0.27.0) against the in-repo mock. Screenshots only with SCREENSHOT_DIR.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

// The mock state is shared by all specs of the run: leave today empty for the specs that follow.
test.afterAll(async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await clearToday(page);
	await context.close();
});

async function api(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	return page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken, ...headers } });
}

/** Voids today's segments and stops a running timer so each test starts from an empty day. */
async function clearToday(page: Page) {
	const timer = await (await api(page, 'GET', '/time/timer')).json();
	if (timer) await api(page, 'POST', '/time/timer/stop', { clientEventId: crypto.randomUUID() });
	const from = new Date(Date.now() - 24 * 3600_000).toISOString();
	const to = new Date(Date.now() + 24 * 3600_000).toISOString();
	const list = await (await api(page, 'GET', `/time/segments?from=${from}&to=${to}`)).json();
	for (const s of list) await api(page, 'DELETE', `/time/segments/${s.id}?reason=Test`);
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

test('short gap: one button, reopens the same segment, stopping works as usual', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await clearToday(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Start' }).click();
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await page.getByRole('button', { name: 'Stopp' }).click();
	const panel = page.getByTestId('continue-panel');
	await expect(panel.getByRole('button', { name: /^Fortführen: Arbeit, zuletzt bis \d{2}:\d{2}$/ })).toBeVisible();
	await expect(page.getByTestId('continue-restart')).toHaveCount(0);
	if (dir) await page.getByRole('heading', { name: 'Zeiterfassung' }).locator('xpath=ancestor::*[contains(@class,"rounded")][1]').screenshot({ path: `${dir}/w2-continue-short.png` });
	await panel.getByTestId('continue-reopen').click();
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await expect(page.getByTestId('continue-notice')).toContainText('Lücke zählt als Arbeitszeit');
	await expect(page.getByTestId('segment-row')).toHaveCount(1);
	await expect(page.getByTestId('continue-panel')).toHaveCount(0);
	await page.getByRole('button', { name: 'Stopp' }).click();
	await expect(page.getByTestId('segment-row')).toHaveCount(1);
	await context.close();
});

test('long gap: two choices; "Fortführen" keeps the segment, "Neu starten" adds one', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 900 } });
	await clearToday(page);
	const created = await api(page, 'POST', '/time/segments', { kind: 'work', startedAt: minutesAgo(90), endedAt: minutesAgo(40) });
	expect(created.status()).toBe(201);
	await page.goto('/');
	await expect(page.getByTestId('continue-hint')).toContainText(/Lücke beträgt 0:4\d Std\./);
	if (dir) {
		await page.getByTestId('continue-panel').scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${dir}/w2-continue-long-390.png`, fullPage: false });
	}
	await page.getByRole('button', { name: 'Neu starten (Lücke bleibt Pause)' }).click();
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await expect(page.getByTestId('segment-row')).toHaveCount(2);
	await expect(page.getByTestId('gap-row')).toBeVisible();
	await page.getByRole('button', { name: 'Stopp' }).click();

	// reopen the newest one: the gap to its end is short, so the single button appears
	await page.getByTestId('continue-reopen').click();
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await expect(page.getByTestId('segment-row')).toHaveCount(2);
	await context.close();
});

test('long gap: "Fortführen (Lücke zählt mit)" reopens the old segment', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await clearToday(page);
	await api(page, 'POST', '/time/segments', { kind: 'work', startedAt: minutesAgo(90), endedAt: minutesAgo(40) });
	await page.goto('/');
	await page.getByRole('button', { name: 'Fortführen (Lücke zählt mit)' }).click();
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await expect(page.getByTestId('segment-row')).toHaveCount(1);
	await expect(page.getByTestId('gap-row')).toHaveCount(0);
	await context.close();
});

test('guards: a timer started elsewhere shows the message and the page recovers', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await clearToday(page);
	await api(page, 'POST', '/time/segments', { kind: 'work', startedAt: minutesAgo(30), endedAt: minutesAgo(10) });
	await page.goto('/');
	await expect(page.getByTestId('continue-reopen')).toBeVisible();
	// another device starts a timer; the dashboard does not know yet
	await api(page, 'POST', '/time/timer/start', { clientEventId: crypto.randomUUID(), kind: 'work' });
	await page.getByTestId('continue-reopen').click();
	await expect(page.getByText('Es läuft bereits ein Timer.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await context.close();
});

test('day detail: context menu entry Fortführen on the latest segment of today', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await clearToday(page);
	await api(page, 'POST', '/time/segments', { kind: 'work', startedAt: minutesAgo(30), endedAt: minutesAgo(10) });
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
	await page.goto(`/time/${today}`);
	// voided rows of earlier tests stay in the list; the new segment is the last active row
	const row = page.getByTestId('segment-row').filter({ hasNotText: 'Storniert' }).last();
	// bring the row to the middle first: a scroll after opening closes the menu by design
	await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await page.waitForTimeout(400);
	await row.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Fortführen' }).click();
	await expect(page.getByText('Der Eintrag läuft weiter')).toBeVisible();
	await expect(page.getByTestId('segment-row').filter({ hasNotText: 'Storniert' }).last()).toContainText('Läuft');
	await context.close();
});
