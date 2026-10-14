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
	await page.goto('/login');
	await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
	await expect(page.getByRole('heading', { name: /^Hallo, / })).toBeVisible();
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
