import net from 'node:net';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiCall as api, newActor as baseActor, registerViaInvite, type Actor } from './helpers';

// Package P1: profile editing, e-mail change by code and the guided setup (ADR-0019, contract v0.13.0) against the real backend.
// Two instances: one with SMTP (a tiny capturing SMTP server runs inside this spec) and one without any mail transport.
test.describe.configure({ mode: 'serial' });

const basePort = Number(process.env.E2E_PORT ?? 18090);
const BASE = process.env.E2E_PROFILE_BASE_URL ?? `http://localhost:${basePort + 11}`;
const NOMAIL = process.env.E2E_PROFILE_NOMAIL_BASE_URL ?? `http://localhost:${basePort + 12}`;
const SMTP_PORT = Number(process.env.E2E_PROFILE_SMTP_PORT ?? basePort + 13);
test.use({ baseURL: BASE });

/** Minimal SMTP receiver: keeps the mailed codes. The backend only talks to it with TLS off and without authentication. */
const mails: { to: string; body: string }[] = [];
let smtp: net.Server;

function startSmtp(): Promise<void> {
	smtp = net.createServer((socket) => {
		let data = false;
		let buffer = '';
		let to = '';
		let body = '';
		socket.write('220 test ESMTP\r\n');
		socket.on('data', (chunk) => {
			buffer += chunk.toString('utf8');
			for (;;) {
				if (data) {
					const end = buffer.indexOf('\r\n.\r\n');
					if (end < 0) return;
					body = buffer.slice(0, end);
					buffer = buffer.slice(end + 5);
					data = false;
					mails.push({ to, body });
					socket.write('250 queued\r\n');
					continue;
				}
				const eol = buffer.indexOf('\r\n');
				if (eol < 0) return;
				const line = buffer.slice(0, eol);
				buffer = buffer.slice(eol + 2);
				const upper = line.toUpperCase();
				if (upper.startsWith('EHLO') || upper.startsWith('HELO')) socket.write('250 test\r\n');
				else if (upper.startsWith('MAIL')) socket.write('250 ok\r\n');
				else if (upper.startsWith('RCPT')) {
					to = /<([^>]+)>/.exec(line)?.[1] ?? '';
					socket.write('250 ok\r\n');
				} else if (upper === 'DATA') {
					data = true;
					socket.write('354 go\r\n');
				} else if (upper === 'QUIT') {
					socket.write('221 bye\r\n');
					socket.end();
				} else socket.write('250 ok\r\n');
			}
		});
		socket.on('error', () => undefined);
	});
	return new Promise((resolve, reject) => {
		smtp.once('error', reject);
		smtp.listen(SMTP_PORT, '127.0.0.1', () => resolve());
	});
}

/** The code is the only 16-character token of the mail body (12 random bytes as base64url). */
async function codeFor(address: string, after = 0): Promise<string> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const mail = mails.slice(after).reverse().find((m) => m.to === address);
		if (mail) {
			const body = mail.body.slice(mail.body.indexOf('\r\n\r\n') + 4).replace(/=\r\n/g, '');
			const code = /(?:^|[\s:])([A-Za-z0-9_-]{16})(?=\s|$)/m.exec(body)?.[1];
			if (code) return code;
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error('no code mailed to ' + address);
}

const newActor = (browser: Browser, base = BASE) => baseActor(browser, [], base);
let alice: Actor;
let bob: Actor;
let loner: Actor;

test.beforeAll(async () => {
	await startSmtp();
});
test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
	await loner?.context.close();
	await new Promise((resolve) => smtp?.close(resolve));
});

async function register(browser: Browser, invite: string, handle: string, name: string, base = BASE): Promise<Actor> {
	const actor = await newActor(browser, base);
	await registerViaInvite(actor, invite, handle, name, 'Passkey');
	await actor.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(actor.page.getByRole('heading', { name: `Hallo, ${name}` })).toBeVisible();
	return actor;
}
const profile = async (page: Page) => (await api(page, 'GET', '/api/v1/me/profile')).body;

