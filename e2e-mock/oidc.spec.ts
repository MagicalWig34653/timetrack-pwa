import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// Optional OIDC against the in-repo mock (provider = in-app page /mock-idp). Serial: the mock server keeps its state.
test.describe.configure({ mode: 'serial' });

test('login page: not-linked error is explained and the URL is cleaned', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
	await page.getByRole('button', { name: 'Mit Mock-IdP anmelden' }).click();
	await expect(page.getByRole('heading', { name: /Mock-Anbieter/ })).toBeVisible();
	await page.getByRole('link', { name: /Demo-Nutzer 1 bestätigen/ }).click();
	await expect(page.getByRole('alert')).toContainText('per Einladung');
	await expect(page.getByRole('alert')).toContainText('Einstellungen');
	await expect(page).toHaveURL(/\/login$/);
});

test('login page: provider error codes show German messages', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('button', { name: 'Mit Mock-IdP anmelden' }).click();
	await page.getByRole('link', { name: 'oidc_token_invalid' }).click();
	await expect(page.getByRole('alert')).toContainText('gültige Bestätigung');
});

test('link, log in with the identity, then unlink with confirmation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/identities');
	await expect(page.getByText('Noch kein externes Konto verknüpft.')).toBeVisible();
	await page.getByRole('button', { name: 'Konto verknüpfen' }).click();
	await page.getByRole('link', { name: /Demo-Nutzer 1 bestätigen/ }).click();
	await expect(page.getByText('Das externe Konto wurde verknüpft.')).toBeVisible();
	await expect(page).toHaveURL(/\/settings\/identities$/);
	await expect(page.getByText('Mock-IdP', { exact: true })).toBeVisible();
	await expect(page.getByText(/nur Hinweis/)).toBeVisible();

	// log in with the new identity from a clean browser context
	const fresh = await browser.newContext();
	const login = await fresh.newPage();
	await login.goto('/login');
	await login.getByRole('button', { name: 'Mit Mock-IdP anmelden' }).click();
	await login.getByRole('link', { name: /Demo-Nutzer 1 bestätigen/ }).click();
	await expect(login.getByRole('heading', { name: /^Hallo, / })).toBeVisible();
	await fresh.close();

	// provider says the identity belongs to someone else
	await page.getByRole('button', { name: 'Konto verknüpfen' }).click();
	await page.getByRole('link', { name: /Demo-Nutzer 2/ }).click();
	await expect(page.getByRole('alert')).toContainText('anderen Timetrack-Konto');

	await page.getByRole('button', { name: 'Verknüpfung entfernen' }).click();
	await page.getByRole('button', { name: 'Verknüpfung endgültig entfernen' }).click();
	await expect(page.getByText('Die Verknüpfung wurde entfernt.')).toBeVisible();
	await expect(page.getByText('Noch kein externes Konto verknüpft.')).toBeVisible();
	await context.close();
});

test('stale session: linking asks to log in again', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.request.post('/api/v1/mock/oidc', { data: { staleSessions: true } });
	await page.goto('/settings/identities');
	await page.getByRole('button', { name: 'Konto verknüpfen' }).click();
	await expect(page.getByText('Frische Anmeldung nötig')).toBeVisible();
	await page.getByRole('button', { name: 'Abmelden und neu anmelden' }).click();
	await expect(page).toHaveURL(/\/login/);
	await context.close();
});

test('phone width: no horizontal scroll on the OIDC pages; optional screenshots (SCREENSHOT_DIR)', async ({ browser }) => {
	const dir = process.env.SCREENSHOT_DIR;
	for (const colorScheme of ['light', 'dark'] as const) {
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 }, colorScheme });
		await page.goto('/settings/identities');
		await page.getByRole('button', { name: 'Konto verknüpfen' }).click();
		await page.getByRole('link', { name: /Demo-Nutzer 1 bestätigen/ }).click();
		await expect(page.getByText('Das externe Konto wurde verknüpft.')).toBeVisible();
		await page.getByRole('button', { name: 'Verknüpfung entfernen' }).click();
		const pages: [string, string][] = [['identities', '/settings/identities']];
		for (const [name, route] of pages) {
			await page.goto(route);
			await expect(page.getByRole('heading', { name: 'Verknüpfte Anmeldungen' })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			if (dir) await page.screenshot({ path: `${dir}/oidc-phone-${colorScheme}-${name}.png`, fullPage: true });
		}
		await page.getByRole('button', { name: 'Verknüpfung entfernen' }).click();
		if (dir) await page.screenshot({ path: `${dir}/oidc-phone-${colorScheme}-identities-confirm.png`, fullPage: true });
		await page.getByRole('button', { name: 'Verknüpfung endgültig entfernen' }).click();
		await expect(page.getByText('Die Verknüpfung wurde entfernt.')).toBeVisible();
		await context.close();

		const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme });
		const view = await anon.newPage();
		await view.goto('/login?oidc_error=oidc_not_linked');
		await expect(view.getByRole('button', { name: 'Mit Mock-IdP anmelden' })).toBeVisible();
		expect(await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		if (dir) await view.screenshot({ path: `${dir}/oidc-phone-${colorScheme}-login.png`, fullPage: true });
		await view.goto('/invite/demo-invite');
		await expect(view.getByRole('button', { name: /Stattdessen mit/ })).toBeVisible();
		if (dir) await view.screenshot({ path: `${dir}/oidc-phone-${colorScheme}-invite.png`, fullPage: true });
		await view.getByRole('button', { name: /Stattdessen mit/ }).click();
		await view.getByRole('link', { name: /Demo-Nutzer 2/ }).click(); // identity taken -> login error
		await view.goto('/mock-idp?flow=x&purpose=login');
		if (dir) await view.screenshot({ path: `${dir}/oidc-phone-${colorScheme}-mock-idp.png`, fullPage: true });
		await anon.close();
	}
});

test('register via invitation with the provider, then passkey prompt and last_login_method', async ({ browser, page }) => {
	// a fresh invitation from the admin API
	const { page: adminPage, context: adminContext } = await loginAsAdmin(browser);
	const csrf = (await (await adminPage.request.get('/api/v1/auth/session')).json()).csrfToken;
	const invitation = await (await adminPage.request.post('/api/v1/admin/invitations', { data: { expiresInHours: 24 }, headers: { 'X-CSRF-Token': csrf } })).json();
	await adminContext.close();

	await page.goto(`/invite/${invitation.token}`);
	await page.getByRole('button', { name: 'Stattdessen mit Mock-IdP registrieren' }).click();
	await page.getByRole('link', { name: /Demo-Nutzer 1 bestätigen/ }).click();
	await expect(page.getByRole('heading', { name: 'Konto mit Mock-IdP anlegen' })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/invite/${invitation.token}$`));
	await page.getByLabel('Kontoname').fill('oidc-mia');
	await page.getByLabel('Anzeigename').fill('Mia OIDC');
	await page.getByRole('button', { name: 'Konto anlegen' }).click();
	await expect(page.getByRole('heading', { name: 'Passkey einrichten' })).toBeVisible();
	await page.getByRole('button', { name: 'Passkey einrichten' }).click();
	await expect(page).toHaveURL(/\/settings\/passkeys$/);

	await page.goto('/settings/identities');
	await page.getByRole('button', { name: 'Verknüpfung entfernen' }).click();
	await page.getByRole('button', { name: 'Verknüpfung endgültig entfernen' }).click();
	await expect(page.getByRole('alert')).toContainText('letzte Anmeldemethode');
});
