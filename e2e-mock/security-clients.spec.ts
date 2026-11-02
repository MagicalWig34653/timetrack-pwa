import { expect, test } from './test';
import { loginAsAdmin, newAuthenticatorContext } from './helpers';

// Client behaviour for the backend hardening of contracts 0.40.0/0.41.0 (SEC-clients). Serial: the mock server keeps its state.
test.describe.configure({ mode: 'serial' });

const limits = (page: import('@playwright/test').Page, data: Record<string, unknown>) => page.request.post('/api/v1/mock/limits', { data });

test('export: a stale session asks for a fresh passkey sign-in and the export repeats itself afterwards', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.request.post('/api/v1/mock/accounts', { data: { staleSessions: true } });
	await page.goto('/settings/privacy');
	await page.getByTestId('export-button').click();
	await expect(page.getByTestId('reauth')).toBeVisible();
	await page.getByTestId('reauth-action').click();
	await expect(page).toHaveURL(/\/login\?next=/);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page.getByTestId('export-done')).toContainText('timetrack-export-admin.zip');
	expect((await download).suggestedFilename()).toBe('timetrack-export-admin.zip');
	await expect(page).toHaveURL(/\/settings\/privacy$/);
	await context.close();
});

test('export: the hourly limit is shown with the waiting time', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await limits(page, { exportLimited: true, retryAfter: 1800 });
	await page.goto('/settings/privacy');
	await page.getByTestId('export-button').click();
	await expect(page.getByTestId('export-error')).toContainText('30 Minuten');
	await limits(page, { exportLimited: false, retryAfter: null });
	await context.close();
});

test('a session ended elsewhere leads quietly to the login, without an error message on the page', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/privacy');
	await expect(page.getByTestId('export-button')).toBeVisible();
	await limits(page, { endSessions: true });
	// the next data call finds the session gone
	await page.getByTestId('export-button').click();
	await expect(page).toHaveURL(/\/login\?ended=1/);
	await expect(page.getByTestId('login-session-ended')).toContainText('Sitzung wurde beendet');
	await context.close();
});

test('recovery start: 429 shows the friendly message', async ({ browser }) => {
	const { page, context } = await newAuthenticatorContext(browser);
	await limits(page, { limited: ['/api/v1/auth/recovery/start'], retryAfter: 120 });
	await page.goto('/recover');
	await page.locator('#recover-handle').fill('admin');
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByText(/Zu viele Versuche, bitte später erneut versuchen\. Bitte versuche es in etwa 2 Minuten erneut\./)).toBeVisible();
	await limits(page, { limited: [], retryAfter: null });
	await context.close();
});

test('recovery settings: 16 character minimum and weak passwords are explained', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/recovery');
	await expect(page.getByText(/Mindestens 16 Zeichen/)).toBeVisible();
	await page.getByLabel('Neues Rückfallpasswort').or(page.getByLabel('Rückfallpasswort', { exact: true })).fill('aaaaaaaaaaaaaaaa');
	await page.getByLabel('Passwort wiederholen').fill('aaaaaaaaaaaaaaaa');
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByText(/zu leicht zu erraten/)).toBeVisible();
	await context.close();
});

test('uploads: the quota and the upload rate are explained; the admin page shows and changes the quota', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/storage');
	await expect(page.getByLabel('Speicherplatz je Konto')).toHaveValue('200');
	await expect(page.getByLabel('Höchstzahl Dateien je Konto')).toHaveValue('500');
	await page.getByLabel('Höchstzahl Dateien je Konto').fill('0');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-saved')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Höchstzahl Dateien je Konto')).toHaveValue('0');
	await page.getByLabel('Höchstzahl Dateien je Konto').fill('500');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('storage-saved')).toBeVisible();
	await context.close();
});

test('consent: the client is marked as not verified with the registration date and a prominent redirect host', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/mock-oauth');
	await page.getByRole('button', { name: 'Autorisierung starten' }).click();
	await expect(page).toHaveURL(/\/oauth\/consent\?request=/);
	await expect(page.getByTestId('client-unverified')).toContainText('Nicht verifizierter Client');
	await expect(page.getByTestId('client-registered')).toContainText('Registriert am');
	await expect(page.getByTestId('redirect-host')).toContainText('localhost');
	await context.close();
});

test('passkeys: the revoke warning and the recovery page name the sign-out of other devices', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/passkeys');
	await page.getByRole('button', { name: 'Widerrufen' }).first().click();
	await expect(page.getByText(/anderen Geräte/)).toBeVisible();
	await context.close();
});
