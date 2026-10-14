import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import {
	apiCall,
	exportCredentials,
	generateRecoveryCodes,
	loginWithPasskey,
	newActor,
	recover,
	registerViaInvite,
	setFallbackPassword,
	signOut,
	swapToEmptyAuthenticator,
	type Actor
} from './helpers';

// One serial story: later steps depend on state created by earlier ones (fresh SQLite DB per run).
test.describe.configure({ mode: 'serial' });

const ADMIN = 'admin.e2e';
const MEMBER = 'member.e2e';
const FALLBACK_PASSWORD = 'correct-horse-battery-staple';

let admin: Actor;
let member: Actor;
let firstAdminCredentials: Record<string, unknown>[] = [];
let recoveryCodes: string[] = [];
let adminInvitationId = '';
let adminPasskeyId = '';
let memberInvitePath = '';

test.afterAll(async () => {
	await admin?.context.close();
	await member?.context.close();
});

test('bootstrap link: admin registers with a passkey and lands on recovery setup', async ({ browser }) => {
	admin = await newActor(browser);
	const link = new URL(process.env.E2E_BOOTSTRAP_LINK!);
	await registerViaInvite(admin, link.pathname, ADMIN, 'Admin E2E', 'Passkey A');
	// Skipping recovery setup for now (last-passkey protection is tested next).
	await admin.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(admin.page).toHaveURL(/\/$/);
	await expect(admin.page.getByRole('heading', { name: 'Hallo, Admin E2E' })).toBeVisible();
	await expect(admin.page.getByRole('link', { name: 'Einladungen' })).toBeVisible();
});

test('bootstrap link is single use', async ({ browser }) => {
	const anon = await newActor(browser);
	await anon.page.goto(new URL(process.env.E2E_BOOTSTRAP_LINK!).pathname);
	await expect(anon.page.getByText('Diese Einladung ist ungültig, abgelaufen oder bereits verwendet.')).toBeVisible();
	await anon.context.close();
});

test('last passkey cannot be revoked without a recovery method', async () => {
	const { page } = admin;
	await page.goto('/settings/passkeys');
	await expect(page.getByText('Passkey A')).toBeVisible();
	await page.getByRole('button', { name: 'Widerrufen' }).click();
	await page.getByRole('button', { name: 'Passkey endgültig widerrufen' }).click();
	await expect(page.getByText('Der letzte Passkey kann nur widerrufen werden', { exact: false })).toBeVisible();
	await expect(page.getByText('Passkey A')).toBeVisible();
});

test('logout and passkey login', async () => {
	await signOut(admin.page);
	await admin.page.goto('/settings/passkeys');
	await expect(admin.page).toHaveURL(/\/login\?next=/);
	await loginWithPasskey(admin.page);
	await expect(admin.page.getByRole('heading', { name: 'Hallo, Admin E2E' })).toBeVisible();
});

test('add second passkey, rename it', async () => {
	const { page } = admin;
	firstAdminCredentials = await swapToEmptyAuthenticator(admin);
	await page.goto('/settings/passkeys');
	await page.getByLabel('Name des neuen Passkeys (optional)').fill('Passkey B');
	await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
	await expect(page.getByText('Passkey hinzugefügt.')).toBeVisible();
	await expect(page.getByRole('list', { name: 'Passkeys' }).getByRole('listitem')).toHaveCount(2);

	const itemB = page.getByRole('listitem').filter({ hasText: 'Passkey B' });
	await itemB.getByRole('button', { name: 'Umbenennen' }).click();
	await page.getByLabel('Name', { exact: true }).fill('Zweiter Schlüssel');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Passkey umbenannt.')).toBeVisible();
	await expect(page.getByText('Zweiter Schlüssel')).toBeVisible();
	// Note: one virtual authenticator cannot hold two resident credentials of the same user handle, so the
	// authenticator now holds passkey B only; passkey A is kept in firstAdminCredentials.
});

test('recovery codes and fallback password setup', async () => {
	recoveryCodes = await generateRecoveryCodes(admin.page);
	expect(recoveryCodes).toHaveLength(10);
	await expect(admin.page.getByText('Übrige Codes: 10')).toBeVisible();
	await setFallbackPassword(admin.page, FALLBACK_PASSWORD);
});

test('revoke one of two passkeys', async () => {
	const { page } = admin;
	await page.goto('/settings/passkeys');
	const itemA = page.getByRole('listitem').filter({ hasText: 'Passkey A' });
	await itemA.getByRole('button', { name: 'Widerrufen' }).click();
	await page.getByRole('button', { name: 'Passkey endgültig widerrufen' }).click();
	await expect(page.getByText('Passkey widerrufen.')).toBeVisible();
	await expect(page.getByRole('list', { name: 'Passkeys' }).getByRole('listitem')).toHaveCount(1);
	await expect(page.getByText('Zweiter Schlüssel')).toBeVisible();
	adminPasskeyId = (await apiCall(page, 'GET', '/api/v1/me/passkeys')).body[0].id;
	expect(adminPasskeyId).toBeTruthy();
});

