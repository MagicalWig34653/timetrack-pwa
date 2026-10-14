import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, newAuthenticatorContext } from './helpers';

// MCP/OAuth UI against the mock (package L15). The "client" is the in-app page /mock-oauth, which registers itself,
// calls /oauth/authorize (PKCE S256) and shows what the redirect delivered. Serial: the mock server keeps its state.
test.describe.configure({ mode: 'serial' });

/** Starts an authorization from the mock client page; leaves the browser on the consent page (or the login). */
async function startFromMockClient(page: Page, options: { name?: string; scopes?: string[] } = {}) {
	await page.goto('/mock-oauth');
	if (options.name) await page.getByLabel('Anzeigename des Clients').fill(options.name);
	if (options.scopes) {
		for (const box of await page.getByRole('checkbox').all()) if (await box.isChecked()) await box.uncheck();
		for (const label of options.scopes) await page.getByRole('checkbox', { name: new RegExp(label) }).check();
	}
	await page.getByRole('button', { name: 'Autorisierung starten' }).click();
}

test('consent: approve with reduced scopes, redirect delivers code and state, grant lists only the chosen scopes', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await startFromMockClient(page, { name: 'Claude (Test)', scopes: ['Zeiten lesen', 'Zeiten schreiben', 'Berichtsheft lesen'] });
	await expect(page).toHaveURL(/\/oauth\/consent\?request=/);
	await expect(page.getByText('Claude (Test) möchte auf dein Timetrack-Konto zugreifen.')).toBeVisible();
	await expect(page.getByTestId('redirect-host')).toContainText('Du wirst zu localhost:');
	await expect(page.getByTestId('signed-in-as')).toContainText('Admin Demo');
	// nothing was decided just by opening the page
	await page.waitForTimeout(300);
	await expect(page).toHaveURL(/\/oauth\/consent/);
	await expect(page.getByTestId('write-warning')).toBeVisible();

	await page.getByRole('checkbox', { name: /Zeiten schreiben/ }).uncheck();
	await expect(page.getByTestId('write-warning')).toBeHidden();
	await page.getByRole('button', { name: 'Zugriff erlauben' }).click();

	await expect(page).toHaveURL(/\/mock-oauth\?code=/);
	await expect(page.getByTestId('result-code')).toBeVisible();
	await expect(page.getByTestId('oauth-result')).toContainText('State:');

	await page.goto('/settings/connections');
	const row = page.getByTestId('grant-list').getByRole('listitem').filter({ hasText: 'Claude (Test)' });
	await expect(row).toContainText('Zeiten lesen');
	await expect(row).toContainText('Berichtsheft lesen');
	await expect(row).not.toContainText('Zeiten schreiben');
	await context.close();
});

test('consent: deny returns access_denied and creates no grant; a second decision is refused', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await startFromMockClient(page, { name: 'Abgelehnter Client' });
	await expect(page.getByRole('button', { name: 'Ablehnen' })).toBeVisible();
	const consentUrl = page.url();
	await page.getByRole('button', { name: 'Ablehnen' }).click();
	await expect(page.getByTestId('result-error')).toContainText('access_denied');

	await page.goto(consentUrl);
	await expect(page.getByRole('heading', { name: 'Bereits entschieden' })).toBeVisible();
	await page.goto('/settings/connections');
	await expect(page.getByTestId('grant-list').getByText('Abgelehnter Client')).toHaveCount(0);
	await context.close();
});

test('consent: expired or invalid request is explained', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/oauth/consent?request=00000000-0000-4000-8000-000000000000');
	await expect(page.getByRole('heading', { name: 'Anfrage abgelaufen oder ungültig' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Zugriff erlauben' })).toHaveCount(0);
	await page.goto('/oauth/consent');
	await expect(page.getByText('Dieser Link ist unvollständig')).toBeVisible();
	await context.close();
});

test('consent: signed-out visitors log in and come back to the same consent page; other account = log out and back', async ({ browser }) => {
	const { page, context } = await newAuthenticatorContext(browser);
	await startFromMockClient(page, { name: 'Rückkehr-Client' });
	await expect(page).toHaveURL(/\/login\?next=/);
	const next = new URL(page.url()).searchParams.get('next')!;
	expect(next).toMatch(/^\/oauth\/consent\?request=/);
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page).toHaveURL(new RegExp('/oauth/consent\\?request='));
	await expect(page.getByText('Rückkehr-Client möchte auf dein Timetrack-Konto zugreifen.')).toBeVisible();
	const consentUrl = page.url();

	await page.getByRole('button', { name: 'Anderes Konto verwenden' }).click();
	await expect(page).toHaveURL(/\/login\?next=/);
	await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page).toHaveURL(consentUrl);
	await expect(page.getByRole('button', { name: 'Zugriff erlauben' })).toBeEnabled();
	await context.close();
});