test('setup: Alice (bootstrap admin) and Bob are offered the guided setup; the account menu keeps working', async ({ browser }) => {
	alice = await register(browser, new URL(process.env.E2E_PROFILE_BOOTSTRAP_LINK!).pathname, 'alice.pro', 'Alice Profil');
	const invite = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	bob = await register(browser, `/invite/${invite.body.token}`, 'bob.pro', 'Bob Profil');
	for (const actor of [alice, bob]) {
		await expect(actor.page.getByTestId('setup-banner')).toContainText('Richte dein Konto');
		expect((await profile(actor.page)).onboarding.state).toBe('pending');
		expect((await api(actor.page, 'GET', '/api/v1/auth/session')).body.account.onboardingState).toBe('pending');
	}
});

test('profile: rename persists, the handle is read-only, other accounts are untouched', async () => {
	await alice.page.goto('/settings/profile');
	await expect(alice.page.getByTestId('settings-tabs').getByRole('link', { name: 'Profil' })).toHaveAttribute('aria-current', 'page');
	await expect(alice.page.getByLabel('Kontoname')).toHaveValue('alice.pro');
	await expect(alice.page.getByLabel('Kontoname')).toHaveAttribute('readonly', '');
	await alice.page.getByLabel('Anzeigename').fill('Alice Neu');
	await alice.page.getByRole('button', { name: 'Speichern' }).click();
	await expect(alice.page.getByTestId('name-notice')).toBeVisible();
	await alice.page.reload();
	await expect(alice.page.getByLabel('Anzeigename')).toHaveValue('Alice Neu');
	expect((await profile(alice.page)).displayName).toBe('Alice Neu');
	expect((await profile(bob.page)).displayName).toBe('Bob Profil');
	// the API refuses empty names and ignores any attempt to change the handle
	expect((await api(alice.page, 'PATCH', '/api/v1/me/profile', { displayName: '  ' })).status).toBe(400);
	expect((await api(alice.page, 'PATCH', '/api/v1/me/profile', { displayName: 'Alice Neu', handle: 'mallory' })).status).toBe(200);
	expect((await profile(alice.page)).handle).toBe('alice.pro');
	// not signed in: no profile
	const anonymous = await alice.page.context().browser()!.newContext({ baseURL: BASE });
	expect((await anonymous.request.get('/api/v1/me/profile')).status()).toBe(401);
	await anonymous.close();
});

test('e-mail: change only after the mailed code, wrong code refused, then verified', async () => {
	await alice.page.goto('/settings/profile');
	await expect(alice.page.getByTestId('email-none')).toBeVisible();
	await alice.page.getByTestId('email-edit').click();
	await alice.page.getByLabel('Neue E-Mail-Adresse').fill('Alice@Example.test');
	await alice.page.getByRole('button', { name: 'Code senden' }).click();
	const pending = alice.page.getByTestId('email-pending');
	await expect(pending).toContainText('alice@example.test');
	expect((await profile(alice.page)).email ?? null).toBeNull();
	expect((await profile(alice.page)).pendingEmail).toBe('alice@example.test');
	await pending.getByLabel('Bestätigungscode').fill('falschfalschfalsch');
	await pending.getByRole('button', { name: 'Bestätigen' }).click();
	await expect(alice.page.getByTestId('email-error')).toBeVisible();
	await pending.getByLabel('Bestätigungscode').fill(await codeFor('alice@example.test'));
	await pending.getByRole('button', { name: 'Bestätigen' }).click();
	await expect(alice.page.getByTestId('email-current')).toContainText('alice@example.test');
	await expect(alice.page.getByTestId('email-current')).toContainText('Bestätigt');
	const after = await profile(alice.page);
	expect(after.email).toBe('alice@example.test');
	expect(after.emailVerified).toBe(true);
	expect(after.mailAvailable).toBe(true);
	expect((await profile(bob.page)).email ?? null).toBeNull();
});

