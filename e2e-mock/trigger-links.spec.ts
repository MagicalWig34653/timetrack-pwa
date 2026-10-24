import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Trigger link management (W1, ADR-0027) against the mock. Serial: the mock server keeps its state.
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
			return { status: res.status, body: res.status === 204 ? null : await res.json() };
		},
		{ method, path, body }
	);
}

test('create, show once, reload without URL, revoke', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/trigger-links');
	await expect(page.getByRole('heading', { name: 'Auslöse-Links' })).toBeVisible();
	await expect(page.getByTestId('trigger-security')).toContainText('Wie ein Passwort behandeln');
	await page.getByLabel('Bezeichnung').fill('NFC-Tag Schreibtisch');
	await page.getByLabel('Gültigkeit in Tagen (optional)').fill('90');
	await page.getByRole('button', { name: 'Link erzeugen' }).click();
	const banner = page.getByTestId('created-link');
	await expect(banner).toContainText('Jetzt kopieren');
	const url = (await banner.getByTestId('link-url-start').textContent())!;
	expect(url).toMatch(/\/t\/[A-Za-z0-9]{43}\/start$/);
	await expect(page.getByTestId('link-list')).toContainText('NFC-Tag Schreibtisch');
	if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/trigger-created.png`, fullPage: true });

	await page.reload();
	await expect(page.getByTestId('link-list')).toContainText('NFC-Tag Schreibtisch');
	await expect(page.locator('body')).not.toContainText(url.split('/')[4]);

	await page.getByRole('button', { name: 'Link „NFC-Tag Schreibtisch“ widerrufen' }).click();
	if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/trigger-revoke.png`, fullPage: true });
	await page.getByRole('button', { name: 'Endgültig widerrufen' }).click();
	await expect(page.getByText('Link widerrufen.')).toBeVisible();
	await expect(page.getByText('Noch keine Auslöse-Links.')).toBeVisible();
	await context.close();
});

test('module automation off: page unavailable, nav entry gone', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await api(page, 'PUT', '/api/v1/me/modules', { modules: { automation: false } });
	await page.goto('/settings/trigger-links');
	await expect(page.getByRole('heading', { name: 'Auslöse-Links' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Auslöse-Links' })).toHaveCount(0);
	await api(page, 'PUT', '/api/v1/me/modules', { modules: { automation: true } });
	await page.goto('/settings/trigger-links');
	await expect(page.getByRole('heading', { name: 'Auslöse-Links' })).toBeVisible();
	await context.close();
});
