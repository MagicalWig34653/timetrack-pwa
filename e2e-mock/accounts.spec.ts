import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, newAuthenticatorContext } from './helpers';

// Account administration and privacy (ADR-0016) against the mock. Serial: the mock server keeps its state.
// Only accounts created here are modified; the demo accounts `admin` and `lena` stay untouched for the other specs.
test.describe.configure({ mode: 'serial' });

const shots = process.env.SCREENSHOT_DIR;

async function hook(page: Page, body: unknown) {
	return page.evaluate(async (payload) => (await fetch('/api/v1/mock/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, body);
}

const row = (page: Page, handle: string) => page.locator(`[data-testid="account-row"][data-handle="${handle}"]`);

test('admin sees the accounts page in the Verwaltung group, once, and the privacy tab in the settings', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
	await expect(nav.getByRole('link', { name: 'Konten' })).toHaveCount(1);
	await nav.getByRole('link', { name: 'Konten' }).click();
	await expect(page).toHaveURL(/\/admin\/accounts$/);
	await expect(page.getByRole('heading', { name: 'Konten', level: 1 })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Daten & Datenschutz' })).toHaveCount(0);
	await page.goto('/settings/privacy');
	await expect(page.getByTestId('settings-tabs').getByRole('link', { name: 'Daten & Datenschutz' })).toHaveAttribute('aria-current', 'page');
	await context.close();
});

test('disable and reactivate, promote and demote, revoke sessions', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await hook(page, { add: [{ handle: 'e2e-ben', displayName: 'Ben E2E', passkeys: 2 }] });
	await page.goto('/admin/accounts');
	const ben = row(page, 'e2e-ben');
	await expect(ben).toContainText('Aktiv');
	await expect(ben).toContainText('2 Passkeys');
	await expect(row(page, 'admin')).toContainText('Du');
	await expect(row(page, 'admin').getByTestId('act-delete')).toHaveCount(0);

	await ben.getByTestId('act-disable').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Konto „e2e-ben“ deaktivieren?');
	await dialog.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(ben).toContainText('Aktiv');
	await ben.getByTestId('act-disable').click();
	await dialog.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('accounts-notice')).toContainText('Konto „e2e-ben“ ist deaktiviert.');
	await expect(ben).toContainText('Deaktiviert');
	await ben.getByTestId('act-reactivate').click();
	await expect(ben).toHaveAttribute('data-state', 'active');

	await ben.getByTestId('act-role').click();
	await dialog.getByTestId('confirm-submit').click();
	await expect(ben).toHaveAttribute('data-role', 'admin');
	await ben.getByTestId('act-role').click();
	await dialog.getByTestId('confirm-submit').click();
	await expect(ben).toHaveAttribute('data-role', 'member');

	await ben.getByTestId('act-sessions').click();
	await dialog.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('accounts-notice')).toContainText('Die Sitzungen von „e2e-ben“ sind beendet.');
	await context.close();
});

test('a role change after a stale login asks for a fresh passkey login and then succeeds', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await hook(page, { add: [{ handle: 'e2e-cora' }] });
	await page.goto('/admin/accounts');
	await hook(page, { staleSessions: true });
	await row(page, 'e2e-cora').getByTestId('act-role').click();
	await page.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('reauth')).toContainText('Frische Anmeldung nötig');
	await page.getByTestId('reauth-action').click();
	await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Faccounts/);
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page).toHaveURL(/\/admin\/accounts$/);
	await row(page, 'e2e-cora').getByTestId('act-role').click();
	await page.getByTestId('confirm-submit').click();
	await expect(row(page, 'e2e-cora')).toHaveAttribute('data-role', 'admin');
	await context.close();
});

test('delete needs the typed handle; an incomplete deletion can be retried', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await hook(page, { add: [{ handle: 'e2e-dora' }] });
	await page.goto('/admin/accounts');
	await row(page, 'e2e-dora').getByTestId('act-delete').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('unwiderruflich gelöscht');
	const submit = dialog.getByTestId('confirm-submit');
	await expect(submit).toBeDisabled();
	await dialog.getByLabel(/Benutzernamen „e2e-dora“/).fill('e2e-dor');
	await expect(submit).toBeDisabled();
	await dialog.getByLabel(/Benutzernamen „e2e-dora“/).fill('e2e-dora');
	await expect(submit).toBeEnabled();
	if (shots) await page.screenshot({ path: `${shots}/accounts-desktop-light-delete-dialog.png` });
	await hook(page, { failDeletion: true });
	await submit.click();
	await expect(dialog.getByTestId('confirm-warning')).toContainText('noch nicht vollständig gelöscht');
	await expect(dialog.getByTestId('confirm-submit')).toHaveText('Erneut versuchen');
	await dialog.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('accounts-notice')).toContainText('Konto „e2e-dora“ wurde gelöscht.');
	await expect(row(page, 'e2e-dora')).toHaveCount(0);
	await context.close();
});

