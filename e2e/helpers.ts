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
export async function apiCall(page: Page, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Api> {
	return page.evaluate(
		async ({ method, path, body, extraHeaders }) => {
			const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
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
		{ method, path, body, extraHeaders }
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
	// the account menu in the top bar holds the sign-out action since L21
	await page.getByTestId('account-menu').click();
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

export interface ApiBinary {
	status: number;
	headers: Record<string, string>;
	body: Buffer;
}

/** Multipart upload (field `file`) from inside the page; the answer body is parsed as JSON when possible. */
export async function apiUpload(page: Page, path: string, name: string, bytes: Buffer, type = 'application/octet-stream'): Promise<Api> {
	return page.evaluate(
		async ({ path, name, base64, type }) => {
			const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
			const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
			const form = new FormData();
			form.append('file', new Blob([raw], { type }), name);
			const res = await fetch(path, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'X-CSRF-Token': session.csrfToken }, body: form });
			const text = await res.text();
			let parsed: unknown = null;
			try {
				parsed = text ? JSON.parse(text) : null;
			} catch {
				parsed = text;
			}
			return { status: res.status, body: parsed };
		},
		{ path, name, base64: bytes.toString('base64'), type }
	);
}

/** GET a binary resource from inside the page (session cookie); returns status, headers and the raw bytes. */
export async function apiDownload(page: Page, path: string): Promise<ApiBinary> {
	const res = await page.evaluate(async (path) => {
		const r = await fetch(path, { credentials: 'include' });
		const buf = new Uint8Array(await r.arrayBuffer());
		let binary = '';
		for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
		return { status: r.status, headers: Object.fromEntries(r.headers.entries()), base64: btoa(binary) };
	}, path);
	return { status: res.status, headers: res.headers, body: Buffer.from(res.base64, 'base64') };
}
