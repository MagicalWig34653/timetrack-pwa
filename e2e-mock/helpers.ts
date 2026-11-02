import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface MockActor {
	context: BrowserContext;
	page: Page;
}

/**
 * Signs in as the mock admin (demo data account). The mock does not verify signatures, but the browser still needs a
 * resident credential for `navigator.credentials.get`, so a throw-away P-256 key is injected into a virtual authenticator.
 */
export async function loginAsAdmin(
	browser: Browser,
	options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}
): Promise<MockActor> {
	const { context, page } = await newAuthenticatorContext(browser, options);
	await page.goto('/login');
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page.getByRole('heading', { name: /^Hallo, / })).toBeVisible();
	return { context, page };
}

/** A fresh browser context with a virtual authenticator holding a resident credential, not yet signed in. */
export async function newAuthenticatorContext(
	browser: Browser,
	options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}
): Promise<MockActor> {
	const context = await browser.newContext({ viewport: options.viewport, colorScheme: options.colorScheme });
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
	});
	const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	await cdp.send('WebAuthn.addCredential', {
		authenticatorId,
		credential: {
			credentialId: randomBytes(16).toString('base64'),
			isResidentCredential: true,
			rpId: 'localhost',
			privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
			userHandle: randomBytes(16).toString('base64'),
			signCount: 0
		}
	});
	return { context, page };
}

/** Berlin dates (newest first) of the mock's seeded working days with two work segments (Mon, Tue, Wed, Fri within 14 days). */
export function seededWorkDays(): string[] {
	const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' });
	const today = berlin.format(new Date());
	const days: string[] = [];
	for (let offset = 1; offset <= 14; offset++) {
		const [y, m, d] = today.split('-').map(Number);
		const date = new Date(Date.UTC(y, m - 1, d - offset));
		if ([1, 2, 3, 5].includes(date.getUTCDay())) days.push(date.toISOString().slice(0, 10));
	}
	return days;
}

/**
 * Pins the browser clock and the mock's clock to the same instant: 12:00 UTC (13:00 or 14:00 Berlin) of the current Berlin
 * date, so "N minutes ago" stays on the same calendar day whatever time the suite really runs. The clock keeps ticking
 * from there. Call it right after login, before the first `page.goto` of the test; `unpinClock` (or the next
 * `/__test/reset`) restores the mock. Returns the pinned instant in epoch ms.
 */
export async function pinClock(page: Page): Promise<number> {
	const berlinToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
	const instant = Date.parse(`${berlinToday}T12:00:00Z`);
	await page.clock.install({ time: instant });
	const response = await page.request.post('/__test/clock', { data: { now: new Date(instant).toISOString() } });
	expect(response.status()).toBe(204);
	pinned.set(page, { instant, started: Date.now() });
	return instant;
}

const pinned = new WeakMap<Page, { instant: number; started: number }>();

/** The pinned "now" of `pinClock` in epoch ms, the node-side stand-in for `Date.now()` (real time if not pinned). */
export function pinnedNow(page: Page): number {
	const pin = pinned.get(page);
	return pin ? pin.instant + (Date.now() - pin.started) : Date.now();
}

/** Restores the mock's real-time clock after `pinClock`. */
export async function unpinClock(page: Page): Promise<void> {
	const response = await page.request.post('/__test/clock', { data: { now: null } });
	expect(response.status()).toBe(204);
}