test('data page: export download and self-deletion of a second user clears the session', async ({ browser }) => {
	const { page: adminPage, context: adminContext } = await loginAsAdmin(browser);
	const csrf = (await (await adminPage.request.get('/api/v1/auth/session')).json()).csrfToken;
	const invitation = await (await adminPage.request.post('/api/v1/admin/invitations', { data: { expiresInHours: 24 }, headers: { 'X-CSRF-Token': csrf } })).json();
	await adminContext.close();

	const { context, page } = await newAuthenticatorContext(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(`/invite/${invitation.token}`);
	await page.getByLabel('Kontoname').fill('e2e-gone');
	await page.getByLabel('Anzeigename').fill('Gone E2E');
	await page.getByRole('button', { name: 'Passkey erstellen und Konto anlegen' }).click();
	await expect(page).toHaveURL(/\/setup\/recovery$/);

	await page.goto('/settings/privacy');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-button').click()]);
	expect(download.suggestedFilename()).toBe('timetrack-export-e2e-gone.zip');
	const file = await download.path();
	expect(fs.readFileSync(file!).subarray(0, 4).toString('hex')).toBe('504b0304');
	await expect(page.getByTestId('export-done')).toContainText('timetrack-export-e2e-gone.zip');

	await page.getByTestId('delete-open').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Folgendes wird unwiderruflich gelöscht');
	await expect(dialog.getByTestId('confirm-submit')).toBeDisabled();
	await dialog.getByLabel(/Benutzernamen „e2e-gone“/).fill('e2e-gone');
	await dialog.getByTestId('confirm-submit').click();
	await expect(page).toHaveURL(/\/login\?deleted=1/);
	await expect(page.getByTestId('login-deleted')).toContainText('Auf Wiedersehen');
	expect((await page.request.get('/api/v1/auth/session')).status()).toBe(401);
	await page.goto('/time');
	await expect(page).toHaveURL(/\/login/);
	await context.close();
});

test('the last administrator cannot delete the own account (message in the dialog)', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/admin/accounts');
	// e2e-cora was promoted above, so make sure the demo admin is the only active admin
	await row(page, 'e2e-cora').getByTestId('act-role').click();
	await page.getByTestId('confirm-submit').click();
	await expect(row(page, 'e2e-cora')).toHaveAttribute('data-role', 'member');
	await page.goto('/settings/privacy');
	await page.getByTestId('delete-open').click();
	await page.getByLabel(/Benutzernamen „admin“/).fill('admin');
	await page.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('confirm-error')).toContainText('letzte aktive Administrator');
	await expect(page).toHaveURL(/\/settings\/privacy$/);
	await context.close();
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`screenshots accounts and data ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!shots, 'set SCREENSHOT_DIR');
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await hook(page, {
				add: [
					{ handle: 'shot-mia', displayName: 'Mia Muster', email: 'mia@example.org', passkeys: 2, lastActivityAt: new Date(Date.now() - 3600_000).toISOString() },
					{ handle: 'shot-tom', displayName: 'Tom Test', disabled: true, passkeys: 1 }
				]
			});
			await page.goto('/admin/accounts');
			await expect(row(page, 'shot-mia')).toBeVisible();
			await page.screenshot({ path: `${shots}/accounts-${name}-${scheme}.png`, fullPage: true });
			await row(page, 'shot-mia').getByTestId('act-delete').click();
			await page.getByLabel(/Benutzernamen „shot-mia“/).fill('shot-mia');
			await page.screenshot({ path: `${shots}/accounts-${name}-${scheme}-dialog.png` });
			await page.keyboard.press('Escape');
			await page.goto('/settings/privacy');
			await expect(page.getByTestId('export-button')).toBeVisible();
			await page.screenshot({ path: `${shots}/privacy-${name}-${scheme}.png`, fullPage: true });
			await page.getByTestId('delete-open').click();
			await page.getByLabel(/Benutzernamen „admin“/).fill('admin');
			await page.screenshot({ path: `${shots}/privacy-${name}-${scheme}-dialog.png` });
			await context.close();
		});
	}
}