test('e-mail uniqueness: a verified address cannot be taken (409), and two simultaneous confirmations have exactly one winner', async () => {
	// Bob tries Alice's address through the UI
	await bob.page.goto('/settings/profile');
	await bob.page.getByTestId('email-edit').click();
	await bob.page.getByLabel('Neue E-Mail-Adresse').fill('alice@example.test');
	const mailed = mails.length;
	await bob.page.getByRole('button', { name: 'Code senden' }).click();
	const pending = bob.page.getByTestId('email-pending');
	await pending.getByLabel('Bestätigungscode').fill(await codeFor('alice@example.test', mailed));
	await pending.getByRole('button', { name: 'Bestätigen' }).click();
	await expect(bob.page.getByTestId('email-error')).toContainText('bereits von einem anderen Konto');
	await expect(bob.page.getByTestId('email-none')).toBeVisible();
	expect((await profile(bob.page)).email ?? null).toBeNull();
	expect((await profile(alice.page)).email).toBe('alice@example.test');

	// Alice frees the address, then both request the same new one and confirm at the same moment
	await alice.page.goto('/settings/profile');
	await alice.page.getByTestId('email-remove').click();
	await alice.page.getByTestId('email-remove-confirm').click();
	await expect(alice.page.getByTestId('email-none')).toBeVisible();
	expect((await profile(alice.page)).email ?? null).toBeNull();
	const first = mails.length;
	expect((await api(alice.page, 'PUT', '/api/v1/me/profile/email', { email: 'race@example.test' })).status).toBe(202);
	const aliceCode = await codeFor('race@example.test', first);
	const second = mails.length;
	expect((await api(bob.page, 'PUT', '/api/v1/me/profile/email', { email: 'race@example.test' })).status).toBe(202);
	const bobCode = await codeFor('race@example.test', second);
	expect(bobCode).not.toBe(aliceCode);
	const results = await Promise.all([
		api(alice.page, 'POST', '/api/v1/me/profile/email/verify', { code: aliceCode }),
		api(bob.page, 'POST', '/api/v1/me/profile/email/verify', { code: bobCode })
	]);
	expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
	const owners = [(await profile(alice.page)).email, (await profile(bob.page)).email].filter((e) => e === 'race@example.test');
	expect(owners).toHaveLength(1);
});

test('guided setup as Bob: suggestions are visible, nothing is stored before the end, then it is not offered again', async () => {
	const page = bob.page;
	const models = async () => (await api(page, 'GET', '/api/v1/work-models')).body as any[];
	expect(await models()).toHaveLength(0);
	await page.goto('/');
	await page.getByRole('link', { name: 'Einrichtung starten' }).click();
	await expect(page).toHaveURL(/\/onboarding$/);
	await expect(page.getByLabel('Wochenstunden')).toHaveValue('38:30');
	await expect(page.getByLabel(/Rundung zugunsten/)).toBeChecked();
	await page.getByLabel('Wochenstunden').fill('40:00');
	await expect(page.getByTestId('daily-target')).toContainText('8:00');
	await page.getByTestId('onboarding-next').click();
	await expect(page.getByTestId('step-breaks')).toContainText('Kein festes Pausenfenster');
	await page.getByTestId('onboarding-next').click();
	await page.getByTestId('onboarding-next').click();
	await expect(page.getByLabel('Urlaubstage pro Jahr')).toHaveValue('30');
	await expect(page.getByLabel('Bundesland')).toHaveValue('DE-ST');
	await page.getByLabel('Urlaubstage pro Jahr').fill('27,5');
	await page.getByLabel('Stichtag', { exact: true }).fill('2026-09-01');
	await page.getByLabel('Offener Urlaub zum Stichtag (Tage)').fill('12,5');
	await page.getByTestId('onboarding-next').click();
	await page.getByTestId('ob-module-automation').uncheck();
	await page.getByTestId('onboarding-next').click();
	await expect(page.getByTestId('sum-model')).toContainText('Tages-Soll 8:00');
	await expect(page.getByTestId('sum-vacation')).toContainText('27,5 Tage');
	await expect(page.getByTestId('sum-modules')).toContainText('Automatik und Shortcuts');
	expect(await models()).toHaveLength(0);
	expect((await profile(page)).onboarding.state).toBe('pending');

	await page.getByTestId('onboarding-finish').click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('setup-banner')).toHaveCount(0);
	const stored = await models();
	expect(stored).toHaveLength(1);
	expect(stored[0]).toMatchObject({ weeklyTargetSeconds: 144000, workdays: [1, 2, 3, 4, 5], roundingEnabled: true, roundingMinutes: 15, fixedBreaks: [], schoolFullDayThresholdSeconds: 10800 });
	expect(stored[0].schoolCreditSeconds ?? null).toBeNull();
	const vacation = (await api(page, 'GET', '/api/v1/vacation/settings')).body;
	expect(vacation).toMatchObject({ configured: true, region: 'DE-ST', annualEntitlementHalfDays: 55 });
	const balance = (await api(page, 'GET', `/api/v1/vacation/balance?year=2026`)).body;
	expect(JSON.stringify(balance)).toContain('25');
	const modules = (await api(page, 'GET', '/api/v1/modules')).body as any[];
	expect(modules.find((m) => m.key === 'automation').accountEnabled).toBe(false);
	expect(modules.find((m) => m.key === 'reports').accountEnabled).toBe(true);
	expect((await profile(page)).onboarding.state).toBe('completed');
	await page.reload();
	await expect(page.getByTestId('setup-banner')).toHaveCount(0);
	// Alice has not done the setup and is not affected
	expect((await profile(alice.page)).onboarding.state).toBe('pending');
	expect(((await api(alice.page, 'GET', '/api/v1/work-models')).body as any[]).length).toBe(0);
});