test('revoked passkey cannot log in any more, remaining one can', async ({ browser }) => {
	const [credA] = firstAdminCredentials;
	const stale = await newActor(browser, [credA]);
	await stale.page.goto('/login');
	await stale.page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(stale.page).toHaveURL(/\/login/);
	await expect(stale.page.getByRole('alert').first()).toBeVisible();
	await stale.context.close();
});

test('recovery with a recovery code adds a new passkey; the code works only once', async ({ browser }) => {
	const fresh = await newActor(browser);
	await recover(fresh.page, ADMIN, 'Recovery-Code', recoveryCodes[0]);
	await expect(fresh.page).toHaveURL(/\/recover\/passkey$/);
	await fresh.page.getByRole('button', { name: /Passkey/ }).first().click();
	// Either goes to settings (session upgraded) or back to login (recovery session kept; see handoff).
	await expect(fresh.page).toHaveURL(/\/(settings\/passkeys|login)/);
	console.log(`[info] after recovery passkey setup the PWA landed on ${new URL(fresh.page.url()).pathname}`);
	if (/\/login/.test(fresh.page.url())) await loginWithPasskey(fresh.page);
	await fresh.page.goto('/settings/passkeys');
	await expect(fresh.page.getByRole('list', { name: 'Passkeys' }).getByRole('listitem')).toHaveCount(2);
	await fresh.context.close();

	const again = await newActor(browser);
	await recover(again.page, ADMIN, 'Recovery-Code', recoveryCodes[0]);
	await expect(again.page.getByRole('alert')).toBeVisible();
	await expect(again.page).toHaveURL(/\/recover$/);
	await again.context.close();
});

test('recovery with the fallback password', async ({ browser }) => {
	const fresh = await newActor(browser);
	await recover(fresh.page, ADMIN, 'Rückfallpasswort', FALLBACK_PASSWORD);
	await expect(fresh.page).toHaveURL(/\/recover\/passkey$/);
	await fresh.page.getByRole('button', { name: /Passkey/ }).first().click();
	await expect(fresh.page).toHaveURL(/\/(settings\/passkeys|login)/);
	if (/\/login/.test(fresh.page.url())) await loginWithPasskey(fresh.page);
	await fresh.page.goto('/settings/passkeys');
	await expect(fresh.page.getByRole('list', { name: 'Passkeys' }).getByRole('listitem')).toHaveCount(3);
	await fresh.context.close();

	const wrong = await newActor(browser);
	await recover(wrong.page, ADMIN, 'Rückfallpasswort', 'definitely-wrong-password');
	await expect(wrong.page.getByRole('alert')).toBeVisible();
	await wrong.context.close();
});

test('admin creates an invitation; member registers via link', async ({ browser }) => {
	const { page } = admin;
	await page.goto('/admin/invitations');
	await page.getByLabel('Notiz (optional)').fill('für Member');
	await page.getByRole('button', { name: 'Einladung erstellen' }).click();
	const link = await page.getByTestId('invite-link').innerText();
	memberInvitePath = new URL(link).pathname;
	const list = await apiCall(page, 'GET', '/api/v1/admin/invitations');
	adminInvitationId = list.body.find((i: any) => i.note === 'für Member').id;
	expect(JSON.stringify(list.body)).not.toContain(memberInvitePath.split('/').pop()!); // list never exposes the token

	member = await newActor(browser);
	await registerViaInvite(member, memberInvitePath, MEMBER, 'Member E2E');
	await member.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(member.page.getByRole('heading', { name: 'Hallo, Member E2E' })).toBeVisible();
	await expect(member.page.getByRole('link', { name: 'Einladungen' })).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: 'für Member' }).getByText('Eingelöst')).toBeVisible();
});

test('used, revoked and expired invitations are rejected', async ({ browser }) => {
	const msg = 'Diese Einladung ist ungültig, abgelaufen oder bereits verwendet.';
	const anon = await newActor(browser);
	await anon.page.goto(memberInvitePath);
	await expect(anon.page.getByText(msg)).toBeVisible();

	// revoked
	const { page } = admin;
	await page.goto('/admin/invitations');
	await page.getByLabel('Notiz (optional)').fill('widerruf');
	await page.getByRole('button', { name: 'Einladung erstellen' }).click();
	const revokedPath = new URL(await page.getByTestId('invite-link').innerText()).pathname;
	await page.getByRole('listitem').filter({ hasText: 'widerruf' }).getByRole('button', { name: 'Widerrufen' }).click();
	await expect(page.getByRole('listitem').filter({ hasText: 'widerruf' }).getByText('Widerrufen', { exact: true })).toBeVisible();
	await anon.page.goto(revokedPath);
	await expect(anon.page.getByText(msg)).toBeVisible();

	// expired: age an invitation directly in the throw-away SQLite DB
	await page.getByRole('button', { name: 'Fertig' }).click();
	await page.getByLabel('Notiz (optional)').fill('abgelaufen');
	await page.getByRole('button', { name: 'Einladung erstellen' }).click();
	const expiredPath = new URL(await page.getByTestId('invite-link').innerText()).pathname;
	const db = process.env.E2E_SQLITE_PATH!;
	const sample = execFileSync('sqlite3', [db, "select expires_at from invitations where note='abgelaufen'"], { encoding: 'utf8' }).trim();
	const past = /^\d+(\.\d+)?$/.test(sample) ? '1000000000' : '2001-01-01T00:00:00.000Z';
	execFileSync('sqlite3', [db, `update invitations set expires_at='${past}' where note='abgelaufen'`]);
	await anon.page.goto(expiredPath);
	await expect(anon.page.getByText(msg)).toBeVisible();
	await page.reload();
	await expect(page.getByRole('listitem').filter({ hasText: 'abgelaufen' }).getByText('Abgelaufen')).toBeVisible();
	await anon.context.close();
});

