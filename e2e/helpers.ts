import { expect, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

export interface Actor {
	context: BrowserContext;
	page: Page;
	cdp: CDPSession;
	authenticatorId: string;
}

type Credential = Record<string, unknown>;

// getCredentials may return fields (e.g. an absent/empty largeBlob) that addCredential rejects.
function pick(c: Credential): Credential {
	const keys = ['credentialId', 'isResidentCredential', 'rpId', 'privateKey', 'userHandle', 'signCount', 'backupEligibility', 'backupState'];
	return Object.fromEntries(keys.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));
}

async function addAuthenticator(cdp: CDPSession): Promise<string> {
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	return authenticatorId;
}

/** New isolated browser context with a CDP virtual authenticator (resident key + user verification). */
export async function newActor(browser: Browser, credentials: Credential[] = [], baseURL?: string): Promise<Actor> {
	const context = await browser.newContext(baseURL ? { baseURL } : {});
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const authenticatorId = await addAuthenticator(cdp);
	for (const credential of credentials) {
		await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: pick(credential) as never });
	}
	return { context, page, cdp, authenticatorId };
}

export async function exportCredentials(actor: Actor): Promise<Credential[]> {
	const { credentials } = await actor.cdp.send('WebAuthn.getCredentials', { authenticatorId: actor.authenticatorId });
	return credentials as unknown as Credential[];
}

/**
 * Replace the virtual authenticator by an empty one. Needed to register a second passkey on the same account:
 * the server sends excludeCredentials, which would make the authenticator holding the first credential refuse.
 * Returns the credentials of the removed authenticator so they can be restored later.
 */
export async function swapToEmptyAuthenticator(actor: Actor): Promise<Credential[]> {
	const old = await exportCredentials(actor);
	await actor.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: actor.authenticatorId });
	actor.authenticatorId = await addAuthenticator(actor.cdp);
	return old;
}

export interface Api {
	status: number;
	body: any;
}

/** Same-origin API call from inside the page (session cookie + CSRF header, like the PWA client). */
export async function apiCall(page: Page, method: string, path: string, body?: unknown): Promise<Api> {
	return page.evaluate(
		async ({ method, path, body }) => {
			const headers: Record<string, string> = { Accept: 'application/json' };
			if (method !== 'GET') {
				const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
				headers['X-CSRF-Token'] = session.csrfToken;
				if (body !== undefined) headers['Content-Type'] = 'application/json';
			}
			const res = await fetch(path, {
				method,
				credentials: 'include',
				headers,
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			const text = await res.text();
			let parsed: unknown = null;
			try {
				parsed = text ? JSON.parse(text) : null;
			} catch {
				parsed = text;
			}
			return { status: res.status, body: parsed };
		},
		{ method, path, body }
	);
}

/** Register a new account through the invite page; ends on /setup/recovery. */
export async function registerViaInvite(actor: Actor, invitePath: string, handle: string, displayName: string, passkeyName?: string) {
	const { page } = actor;
	await page.goto(invitePath);
	await page.getByLabel('Kontoname').fill(handle);
	await page.getByLabel('Anzeigename').fill(displayName);
	if (passkeyName) await page.getByLabel('Name des Passkeys (optional)').fill(passkeyName);
	await page.getByRole('button', { name: 'Passkey erstellen und Konto anlegen' }).click();
	await expect(page).toHaveURL(/\/setup\/recovery$/);
}

export async function loginWithPasskey(page: Page) {
	await page.goto('/login');
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page).toHaveURL(/\/$/);
}

export async function signOut(page: Page) {
	await page.getByRole('button', { name: 'Abmelden' }).click();
	await expect(page).toHaveURL(/\/login/);
}

/** Generate recovery codes in /settings/recovery and return them (never log them). */
export async function generateRecoveryCodes(page: Page): Promise<string[]> {
	await page.goto('/settings/recovery');
	await page.getByRole('button', { name: /^(Codes erzeugen)$/ }).click();
	const list = page.getByRole('list', { name: 'Recovery-Codes' });
	await expect(list.getByRole('listitem').first()).toBeVisible();
	const codes = (await list.getByRole('listitem').allTextContents()).map((c) => c.trim());
	await page.getByLabel('Ich habe die Codes sicher gespeichert.').check();
	await page.getByRole('button', { name: 'Fertig' }).click();
	return codes;
}

export async function setFallbackPassword(page: Page, password: string) {
	await page.goto('/settings/recovery');
	await page.locator('#fallback-password').fill(password);
	await page.locator('#fallback-password-repeat').fill(password);
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Rückfallpasswort gespeichert.')).toBeVisible();
}

/** Start recovery for a handle and submit proof. Leaves the page on the result of "Bestätigen". */
export async function recover(page: Page, handle: string, method: 'Recovery-Code' | 'Rückfallpasswort', proof: string) {
	await page.goto('/recover');
	await page.getByLabel('Kontoname').fill(handle);
	await page.getByRole('radio', { name: new RegExp(`^${method}`) }).check();
	await page.getByRole('button', { name: 'Weiter' }).click();
	await page.locator('#recover-proof').fill(proof);
	await page.getByRole('button', { name: 'Bestätigen' }).click();
}