test('API tokens: create, copy once, list without secret, revoke with confirmation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto('/settings/api-tokens');
	await expect(page.getByText('Noch keine Tokens angelegt.')).toBeVisible();
	await page.getByRole('button', { name: 'Neues Token' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Skript Laptop');
	await page.getByRole('button', { name: 'Lesen und schreiben' }).click();
	await expect(page.getByRole('checkbox', { name: /Berichtsheft schreiben/ })).toBeChecked();
	await page.getByRole('button', { name: 'Nur lesen' }).click();
	await expect(page.getByRole('checkbox', { name: /Berichtsheft schreiben/ })).not.toBeChecked();
	await page.getByLabel('Gültigkeit').selectOption('90');
	await page.getByRole('button', { name: 'Token erzeugen' }).click();

	const secret = (await page.getByTestId('token-value').textContent())!;
	expect(secret).toMatch(/^ttp_/);
	await expect(page.getByTestId('created-token')).toContainText('nur jetzt angezeigt');
	await page.getByTestId('created-token').getByRole('button', { name: 'Kopieren' }).click();
	await expect(page.getByTestId('created-token').getByText('Kopiert')).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);

	await page.getByRole('button', { name: 'Ich habe es gespeichert' }).click();
	const list = page.getByTestId('token-list');
	await expect(list).toContainText('Skript Laptop');
	await expect(list).toContainText('noch nicht genutzt');
	await expect(list).not.toContainText(secret);
	await page.reload();
	await expect(page.getByTestId('token-list')).toContainText('Skript Laptop');
	await expect(page.locator('body')).not.toContainText(secret);

	await page.getByRole('button', { name: 'Widerrufen' }).click();
	await expect(page.getByTestId('token-list')).toContainText('Skript Laptop');
	await page.getByRole('button', { name: 'Token endgültig widerrufen' }).click();
	await expect(page.getByText('Das Token wurde widerrufen.')).toBeVisible();
	await expect(page.getByText('Noch keine Tokens angelegt.')).toBeVisible();
	await context.close();
});

test('connections: revoke a grant after confirmation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await startFromMockClient(page, { name: 'Widerruf-Client', scopes: ['Zeiten lesen'] });
	await page.getByRole('button', { name: 'Zugriff erlauben' }).click();
	await expect(page).toHaveURL(/\/mock-oauth\?code=/);
	await page.goto('/settings/connections');
	const row = page.getByTestId('grant-list').getByRole('listitem').filter({ hasText: 'Widerruf-Client' });
	await row.getByRole('button', { name: 'Zugriff widerrufen' }).click();
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Zugriff endgültig widerrufen' }).click();
	await expect(page.getByText('Der Zugriff wurde widerrufen.')).toBeVisible();
	await expect(page.getByTestId('grant-list').getByText('Widerruf-Client')).toHaveCount(0);
	await context.close();
});

test('help page: computed MCP URL with copy, header example, untested notice', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto('/settings/mcp-help');
	const origin = new URL(page.url()).origin;
	await expect(page.getByTestId('mcp-url')).toHaveText(`${origin}/mcp`);
	await page.getByRole('button', { name: 'Adresse kopieren' }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/mcp`);
	await expect(page.getByTestId('token-header')).toHaveText('Authorization: Bearer <Token>');
	await expect(page.getByTestId('untested')).toContainText('noch nicht ausprobiert');
	await expect(page.getByRole('heading', { name: 'ChatGPT' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Claude', exact: true })).toBeVisible();
	await context.close();
});

test('API tokens: a stale session asks to log in again instead of creating a token', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.request.post('/api/v1/mock/oidc', { data: { staleSessions: true } });
	await page.goto('/settings/api-tokens');
	await page.getByRole('button', { name: 'Neues Token' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Neu');
	await page.getByRole('button', { name: 'Token erzeugen' }).click();
	await expect(page.getByTestId('reauth')).toContainText('frischen Anmeldung');
	await expect(page.getByTestId('token-value')).toHaveCount(0);
	await page.getByTestId('reauth').getByRole('button', { name: 'Abmelden und neu anmelden' }).click();
	await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fapi-tokens/);
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page).toHaveURL(/\/settings\/api-tokens$/);
	await context.close();
});

test('phone width: consent, tokens and help have no horizontal scroll', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await startFromMockClient(page, { name: 'Ein sehr langer Anzeigename eines Clients der den Platz auf dem Telefon testet', scopes: ['Zeiten lesen', 'Zeiten schreiben'] });
	const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	await expect(page.getByRole('button', { name: 'Zugriff erlauben' })).toBeVisible();
	expect(await overflow()).toBeLessThanOrEqual(0);
	for (const route of ['/settings/api-tokens', '/settings/connections', '/settings/mcp-help']) {
		await page.goto(route);
		await page.waitForLoadState('networkidle');
		expect(await overflow(), route).toBeLessThanOrEqual(0);
	}
	await context.close();
});

const dir = process.env.SCREENSHOT_DIR;
test.describe('screenshots', () => {
	test.skip(!dir, 'set SCREENSHOT_DIR to capture screenshots');
	for (const scheme of ['light', 'dark'] as const) {
		test(`phone ${scheme}`, async ({ browser }) => {
			const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 }, colorScheme: scheme });
			await startFromMockClient(page, { name: 'ChatGPT', scopes: ['Zeiten lesen', 'Zeiten schreiben', 'Planung lesen', 'Berichtsheft lesen'] });
			await page.getByRole('button', { name: 'Zugriff erlauben' }).waitFor();
			await page.screenshot({ path: `${dir}/mcp-${scheme}-consent.png`, fullPage: true });
			await page.getByRole('button', { name: 'Zugriff erlauben' }).click();
			await page.getByTestId('oauth-result').waitFor();
			await page.goto('/settings/connections');
			await page.getByTestId('grant-list').waitFor();
			await page.getByRole('button', { name: 'Zugriff widerrufen' }).first().click();
			await page.screenshot({ path: `${dir}/mcp-${scheme}-connections.png`, fullPage: true });
			await page.goto('/settings/api-tokens');
			await page.getByRole('button', { name: 'Neues Token' }).click();
			await page.screenshot({ path: `${dir}/mcp-${scheme}-token-form.png`, fullPage: true });
			await page.getByLabel('Name', { exact: true }).fill('Laptop');
			await page.getByRole('button', { name: 'Token erzeugen' }).click();
			await page.getByTestId('token-value').waitFor();
			await page.screenshot({ path: `${dir}/mcp-${scheme}-token-created.png`, fullPage: true });
			await page.goto('/settings/mcp-help');
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${dir}/mcp-${scheme}-help.png`, fullPage: true });
			await context.close();
		});
	}
});
