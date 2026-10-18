import { expect, test } from '@playwright/test';

// W2: the document references an entry script the answering server does not have and answers the SPA shell (text/html) for it.
test.describe.configure({ mode: 'serial' });

const entryScript = '**/_app/immutable/entry/app.*.js';
const htmlAnswer = { status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html></html>' };

test('recovers once from an HTML answer for the entry script (stale document, other build)', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	let served = 0;
	await page.route(entryScript, (route) => (served++ === 0 ? route.fulfill(htmlAnswer) : route.continue()));
	await page.goto('/login');
	await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible({ timeout: 15_000 });
	expect(served).toBeGreaterThanOrEqual(2);
	expect(await page.locator('#tt-recovery-fallback').count()).toBe(0);
	await context.close();
});

test('shows the German fallback instead of a white page when the failure persists', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	let served = 0;
	await page.route(entryScript, (route) => {
		served++;
		return route.fulfill(htmlAnswer);
	});
	await page.goto('/login');
	const box = page.locator('#tt-recovery-fallback');
	await expect(box).toBeVisible({ timeout: 15_000 });
	await expect(box).toContainText('Die Anwendung konnte nicht geladen werden. Es läuft gerade ein Update. Bitte in einigen Sekunden neu laden.');
	await expect(box.getByRole('button', { name: 'Neu laden' })).toBeVisible();
	// exactly one automatic recovery (one reload) within the five-minute window, no reload loop
	await page.waitForTimeout(1500);
	expect(served).toBe(2);
	// once the server is healthy again the button brings the app back
	await page.unroute(entryScript);
	await box.getByRole('button', { name: 'Neu laden' }).click();
	await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible({ timeout: 15_000 });
	await expect(page.locator('#tt-recovery-fallback')).toHaveCount(0);
	await context.close();
});

test('the server answers a real 404 (not the SPA shell) for a missing hashed asset', async ({ request }) => {
	const missing = await request.get('/_app/immutable/entry/app.00000000.js');
	expect(missing.status()).toBe(404);
	expect(missing.headers()['content-type']).not.toContain('text/html');
	expect((await request.get('/reports')).headers()['content-type']).toContain('text/html');
});