test('guided setup again from the settings shows current values and stores a new version', async () => {
	const page = bob.page;
	await page.goto('/settings/profile');
	await expect(page.getByTestId('setup-state')).toContainText('abgeschlossen');
	await page.getByTestId('setup-repeat').click();
	await expect(page.getByTestId('repeat-note')).toBeVisible();
	await expect(page.getByLabel('Wochenstunden')).toHaveValue('40:00');
	await page.getByLabel('Gültig ab').fill('2027-01-01');
	await page.getByLabel('Wochenstunden').fill('30:00');
	// breaks and school keep their prefilled values, vacation and modules are skipped
	for (const step of ['breaks', 'school']) {
		await page.getByTestId('onboarding-next').click();
		await expect(page.getByTestId(`step-${step}`)).toBeVisible();
	}
	await page.getByTestId('onboarding-next').click();
	await page.getByTestId('onboarding-skip').click();
	await page.getByTestId('onboarding-skip').click();
	await expect(page.getByTestId('sum-vacation')).toContainText('Übersprungen');
	await expect(page.getByTestId('sum-modules')).toContainText('Übersprungen');
	await page.getByTestId('onboarding-finish').click();
	await expect(page).toHaveURL(/\/$/);
	const versions = ((await api(page, 'GET', '/api/v1/work-models')).body as any[]).sort((x, y) => x.validFrom.localeCompare(y.validFrom));
	expect(versions).toHaveLength(2);
	expect(versions[0]).toMatchObject({ weeklyTargetSeconds: 144000, validTo: '2026-12-31' });
	expect(versions[1]).toMatchObject({ weeklyTargetSeconds: 108000, validFrom: '2027-01-01' });
	// skipped sections stay as they were
	expect((await api(page, 'GET', '/api/v1/vacation/settings')).body).toMatchObject({ annualEntitlementHalfDays: 55 });
	expect(((await api(page, 'GET', '/api/v1/modules')).body as any[]).find((m) => m.key === 'automation').accountEnabled).toBe(false);
});

test('"Einrichtung später" stores only the skipped flag', async () => {
	const page = alice.page;
	await page.goto('/onboarding');
	await page.getByTestId('onboarding-later').click();
	await expect(page).toHaveURL(/\/$/);
	expect((await profile(page)).onboarding.state).toBe('skipped');
	expect(((await api(page, 'GET', '/api/v1/work-models')).body as any[]).length).toBe(0);
	await expect(page.getByTestId('setup-banner')).toHaveCount(0);
});

