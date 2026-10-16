import { expect, test, type Browser, type Page } from '@playwright/test';
import { unzip } from './files';
import { apiCall as api, loginWithPasskey, newActor as baseActor, registerViaInvite, type Actor } from './helpers';

// Package L23: account administration, data export and self-deletion (ADR-0016, contract v0.11.0) against the real Swift backend.
// One serial story on an eleventh backend instance (E2E_ACCOUNTS_PORT, own SQLite DB). Alice is the bootstrap admin, Bob and
// Carol are members invited by her. The freshness window (10 minutes) is never exceeded, so reauth_required is covered by the mock specs.
test.describe.configure({ mode: 'serial' });

const BASE = `http://localhost:${Number(process.env.E2E_ACCOUNTS_PORT ?? Number(process.env.E2E_PORT ?? 18090) + 10)}`;
test.use({ baseURL: BASE });
const newActor = (browser: Browser) => baseActor(browser, [], BASE);

let alice: Actor;
let bob: Actor;
let carol: Actor;
const ids: { alice?: string; bob?: string; carol?: string } = {};

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
	await carol?.context.close();
});

const row = (page: Page, handle: string) => page.locator(`[data-testid="account-row"][data-handle="${handle}"]`);

async function register(browser: Browser, invite: string, handle: string, name: string): Promise<Actor> {
	const actor = await newActor(browser);
	await registerViaInvite(actor, invite, handle, name, 'Passkey');
	await actor.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(actor.page.getByRole('heading', { name: `Hallo, ${name}` })).toBeVisible();
	return actor;
}

test('setup: Alice (bootstrap admin) invites Bob and Carol', async ({ browser }) => {
	alice = await register(browser, new URL(process.env.E2E_ACCOUNTS_BOOTSTRAP_LINK!).pathname, 'alice.acc', 'Alice Konten');
	const inviteBob = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	bob = await register(browser, `/invite/${inviteBob.body.token}`, 'bob.acc', 'Bob Konten');
	const inviteCarol = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Carol' });
	carol = await register(browser, `/invite/${inviteCarol.body.token}`, 'carol.acc', 'Carol Konten');
});

test('admin lists the accounts: identity, role, state, activity and passkeys, nothing private', async () => {
	await alice.page.goto('/admin/accounts');
	await expect(alice.page.getByTestId('accounts-count')).toHaveText('3 Konten');
	await expect(row(alice.page, 'alice.acc')).toContainText('Du');
	await expect(row(alice.page, 'alice.acc')).toContainText('Administrator');
	await expect(row(alice.page, 'alice.acc').getByTestId('act-delete')).toHaveCount(0);
	await expect(row(alice.page, 'bob.acc')).toContainText('Mitglied');
	await expect(row(alice.page, 'bob.acc')).toContainText('Aktiv');
	await expect(row(alice.page, 'bob.acc')).toContainText('1 Passkey');

	const list = await api(alice.page, 'GET', '/api/v1/admin/accounts?limit=50&offset=0');
	expect(list.status).toBe(200);
	expect(list.body.total).toBe(3);
	for (const account of list.body.items) {
		expect(Object.keys(account).sort()).toEqual(expect.arrayContaining(['createdAt', 'displayName', 'handle', 'id', 'passkeyCount', 'role', 'state']));
		expect(JSON.stringify(account)).not.toMatch(/credential|token|hash|segment/i);
	}
	ids.alice = list.body.items.find((a: any) => a.handle === 'alice.acc').id;
	ids.bob = list.body.items.find((a: any) => a.handle === 'bob.acc').id;
	ids.carol = list.body.items.find((a: any) => a.handle === 'carol.acc').id;
	// members are refused
	expect((await api(bob.page, 'GET', '/api/v1/admin/accounts')).status).toBe(403);
});

