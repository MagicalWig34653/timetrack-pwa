import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiCall as api, exportCredentials, loginWithPasskey, newActor as baseActor, registerViaInvite, signOut, type Actor } from './helpers';

// Package P2: accent and colour scheme are stored per account (ADR-0020, contract v0.14.0) against the real backend.
test.describe.configure({ mode: 'serial' });

const BASE = process.env.E2E_APPEARANCE_BASE_URL ?? `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 14}`;
test.use({ baseURL: BASE });

const newActor = (browser: Browser, credentials: Record<string, unknown>[] = []) => baseActor(browser, credentials, BASE);
const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const syncSaved = (page: Page) => expect(page.getByTestId('appearance-sync')).toHaveAttribute('data-state', 'saved');
const preferences = async (page: Page) => (await api(page, 'GET', '/api/v1/me/preferences')).body;

let alice: Actor;
let bob: Actor;

async function register(browser: Browser, invite: string, handle: string, name: string): Promise<Actor> {
	const actor = await newActor(browser);
	await registerViaInvite(actor, invite, handle, name, 'Passkey');
	await actor.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(actor.page.getByRole('heading', { name: `Hallo, ${name}` })).toBeVisible();
	return actor;
}

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
});

test('setup: new accounts have the defaults, in the preferences endpoint and in the session', async ({ browser }) => {
	alice = await register(browser, new URL(process.env.E2E_APPEARANCE_BOOTSTRAP_LINK!).pathname, 'alice.look', 'Alice Look');
	const invite = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	bob = await register(browser, `/invite/${invite.body.token}`, 'bob.look', 'Bob Look');
	for (const actor of [alice, bob]) {
		expect(await preferences(actor.page)).toEqual({ accent: 'blue', colorScheme: 'system', glow: 'subtle' });
		expect((await api(actor.page, 'GET', '/api/v1/auth/session')).body.account.preferences).toEqual({ accent: 'blue', colorScheme: 'system', glow: 'subtle' });
	}
});

test('Darstellung saves accent and scheme to the account; the API enforces the rules', async () => {
	const page = alice.page;
	await page.goto('/settings/appearance');
	await syncSaved(page);
	await page.getByTestId('accent-teal').click();
	await syncSaved(page);
	await expect.poll(async () => (await preferences(page)).accent).toBe('teal');
	await page.getByTestId('mode-dark').click();
	await syncSaved(page);
	await expect.poll(async () => (await preferences(page)).colorScheme).toBe('dark');
	await page.getByTestId('accent-hex').fill('#12ab9f');
	await page.getByTestId('accent-apply').click();
	await syncSaved(page);
	await expect.poll(async () => (await preferences(page)).accentCustomHex).toBe('#12AB9F');
	expect(await preferences(page)).toMatchObject({ accent: 'custom', colorScheme: 'dark' });
	expect((await preferences(page)).updatedAt).toBeTruthy();
	await page.screenshot({ path: process.env.P2_SHOTS ? `${process.env.P2_SHOTS}/real-appearance-dark.png` : undefined, fullPage: true });

	// strict validation on the server
	for (const body of [{}, { accent: 'red' }, { colorScheme: 'auto' }, { theme: 'x' }, { accentCustomHex: '#12345' }, { accent: 'custom', accentCustomHex: '#12345' }, { accent: 'blue', accentCustomHex: '#112233' }]) {
		expect((await api(page, 'PATCH', '/api/v1/me/preferences', body)).status, JSON.stringify(body)).toBe(400);
	}
	expect((await api(page, 'PATCH', '/api/v1/me/preferences', { accent: 'blue', pad: 'x'.repeat(2000) })).status).toBe(413);
	expect(await preferences(page)).toMatchObject({ accent: 'custom', accentCustomHex: '#12AB9F', colorScheme: 'dark' });
	// the other account is untouched
	expect(await preferences(bob.page)).toEqual({ accent: 'blue', colorScheme: 'system', glow: 'subtle' });
	expect(await cssVar(bob.page, '--ui-accent')).toBe('#2563eb');
});

