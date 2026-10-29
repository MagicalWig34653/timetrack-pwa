import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Package U4 on the mock: absence statuses per kind (contract 0.36.0), time account without the running day,
// the account e-mail as recovery address and the pointer cursor on clickable controls.
test.describe.configure({ mode: 'serial' });

// The pointer rests on the clicked button, whose hover colour is not meant for the contrast rule: move it away and let the colour settle.
const axe = async (page: Page) => {
	await page.mouse.move(0, 0);
	await page.waitForTimeout(300);
	return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
};

test('sick leave has no status selector or approval wording; vacation keeps the workflow', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/absences');
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	const form = page.getByTestId('absence-form');
	await expect(form.locator('#abs-status')).toBeVisible(); // vacation is the default kind
	const vacationOptions = await form.locator('#abs-status option').allTextContents();
	expect(vacationOptions).toEqual(expect.arrayContaining(['Geplant', 'Beantragt', 'Genehmigt']));
	expect(vacationOptions).not.toContain('Erfasst');
	await form.getByLabel('Art').selectOption('sick');
	await expect(form.locator('#abs-status')).toHaveCount(0);
	await expect(form.getByTestId('absence-recorded-note')).toHaveText('Erfasst');
	await expect(form).not.toContainText(/genehmigt|beantragt|genommen/i);
	expect((await axe(page)).violations).toEqual([]);
	// save a sick day far in the future: stored as recorded, listed as "Erfasst"
	await form.locator('#abs-start').fill('2031-06-02');
	await form.locator('#abs-end').fill('2031-06-02');
	await form.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Abwesenheit gespeichert.')).toBeVisible();
	const stored = await page.evaluate(async () => (await (await fetch('/api/v1/absences?from=2031-06-01&to=2031-06-30')).json()) as { kind: string; status: string }[]);
	expect(stored).toEqual([expect.objectContaining({ kind: 'sick', status: 'recorded' })]);
	// the mock validates like the backend
	const csrf = (await (await page.request.get('/api/v1/auth/session')).json()).csrfToken;
	const post = (data: object) => page.request.post('/api/v1/absences', { data, headers: { 'X-CSRF-Token': csrf } });
	expect((await post({ kind: 'vacation', startDate: '2031-07-01', endDate: '2031-07-01', status: 'recorded' })).status()).toBe(400);
	expect((await post({ kind: 'sick', startDate: '2031-07-02', endDate: '2031-07-02', status: 'rejected' })).status()).toBe(400);
	expect((await (await post({ kind: 'sick', startDate: '2031-07-03', endDate: '2031-07-03', status: 'approved' })).json()).status).toBe('recorded');
	await context.close();
});

test('an unknown absence status from a newer server neither blanks nor breaks the views', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.route('**/api/v1/absences?*', async (route) => {
		const response = await route.fetch();
		const list = (await response.json()) as { status: string }[];
		await route.fulfill({ response, json: list.map((a, i) => (i === 0 ? { ...a, status: 'on_hold' } : a)) });
	});
	await page.route('**/api/v1/time/weeks/*', async (route) => {
		const response = await route.fetch();
		const week = (await response.json()) as { days: { absences: { status: string }[] }[] };
		for (const day of week.days) for (const absence of day.absences) absence.status = 'on_hold';
		await route.fulfill({ response, json: week });
	});
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/absences');
	await expect(page.getByTestId('absence-status').first()).toHaveText(/\S/);
	await expect(page.getByTestId('absence-row').first()).toBeVisible();
	await page.goto('/calendar');
	await expect(page.getByTestId('month-grid')).toBeVisible();
	await page.goto('/week');
	await expect(page.getByTestId('week-overview')).toBeVisible();
	expect(errors).toEqual([]);
	await page.unrouteAll({ behavior: 'ignoreErrors' });
	await context.close();
});

test('the time account excludes the running day and shows its difference separately', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/account-time');
	await expect(page.getByTestId('account-without-today')).toContainText('ohne den laufenden Tag');
	await expect(page.getByTestId('account-today')).toContainText(/^Heute: [+-]?\d+:\d\d, fließt morgen ein$/);
	await page.goto('/');
	await expect(page.getByTestId('kpi-balance')).toContainText('Heute:');
	await page.goto('/week');
	await expect(page.getByTestId('kpi-week-balance')).toContainText('abgeschlossenen Tage');
	await expect(page.getByTestId('week-balance-today')).toContainText('fließt morgen ein');
	await page.goto('/stats');
	await expect(page.getByTestId('kpi-stats-account')).toContainText('ohne den laufenden Tag');
	await context.close();
});

test('recovery by e-mail uses the account e-mail: no address input, profile link, enabling needs no code', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	// give the account a confirmed address through the profile endpoints
	const csrf = (await (await page.request.get('/api/v1/auth/session')).json()).csrfToken;
	const headers = { 'X-CSRF-Token': csrf };
	await page.request.put('/api/v1/me/profile/email', { data: { email: 'konto@example.org' }, headers });
	await page.request.post('/api/v1/me/profile/email/verify', { data: { code: '123456' }, headers });
	await page.goto('/settings/recovery');
	await expect(page.getByTestId('recovery-account-email')).toContainText('Wiederherstellungs-Codes werden an deine Kontomail gesendet (konto@example.org).');
	await expect(page.getByLabel('E-Mail-Adresse')).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Im Profil ändern' })).toHaveAttribute('href', '/settings/profile');
	expect((await axe(page)).violations).toEqual([]);
	await page.getByTestId('recovery-email-enable').click();
	await expect(page.getByText('E-Mail-Wiederherstellung ist aktiv.')).toBeVisible();
	await page.getByRole('button', { name: 'Deaktivieren' }).last().click();
	// without an account e-mail the user is sent to the profile
	await page.request.delete('/api/v1/me/profile/email', { headers });
	await page.goto('/settings/recovery');
	await expect(page.getByTestId('recovery-no-account-email')).toBeVisible();
	await page.getByTestId('recovery-profile-link').click();
	await expect(page).toHaveURL(/\/settings\/profile$/);
	await context.close();
});

test('clickable controls show the pointer cursor, disabled ones the barred cursor', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const cursorOf = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).cursor);
	await page.goto('/');
	const timer = page.getByRole('button', { name: /^(Start|Stopp)/ }).first();
	await expect(timer).toBeVisible();
	expect(await timer.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
	await page.goto('/absences');
	await expect(page.getByTestId('absence-row').first()).toBeVisible();
	expect(await cursorOf('button:not(:disabled)')).toBe('pointer');
	expect(await cursorOf('nav a[href]')).toBe('pointer');
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	await page.locator('#abs-start').fill('');
	// every enabled button and link of the page, and every disabled button
	const offenders = await page.evaluate(() => {
		const bad: string[] = [];
		for (const el of document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"])')) {
			if (el.offsetParent === null) continue;
			if (getComputedStyle(el).cursor !== 'pointer') bad.push(`${el.tagName} ${el.textContent?.trim().slice(0, 30)} -> ${getComputedStyle(el).cursor}`);
		}
		for (const el of document.querySelectorAll<HTMLElement>('button:disabled')) {
			if (el.offsetParent === null) continue;
			if (getComputedStyle(el).cursor !== 'not-allowed') bad.push(`disabled ${el.textContent?.trim().slice(0, 30)} -> ${getComputedStyle(el).cursor}`);
		}
		return bad;
	});
	expect(offenders).toEqual([]);
	await context.close();
});