test('a member does not see the accounts entry and cannot open the page content', async () => {
	await bob.page.goto('/');
	await expect(bob.page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Konten' })).toHaveCount(0);
	await bob.page.goto('/admin/accounts');
	await expect(bob.page).not.toHaveURL(/\/admin\/accounts$/);
});

test('disabling Bob ends his session and blocks the passkey login; reactivating allows it again', async () => {
	await alice.page.goto('/admin/accounts');
	await row(alice.page, 'bob.acc').getByTestId('act-disable').click();
	await alice.page.getByRole('dialog').getByTestId('confirm-submit').click();
	await expect(alice.page.getByTestId('accounts-notice')).toContainText('Konto „bob.acc“ ist deaktiviert.');
	await expect(row(alice.page, 'bob.acc')).toContainText('Deaktiviert');
	expect((await api(bob.page, 'GET', '/api/v1/me/passkeys')).status).toBe(401);

	await bob.page.goto('/login');
	await bob.page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(bob.page.getByText('Du bist nicht angemeldet oder der Nachweis ist ungültig.')).toBeVisible();
	await expect(bob.page).toHaveURL(/\/login/);

	await row(alice.page, 'bob.acc').getByTestId('act-reactivate').click();
	await expect(row(alice.page, 'bob.acc')).toContainText('Aktiv');
	await loginWithPasskey(bob.page);
	await expect(bob.page.getByRole('heading', { name: 'Hallo, Bob Konten' })).toBeVisible();
});

test('role change: promote and demote Bob; the administrator cannot change the own role', async () => {
	await alice.page.goto('/admin/accounts');
	await row(alice.page, 'bob.acc').getByTestId('act-role').click();
	await expect(alice.page.getByRole('dialog')).toContainText('zum Administrator machen?');
	await alice.page.getByRole('dialog').getByTestId('confirm-submit').click();
	await expect(row(alice.page, 'bob.acc')).toHaveAttribute('data-role', 'admin');
	await expect(alice.page.getByTestId('accounts-notice')).toContainText('Rolle von „bob.acc“ ist jetzt: Administrator.');
	// the new admin passes the admin check straight away
	expect((await api(bob.page, 'GET', '/api/v1/admin/accounts')).status).toBe(200);

	// the own account is protected by the server as well, whatever the UI shows
	const self = await api(alice.page, 'PATCH', `/api/v1/admin/accounts/${ids.alice}`, { role: 'member' });
	expect(self.status).toBe(409);
	expect(self.body.error.code).toBe('self_lockout');
	// deleting the own account as the only admin reports last_admin (see the next story step) and the admin path refuses self-deletion
	const selfDelete = await api(alice.page, 'DELETE', `/api/v1/admin/accounts/${ids.alice}`, { confirmHandle: 'alice.acc' });
	expect([selfDelete.status, selfDelete.body.error.code]).toEqual([409, 'self_lockout']);

	await row(alice.page, 'bob.acc').getByTestId('act-role').click();
	await alice.page.getByRole('dialog').getByTestId('confirm-submit').click();
	await expect(row(alice.page, 'bob.acc')).toHaveAttribute('data-role', 'member');
	expect((await api(bob.page, 'GET', '/api/v1/admin/accounts')).status).toBe(403);
});

test('the only administrator cannot delete the own account (last_admin message)', async () => {
	await alice.page.goto('/settings/privacy');
	await alice.page.getByTestId('delete-open').click();
	const dialog = alice.page.getByRole('dialog');
	await dialog.getByLabel(/Benutzernamen „alice.acc“/).fill('alice.acc');
	await dialog.getByTestId('confirm-submit').click();
	await expect(dialog.getByTestId('confirm-error')).toContainText('letzte aktive Administrator');
	await expect(alice.page).toHaveURL(/\/settings\/privacy$/);
	// still signed in, the account exists
	expect((await api(alice.page, 'GET', '/api/v1/auth/session')).status).toBe(200);
	await dialog.getByRole('button', { name: 'Abbrechen' }).click();
});

test('revoking the sessions of Bob logs him out', async () => {
	await alice.page.goto('/admin/accounts');
	await row(alice.page, 'bob.acc').getByTestId('act-sessions').click();
	await alice.page.getByRole('dialog').getByTestId('confirm-submit').click();
	await expect(alice.page.getByTestId('accounts-notice')).toContainText('Die Sitzungen von „bob.acc“ sind beendet.');
	expect((await api(bob.page, 'GET', '/api/v1/auth/session')).status).toBe(401);
});

test('deleting Bob needs the typed handle; afterwards the account is gone and cannot sign in', async () => {
	await alice.page.goto('/admin/accounts');
	await row(alice.page, 'bob.acc').getByTestId('act-delete').click();
	const dialog = alice.page.getByRole('dialog');
	const submit = dialog.getByTestId('confirm-submit');
	await expect(dialog).toContainText('Konto „bob.acc“ endgültig löschen?');
	await expect(submit).toBeDisabled();
	await dialog.getByLabel(/Benutzernamen „bob.acc“/).fill('bob.ac');
	await expect(submit).toBeDisabled();
	await dialog.getByLabel(/Benutzernamen „bob.acc“/).fill('bob.acc');
	await submit.click();
	await expect(alice.page.getByTestId('accounts-notice')).toContainText('Konto „bob.acc“ wurde gelöscht.');
	await expect(row(alice.page, 'bob.acc')).toHaveCount(0);
	await expect(alice.page.getByTestId('accounts-count')).toHaveText('2 Konten');
	expect((await api(alice.page, 'DELETE', `/api/v1/admin/accounts/${ids.bob}`, { confirmHandle: 'bob.acc' })).status).toBe(404);

	await bob.page.goto('/login');
	await bob.page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(bob.page.getByText('Du bist nicht angemeldet oder der Nachweis ist ungültig.')).toBeVisible();
});

test('Carol downloads her data: a ZIP with a manifest and her account, without secrets', async () => {
	await carol.page.goto('/settings/privacy');
	const [download] = await Promise.all([carol.page.waitForEvent('download'), carol.page.getByTestId('export-button').click()]);
	expect(download.suggestedFilename()).toMatch(/\.zip$/);
	const path = await download.path();
	const fs = await import('node:fs');
	const entries = unzip(fs.readFileSync(path!));
	const names = [...entries.keys()];
	expect(names).toEqual(expect.arrayContaining(['manifest.json', 'account.json']));
	const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'));
	expect(typeof manifest).toBe('object');
	const account = entries.get('account.json')!.toString('utf8');
	expect(account).toContain('carol.acc');
	for (const [name, content] of entries) {
		expect(content.toString('utf8'), name).not.toContain('bob.acc');
	}
	await expect(carol.page.getByTestId('export-done')).toContainText(download.suggestedFilename());
});

test('Carol deletes her own account: typed handle, goodbye on the login page, session and sign-in gone', async () => {
	await carol.page.goto('/settings/privacy');
	await carol.page.getByTestId('delete-open').click();
	const dialog = carol.page.getByRole('dialog');
	await expect(dialog).toContainText('Folgendes wird unwiderruflich gelöscht');
	await expect(dialog.getByTestId('confirm-submit')).toBeDisabled();
	await dialog.getByLabel(/Benutzernamen „carol.acc“/).fill('carol.acc');
	await dialog.getByTestId('confirm-submit').click();
	await expect(carol.page).toHaveURL(/\/login\?deleted=1/);
	await expect(carol.page.getByTestId('login-deleted')).toContainText('Auf Wiedersehen');
	expect((await carol.page.request.get('/api/v1/auth/session')).status()).toBe(401);
	const cookies = (await carol.context.cookies()).filter((c) => c.name.toLowerCase().includes('session'));
	expect(cookies.filter((c) => c.value !== '')).toHaveLength(0);

	await carol.page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(carol.page.getByText('Du bist nicht angemeldet oder der Nachweis ist ungültig.')).toBeVisible();

	await alice.page.goto('/admin/accounts');
	await expect(alice.page.getByTestId('accounts-count')).toHaveText('1 Konto');
	await expect(row(alice.page, 'carol.acc')).toHaveCount(0);
});