test('the choice persists across logout and login with an empty cache, and shows in a second browser context', async ({ browser }) => {
	const page = alice.page;
	await signOut(page);
	// the login screen still uses the browser cache; after clearing it the next login restores the account's values
	expect(await cssVar(page, '--ui-accent')).toBe('#12ab9f');
	await page.evaluate(() => localStorage.clear());
	await loginWithPasskey(page);
	await expect.poll(() => cssVar(page, '--ui-accent')).toBe('#12ab9f');
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.goto('/settings/appearance');
	await expect(page.getByTestId('accent-current')).toContainText('#12AB9F');
	await expect(page.getByTestId('mode-dark')).toHaveAttribute('aria-checked', 'true');

	// second context = another device with the same passkey and no cache
	const other = await newActor(browser, await exportCredentials(alice));
	await loginWithPasskey(other.page);
	await expect.poll(() => cssVar(other.page, '--ui-accent')).toBe('#12ab9f');
	await expect(other.page.locator('html')).toHaveClass(/dark/);
	// a change on the second device reaches the first one when its page is opened again
	await other.page.goto('/settings/appearance');
	await syncSaved(other.page);
	await other.page.getByTestId('accent-orange').click();
	await syncSaved(other.page);
	await page.reload();
	await syncSaved(page);
	await expect(page.getByTestId('accent-orange')).toHaveAttribute('aria-checked', 'true');
	expect(await cssVar(page, '--ui-accent')).toBe('#d97706');
	await other.page.getByTestId('mode-system').click();
	await syncSaved(other.page);
	await page.screenshot({ path: process.env.P2_SHOTS ? `${process.env.P2_SHOTS}/real-appearance-after-sync.png` : undefined, fullPage: true });
	await other.context.close();
});

test('the preferences are part of the account export', async () => {
	const response = await alice.page.evaluate(async () => {
		const res = await fetch('/api/v1/me/export', { credentials: 'include' });
		const bytes = new Uint8Array(await res.arrayBuffer());
		return { status: res.status, text: new TextDecoder('latin1').decode(bytes) };
	});
	expect(response.status).toBe(200);
	// ZIP entries are stored with their names in clear text in the headers
	expect(response.text).toContain('preferences.json');
});

test('G1: the glow level and the new white-text presets are stored in the account and survive an empty cache', async () => {
	const page = alice.page;
	await page.goto('/settings/appearance');
	await syncSaved(page);
	await page.getByTestId('glow-strong').click();
	await syncSaved(page);
	await expect.poll(async () => (await preferences(page)).glow).toBe('strong');
	await page.getByTestId('accent-crimson').click();
	await syncSaved(page);
	expect(await preferences(page)).toMatchObject({ accent: 'crimson', glow: 'strong' });
	expect((await preferences(page)).accentCustomHex ?? null).toBeNull();
	await expect.poll(() => cssVar(page, '--ui-accent-foreground')).toBe('#ffffff');

	// the blur is applied to the floating surfaces in the real app as well
	await page.getByTestId('appearance-menu').click();
	expect(await page.evaluate(() => getComputedStyle(document.querySelector('[role=dialog][aria-label="Darstellung und Akzentfarbe"]')!).backdropFilter)).toContain('blur');
	expect(await page.evaluate(() => getComputedStyle(document.querySelector('.app-sheet')!).backdropFilter)).toContain('blur');
	await page.keyboard.press('Escape');

	// strict validation of the new key
	for (const body of [{ glow: 'bright' }, { glow: 2 }, { glow: null }, { glow: 'STRONG' }]) {
		expect((await api(page, 'PATCH', '/api/v1/me/preferences', body)).status, JSON.stringify(body)).toBe(400);
	}
	expect((await preferences(page)).glow).toBe('strong');

	// an empty cache (new device, cleared storage): the next session load brings the values back from the account
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await expect.poll(() => page.evaluate(() => document.documentElement.dataset.glow)).toBe('strong');
	await expect.poll(() => cssVar(page, '--ui-accent')).toBe('#b91c1c');
	expect((await preferences(bob.page)).glow).toBe('subtle');
});
