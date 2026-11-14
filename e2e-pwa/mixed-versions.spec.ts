import { expect, test, type Page } from '@playwright/test';

// PWA-UPDATE-MIX (14.11.2026): behind a load balancer an old and a new backend replica answered side by side (one of
// them lacks this build's hashed files and answers 404). Before the fix the bootstrap recovered once and then showed
// "Die Anwendung konnte nicht geladen werden. Es läuft gerade ein Update." on every load, also long after the update.
// /__test/flaky {every: n} makes every n-th /_app/immutable/ request a 404, like a round-robin over two builds.
test.describe.configure({ mode: 'serial' });

const loginButton = (page: Page) => page.getByRole('button', { name: 'Mit Passkey anmelden' });

async function flaky(page: Page, every: number) {
	expect((await page.request.post('/__test/flaky', { data: { every } })).status()).toBe(204);
}

async function activeWorker(page: Page) {
	await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 30_000 });
}

test.afterEach(async ({ request }) => {
	await request.post('/__test/flaky', { data: { every: 0 } });
});

test('first visit loads the app although every 3rd asset request hits a replica without the files', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await flaky(page, 3);
	await page.goto('/login');
	await expect(loginButton(page)).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('#tt-recovery-fallback')).toHaveCount(0);
	// and it stays usable for the next visits (no fallback, no reload loop)
	for (let i = 0; i < 3; i++) {
		await page.goto('/login');
		await expect(loginButton(page)).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#tt-recovery-fallback')).toHaveCount(0);
	}
	await context.close();
});

test('an installed app with an old service worker loads after a new version and more than 30 minutes, without clearing caches', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.clock.install();
	await page.goto('/login');
	await activeWorker(page);
	await page.reload();
	await expect(loginButton(page)).toBeVisible();
	const cachesBefore = await page.evaluate(() => caches.keys());
	expect(cachesBefore.length).toBe(1);

	// a new version is deployed (service worker bytes change) and replicas still differ
	expect((await page.request.post('/__test/bump')).status()).toBe(204);
	await flaky(page, 3);
	await page.clock.fastForward('31:00');
	for (let i = 0; i < 3; i++) {
		await page.goto('/login');
		await expect(loginButton(page)).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#tt-recovery-fallback')).toHaveCount(0);
		await page.clock.fastForward('10:00');
	}
	await context.close();
});