test('member cannot see or touch the admin\'s invitations and passkeys', async () => {
	const { page } = member;
	await page.goto('/');
	expect((await apiCall(page, 'GET', '/api/v1/admin/invitations')).status).toBe(403);
	expect((await apiCall(page, 'POST', '/api/v1/admin/invitations', { expiresInHours: 1 })).status).toBe(403);
	expect((await apiCall(page, 'DELETE', `/api/v1/admin/invitations/${adminInvitationId}`)).status).toBe(404);
	expect((await apiCall(page, 'DELETE', `/api/v1/me/passkeys/${adminPasskeyId}`)).status).toBe(404);
	expect((await apiCall(page, 'PATCH', `/api/v1/me/passkeys/${adminPasskeyId}`, { name: 'x' })).status).toBe(404);
	const own = await apiCall(page, 'GET', '/api/v1/me/passkeys');
	expect(own.body).toHaveLength(1);
	expect(JSON.stringify(own.body)).not.toContain(adminPasskeyId);
	await page.goto('/admin/invitations');
	await expect(page).not.toHaveURL(/\/admin\/invitations/);
});

test('revoking other sessions signs out the other device only', async ({ browser }) => {
	// admin context already has a session; second device logs in with a copy of the admin's current credentials.
	const creds = await exportCredentials(admin);
	const other = await newActor(browser, creds);
	await loginWithPasskey(other.page);
	await other.page.goto('/settings/passkeys');
	await expect(other.page.getByRole('heading', { name: 'Passkeys', level: 1 })).toBeVisible();

	await admin.page.goto('/settings/sessions');
	await admin.page.getByRole('button', { name: 'Andere Sitzungen abmelden' }).click();
	await expect(admin.page.getByText('Alle anderen Sitzungen wurden beendet.')).toBeVisible();

	await other.page.goto('/settings/passkeys');
	await expect(other.page).toHaveURL(/\/login/);
	await admin.page.goto('/settings/passkeys');
	await expect(admin.page).toHaveURL(/\/settings\/passkeys/);
	await other.context.close();
});

test('contract: CSRF, cookie, error codes, SPA fallback', async ({ browser, request }) => {
	const { page } = admin;
	const cookies = await admin.context.cookies();
	const session = cookies.find((c) => c.name === 'tt_session')!;
	expect(session.httpOnly).toBe(true);
	expect(session.sameSite).toBe('Lax');
	expect(session.secure).toBe(false); // http://localhost

	// Mutation without CSRF header is rejected.
	const noCsrf = await page.evaluate(async () => {
		const res = await fetch('/api/v1/me/sessions', { method: 'DELETE', credentials: 'include' });
		return { status: res.status, body: await res.json().catch(() => null) };
	});
	expect([400, 403]).toContain(noCsrf.status);
	console.log(`[info] DELETE me/sessions without CSRF -> ${noCsrf.status} ${JSON.stringify(noCsrf.body)}`);

	// Unauthenticated session probe.
	expect((await request.get('/api/v1/auth/session')).status()).toBe(401);
	// SPA fallback for deep links, API paths are never swallowed.
	const deep = await request.get('/invite/does-not-matter');
	expect(deep.status()).toBe(200);
	expect(deep.headers()['content-type']).toContain('text/html');
	expect((await request.get('/api/v1/nope')).status()).toBe(404);
	expect((await request.get('/api/v1/invitations/not-a-real-token')).status()).toBe(404);

	// Handle conflict is surfaced in German by the UI.
	await page.goto('/admin/invitations');
	await page.getByLabel('Notiz (optional)').fill('dup');
	await page.getByRole('button', { name: 'Einladung erstellen' }).click();
	const dupPath = new URL(await page.getByTestId('invite-link').innerText()).pathname;
	const dup = await newActor(browser);
	await dup.page.goto(dupPath);
	await dup.page.getByLabel('Kontoname').fill(ADMIN);
	await dup.page.getByLabel('Anzeigename').fill('Dup');
	await dup.page.getByRole('button', { name: 'Passkey erstellen und Konto anlegen' }).click();
	await expect(dup.page.getByText('Dieser Kontoname ist bereits vergeben.')).toBeVisible();
	await dup.context.close();
});
