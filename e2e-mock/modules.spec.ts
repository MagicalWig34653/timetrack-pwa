import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Module switches (ADR-0012) against the mock. Serial: the mock server keeps its state, every test restores it.
test.describe.configure({ mode: 'serial' });

async function api(page: Page, method: string, path: string, body?: unknown) {
	return page.evaluate(
		async ({ method, path, body }) => {
			const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
			const res = await fetch(path, {
				method,
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			return { status: res.status, body: await res.json() };
		},
		{ method, path, body }
	);
}

/** Everything on for the account, no operator lock, all modules available on the server. */
async function reset(page: Page) {
	await api(page, 'POST', '/api/v1/mock/modules', { locked: [], server: { reports: true, planning: true, transfer: true, automation: true, mcp: true } });
	await api(page, 'PUT', '/api/v1/me/modules', { modules: { reports: true, planning: true, transfer: true, automation: true, mcp: true } });
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Hauptnavigation' });

test('switching reports off hides navigation, dashboard teaser and route; switching on restores them', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await expect(nav(page).getByRole('link', { name: 'Berichtsheft' })).toBeVisible();
	await expect(page.getByTestId('reports-teaser')).toBeVisible();

	await page.goto('/settings/modules');
	await expect(page.getByTestId('modules-note-data')).toContainText('Daten bleiben erhalten');
	await page.getByTestId('module-switch-reports').uncheck();
	await expect(page.getByTestId('modules-notice')).toHaveText('Gespeichert.');
	await expect(nav(page).getByRole('link', { name: 'Berichtsheft' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Lernfelder' })).toHaveCount(0);

	await page.goto('/');
	await expect(page.getByRole('heading', { name: /^Hallo, / })).toBeVisible();
	await expect(page.getByTestId('reports-teaser')).toHaveCount(0);

	await page.goto('/reports');
	await expect(page.getByTestId('module-disabled')).toContainText('Dieses Modul ist deaktiviert');
	await page.goto('/settings/learning-fields');
	await expect(page.getByTestId('module-disabled')).toBeVisible();
	await page.getByRole('link', { name: 'Zu den Moduleinstellungen' }).click();
	await expect(page).toHaveURL(/\/settings\/modules$/);

	await page.getByTestId('module-switch-reports').check();
	await expect(page.getByTestId('modules-notice')).toHaveText('Gespeichert.');
	await expect(nav(page).getByRole('link', { name: 'Berichtsheft' })).toBeVisible();
	await page.goto('/reports');
	await expect(page.getByRole('heading', { name: 'Berichtsheft' }).first()).toBeVisible();
	await expect(page.getByTestId('module-disabled')).toHaveCount(0);
	await reset(page);
	await context.close();
});

test('switching planning off hides vacation, calendar, absences and sharing', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/modules');
	await page.getByTestId('module-switch-planning').uncheck();
	await expect(page.getByTestId('modules-notice')).toBeVisible();
	for (const name of ['Urlaub', 'Kalender', 'Abwesenheiten', 'Geteilt']) {
		await expect(nav(page).getByRole('link', { name, exact: true })).toHaveCount(0);
	}
	await expect(page.getByTestId('modules-note-planning')).toContainText('Tagesbewertung');
	for (const path of ['/vacation', '/calendar', '/absences', '/shared', '/settings/sharing']) {
		await page.goto(path);
		await expect(page.getByTestId('module-disabled'), path).toBeVisible();
	}
	await reset(page);
	await context.close();
});

test('operator-locked modules show their state and cannot be switched; MCP pages show the notice', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await api(page, 'POST', '/api/v1/mock/modules', { locked: ['mcp', 'transfer'] });
	await page.goto('/settings/modules');
	const mcp = page.locator('[data-module="mcp"]');
	await expect(mcp.getByTestId('module-state')).toHaveText('Vom Betreiber deaktiviert');
	await expect(mcp.getByRole('switch')).toBeDisabled();
	await expect(page.getByRole('link', { name: 'API-Tokens' })).toHaveCount(0);
	await expect(nav(page).getByRole('link', { name: 'Export' })).toHaveCount(0);
	await page.goto('/settings/api-tokens');
	await expect(page.getByTestId('module-disabled')).toContainText('abgeschaltet');
	await page.goto('/oauth/consent?request=nope');
	await expect(page.getByTestId('module-disabled')).toBeVisible();
	await reset(page);
	await context.close();
});

test('admin switches planning off server-wide after a warning; the account switch is then disabled', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await nav(page).getByRole('link', { name: 'Module (Server)' }).click();
	await expect(page.getByRole('heading', { name: 'Module des Servers' })).toBeVisible();
	await page.getByTestId('admin-switch-planning').uncheck();
	await page.getByTestId('admin-save').click();
	await expect(page.getByTestId('admin-confirm')).toContainText('Betrifft alle Konten');
	await page.getByTestId('admin-confirm-yes').click();
	await expect(page.getByTestId('admin-modules-notice')).toContainText('gespeichert');
	await expect(nav(page).getByRole('link', { name: 'Urlaub', exact: true })).toHaveCount(0);

	await page.goto('/settings/modules');
	const planning = page.locator('[data-module="planning"]');
	await expect(planning.getByTestId('module-state')).toHaveText('Server deaktiviert');
	await expect(planning.getByRole('switch')).toBeDisabled();

	// switching on needs no warning
	await page.goto('/admin/modules');
	await page.getByTestId('admin-switch-planning').check();
	await page.getByTestId('admin-save').click();
	await expect(page.getByTestId('admin-confirm')).toHaveCount(0);
	await expect(page.getByTestId('admin-modules-notice')).toContainText('gespeichert');
	await reset(page);
	await context.close();
});

test('new pages on a 390 px phone in dark mode have no horizontal scroll', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
	for (const path of ['/settings/modules', '/admin/modules']) {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('switch').first()).toBeVisible();
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, path).toBeLessThanOrEqual(0);
		if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/phone-dark-${path.slice(1).replace(/\//g, '_')}.png`, fullPage: true });
	}
	await context.close();
});