test('without a mail transport the profile explains it and the e-mail stays optional', async ({ browser }) => {
	loner = await newActor(browser, NOMAIL);
	await registerViaInvite(loner, new URL(process.env.E2E_PROFILE_NOMAIL_BOOTSTRAP_LINK!).pathname, 'solo.pro', 'Solo Profil', 'Passkey');
	await loner.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(loner.page.getByRole('heading', { name: 'Hallo, Solo Profil' })).toBeVisible();
	await loner.page.goto('/settings/profile');
	await expect(loner.page.getByTestId('no-mail')).toContainText('keine E-Mails versenden');
	await expect(loner.page.getByTestId('email-edit')).toHaveCount(0);
	const response = await loner.page.request.put(`${NOMAIL}/api/v1/me/profile/email`, { data: { email: 'solo@example.test' }, headers: { 'X-CSRF-Token': (await (await loner.page.request.get(`${NOMAIL}/api/v1/auth/session`)).json()).csrfToken } });
	expect(response.status()).toBe(501);
	// everything else on the profile still works
	await loner.page.getByLabel('Anzeigename').fill('Solo Neu');
	await loner.page.getByRole('button', { name: 'Speichern' }).click();
	await expect(loner.page.getByTestId('name-notice')).toBeVisible();
});

// Package MAIL1 (ADR-0022): status, connection check and test mail of the admin page against the real backend.
test('mail diagnosis: the check passes against the capturing SMTP server, the test mail arrives with the fixed subject', async () => {
	const page = alice.page;
	await page.goto('/admin/mail');
	await expect(page.getByTestId('mail-configured')).toHaveText('Eingerichtet');
	await expect(page.getByTestId('mail-host')).toHaveText('127.0.0.1');
	await expect(page.getByTestId('mail-tls')).toHaveText('Unverschlüsselt');
	await expect(page.getByTestId('mail-auth')).toHaveText('Keine Anmeldung');
	await page.getByTestId('mail-check-run').click();
	await expect(page.getByTestId('mail-result')).toHaveAttribute('data-ok', 'true');
	for (const id of ['dns', 'tcp', 'ehlo', 'mailFrom']) await expect(page.getByTestId(`mail-step-${id}`)).toHaveAttribute('data-status', 'ok');
	for (const id of ['tls', 'auth']) await expect(page.getByTestId(`mail-step-${id}`)).toHaveAttribute('data-status', 'skipped');

	const before = mails.length;
	await page.getByLabel('Empfänger').fill('ziel.mail@example.test');
	await page.getByTestId('mail-test-send').click();
	await expect(page.getByTestId('mail-test-sent')).toContainText('Gesendet an ziel.mail@example.test');
	const mail = mails.slice(before).find((m) => m.to === 'ziel.mail@example.test');
	expect(mail).toBeTruthy();
	const subject = mail!.body.split('\r\n\r\n')[0].replace(/\r\n /g, ' ').split('\r\n').find((l) => l.startsWith('Subject:'))!;
	const decoded = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8')).join('');
	expect(decoded).toBe('Timetrack: Testnachricht');
	// the check itself never sends a message
	expect(mails.slice(before).filter((m) => m.to !== 'ziel.mail@example.test')).toHaveLength(0);
});

test('mail diagnosis: members are refused, and an unconfigured server shows the checklist', async () => {
	const forbidden = await api(bob.page, 'GET', '/api/v1/admin/mail');
	expect(forbidden.status).toBe(403);
	expect((await api(bob.page, 'POST', '/api/v1/admin/mail/check')).status).toBe(403);
	await bob.page.goto('/admin/mail');
	await expect(bob.page.getByTestId('mail-forbidden')).toBeVisible();

	await loner.page.goto('/settings/profile');
	await loner.page.getByTestId('no-mail-admin-link').click();
	await expect(loner.page).toHaveURL(/\/admin\/mail$/);
	await expect(loner.page.getByTestId('mail-configured')).toHaveText('Nicht eingerichtet');
	await expect(loner.page.getByTestId('mail-example')).toContainText('SMTP_HOST=');
	await expect(loner.page.getByTestId('mail-check-run')).toHaveCount(0);
	expect((await api(loner.page, 'POST', '/api/v1/admin/mail/check')).status).toBe(501);
});
