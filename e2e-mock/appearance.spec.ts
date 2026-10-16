import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, newAuthenticatorContext } from './helpers';

// Package P2: accent and colour scheme belong to the account (ADR-0020), localStorage is the instant-apply cache.
test.describe.configure({ mode: 'serial' });

const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const syncState = (page: Page) => page.getByTestId('appearance-sync');
const preferences = (page: Page) => page.evaluate(async () => (await fetch('/api/v1/me/preferences', { credentials: 'include' })).json());

test('a change is saved to the account, reaches a second browser and survives a cleared cache', async ({ browser }) => {
	const first = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await first.page.goto('/settings/appearance');
	await expect(syncState(first.page)).toHaveAttribute('data-state', 'saved');
	expect(await preferences(first.page)).toEqual({ accent: 'blue', colorScheme: 'system' });

	await first.page.getByTestId('accent-pink').click();
	await expect(syncState(first.page)).toHaveAttribute('data-state', 'saved');
	expect(await cssVar(first.page, '--ui-accent')).toBe('#db2777');
	await first.page.getByTestId('mode-dark').click();
	await first.page.getByTestId('accent-hex').fill('#12ab9f');
	await first.page.getByTestId('accent-apply').click();
	await expect(syncState(first.page)).toHaveAttribute('data-state', 'saved');
	await expect(syncState(first.page)).toContainText('Im Konto gespeichert');
	await expect.poll(async () => (await preferences(first.page)).accentCustomHex).toBe('#12AB9F');
	expect(await preferences(first.page)).toMatchObject({ accent: 'custom', colorScheme: 'dark' });

	// a second browser (no cache at all) gets the account's values from the session
	const second = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	expect(await cssVar(second.page, '--ui-accent')).toBe('#12ab9f');
	await expect(second.page.locator('html')).toHaveClass(/dark/);
	await second.page.goto('/settings/appearance');
	await expect(second.page.getByTestId('accent-current')).toContainText('#12AB9F');
	await expect(second.page.getByTestId('mode-dark')).toHaveAttribute('aria-checked', 'true');

	// the first browser forgets its cache; the reload restores the values from the account
	await first.page.evaluate(() => localStorage.clear());
	await first.page.reload();
	await expect(first.page.getByTestId('accent-current')).toContainText('#12AB9F');
	expect(await cssVar(first.page, '--ui-accent')).toBe('#12ab9f');

	// sign-out keeps the cache for the login screen; signing in again shows the account's values
	await first.page.getByTestId('account-menu').click();
	await first.page.getByRole('button', { name: 'Abmelden' }).click();
	await expect(first.page).toHaveURL(/\/login/);
	expect(await cssVar(first.page, '--ui-accent')).toBe('#12ab9f');
	await expect(first.page.locator('html')).toHaveClass(/dark/);

	// the other browser changes the account while this one is signed out; a new login picks it up
	await second.page.getByTestId('accent-orange').click();
	await expect(syncState(second.page)).toHaveAttribute('data-state', 'saved');
	await first.page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(first.page.getByRole('heading', { name: /^Hallo, / })).toBeVisible();
	expect(await cssVar(first.page, '--ui-accent')).toBe('#d97706');
	await first.context.close();
	await second.context.close();
});

test('an unsent change keeps applying locally and is sent once the connection is back; transparency stays on the device', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/appearance');
	await expect(syncState(page)).toHaveAttribute('data-state', 'saved');
	await page.route('**/api/v1/me/preferences', (route) => (route.request().method() === 'PATCH' ? route.abort() : route.continue()));
	await page.getByTestId('accent-green').click();
	await expect(syncState(page)).toHaveAttribute('data-state', 'pending');
	await expect(syncState(page)).toContainText('Noch nicht im Konto gespeichert');
	expect(await cssVar(page, '--ui-accent')).toBe('#16a34a');
	expect((await preferences(page)).accent).toBe('orange');
	await page.unroute('**/api/v1/me/preferences');

	// the next page load reconciles: the unsent local choice wins and is pushed
	await page.reload();
	await expect(syncState(page)).toHaveAttribute('data-state', 'saved');
	await expect.poll(async () => (await preferences(page)).accent).toBe('green');

	await page.getByTestId('transparency-toggle').check();
	expect((await preferences(page)).accent).toBe('green');
	expect(await page.evaluate(() => JSON.stringify(localStorage.getItem('tt.transparency')))).toBe('"reduced"');
	await page.getByTestId('transparency-toggle').uncheck();

	// restore the defaults for the following specs
	await page.getByTestId('accent-blue').click();
	await page.getByTestId('mode-system').click();
	await expect(syncState(page)).toHaveAttribute('data-state', 'saved');
	expect(await preferences(page)).toMatchObject({ accent: 'blue', colorScheme: 'system' });
	await context.close();
});

test('the login screen uses the cache of the browser', async ({ browser }) => {
	const { page, context } = await newAuthenticatorContext(browser, { viewport: { width: 390, height: 844 } });
	await page.addInitScript(() => {
		localStorage.setItem('tt.accent', '#7c3aed');
		localStorage.setItem('tt.accentId', 'violet');
	});
	await page.goto('/login');
	await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
	expect(await cssVar(page, '--ui-accent')).toBe('#7c3aed');
	await context.close();
});
