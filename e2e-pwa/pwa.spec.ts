import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loginAsAdmin } from '../e2e-mock/helpers';

// Production build served with the mock API (see playwright.pwa.config.ts). Serial: the server keeps state and the
// "new version" switch (/__test/bump) is global.
test.describe.configure({ mode: 'serial' });

const build = path.resolve('build');

function pngSize(file: string): { width: number; height: number } {
	const buf = fs.readFileSync(file);
	expect(buf.subarray(1, 4).toString()).toBe('PNG');
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function activeWorker(page: Page) {
	await page.evaluate(async () => {
		const reg = await navigator.serviceWorker.ready;
		return reg.active?.state;
	});
	// first activation claims the page; reload so requests are controlled
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('favicons are served as images and linked from the page', async ({ request, page }) => {
	for (const [url, type] of [
		['/favicon.svg', 'image/svg+xml'],
		['/favicon.ico', 'image/x-icon'],
		['/favicon-32.png', 'image/png'],
		['/icons/apple-180.png', 'image/png']
	]) {
		const response = await request.get(url);
		expect(response.status(), url).toBe(200);
		expect(response.headers()['content-type'], url).toContain(type);
	}
	await page.goto('/');
	const links = await page.locator('head link[rel~="icon"], head link[rel="apple-touch-icon"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
	expect(links).toEqual(expect.arrayContaining(['/favicon.svg?v=2', '/favicon-16.png?v=2', '/favicon-32.png?v=2', '/favicon.ico?v=2', '/icons/apple-180.png?v=2']));
});

test('manifest declares the app and every icon exists with the declared size', async ({ request, page }) => {
	const response = await request.get('/manifest.webmanifest');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('application/manifest+json');
	const manifest = await response.json();
	expect(manifest).toMatchObject({ name: 'Timetrack', short_name: 'Timetrack', lang: 'de', display: 'standalone', start_url: '/', scope: '/' });
	expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
	expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
	const sizes = manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? 'any'}`);
	expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
	for (const icon of manifest.icons) {
		const file = path.join(build, icon.src.split('?')[0]);
		expect(fs.existsSync(file), icon.src).toBe(true);
		if (icon.type === 'image/svg+xml') {
			expect((await request.get(icon.src)).headers()['content-type']).toContain('image/svg+xml');
			continue;
		}
		const [w, h] = icon.sizes.split('x').map(Number);
		expect(pngSize(file)).toEqual({ width: w, height: h });
		const served = await request.get(icon.src);
		expect(served.headers()['content-type']).toBe('image/png');
	}
	expect(pngSize(path.join(build, 'icons/apple-180.png'))).toEqual({ width: 180, height: 180 });

	await page.goto('/login');
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest?v=2');
	await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /\/icons\/apple-180\.png\?v=2$/);
	await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
	expect(await page.locator('meta[name="theme-color"]').count()).toBeGreaterThan(0);
});

test('service worker is served as JavaScript and is not cached immutably', async ({ request }) => {
	const response = await request.get('/service-worker.js');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('javascript');
	expect(response.headers()['cache-control'] ?? '').not.toContain('immutable');
	const html = await request.get('/index.html');
	expect(html.headers()['cache-control']).toBe('no-cache');
});

test('registers, precaches the shell, shows /offline when the network is down and never caches the API', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto('/login');
	await activeWorker(page);

	const cached = await page.evaluate(async () => {
		const out: Record<string, string[]> = {};
		for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
		return out;
	});
	const names = Object.keys(cached);
	expect(names).toHaveLength(1);
	expect(names[0]).toMatch(/^tt-static-/);
	expect(cached[names[0]]).toEqual(expect.arrayContaining(['/index.html', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png']));
	expect(cached[names[0]].some((p) => p.startsWith('/_app/immutable/'))).toBe(true);
	expect(cached[names[0]].some((p) => p.startsWith('/api') || p.startsWith('/oauth') || p.startsWith('/mcp'))).toBe(false);

	// an API call is not answered from a cache, and no cache entry appears for it
	await page.evaluate(() => fetch('/api/v1/auth/session', { credentials: 'include' }).catch(() => null));
	const afterApi = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map((r) => r.url));
	expect(afterApi.some((u) => u.includes('/api/'))).toBe(false);

	await context.setOffline(true);
	await page.goto('/time').catch(() => {});
	await expect(page).toHaveURL(/\/offline(\?from=.*)?$/);
	await expect(page.getByTestId('offline-text')).toHaveText('Du bist offline. Änderungen werden nicht gespeichert.');
	await expect(page.getByTestId('offline-banner')).toContainText('Offline – Änderungen werden nicht gespeichert');
	await page.close({ runBeforeUnload: false });
	await context.close();
});

test('update banner appears for a new version and activates only after confirmation', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto('/login');
	await activeWorker(page);
	await expect(page.getByTestId('update-banner')).toHaveCount(0);

	const before = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.active!.scriptURL);
	expect((await page.request.post('/__test/bump')).status()).toBe(204);
	await page.evaluate(async () => {
		await (await navigator.serviceWorker.getRegistration())!.update();
	});
	const banner = page.getByTestId('update-banner');
	await expect(banner).toBeVisible();
	await expect(banner).toContainText('Neue Version verfügbar');
	// waiting, not active: the running worker did not change on its own
	expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(true);

	await Promise.all([page.waitForNavigation(), banner.getByRole('button', { name: 'Neu laden' }).click()]);
	await expect(page.getByTestId('update-banner')).toHaveCount(0);
	expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(false);
	expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.active!.scriptURL)).toBe(before);
	await context.close();
});

/** CDP registration id of the newest live registration (the browser lists registrations of earlier contexts too). */
async function workerRegistrationId(context: BrowserContext, page: Page) {
	const cdp = await context.newCDPSession(page);
	let latest: string | undefined;
	cdp.on('ServiceWorker.workerRegistrationUpdated', (event) => {
		const live = event.registrations.filter((r) => !r.isDeleted && r.scopeURL.endsWith('/'));
		if (live.length > 0) latest = String(Math.max(...live.map((r) => Number(r.registrationId))));
	});
	await cdp.send('ServiceWorker.enable');
	return { cdp, current: () => latest };
}

test('push: enable on this device with granted permission, list, test, and a delivered push shows a notification', async ({ browser, baseURL }) => {
	test.setTimeout(120_000);
	const { context, page } = await loginAsAdmin(browser);
	await context.grantPermissions(['notifications'], { origin: baseURL });
	const worker = await workerRegistrationId(context, page);
	await page.goto('/settings/notifications');
	await activeWorker(page);
	// headless Chromium cannot reach a real push service in CI: patch the page realm (not a context init script, which
	// changes how the worker is attached) with a deterministic fake subscription
	await page.evaluate(() => {
		const fake = {
			endpoint: 'https://push.example.test/send/e2e-device',
			expirationTime: null,
			toJSON() {
				return { endpoint: this.endpoint, keys: { p256dh: 'BFakeP256dhKeyForE2E', auth: 'FakeAuthE2E' } };
			},
			getKey: () => null,
			unsubscribe: async () => {
				(window as unknown as { __sub?: unknown }).__sub = null;
				return true;
			}
		};
		let current: unknown = null;
		PushManager.prototype.subscribe = async function (options) {
			(window as unknown as { __appKey?: number }).__appKey = (options?.applicationServerKey as ArrayBuffer).byteLength;
			current = fake;
			return fake as unknown as PushSubscription;
		};
		PushManager.prototype.getSubscription = async function () {
			return current as PushSubscription | null;
		};
		fake.unsubscribe = async () => {
			current = null;
			return true;
		};
	});
	await expect(page.getByTestId('push-state')).toContainText('nicht aktiviert');

	await page.getByRole('button', { name: 'Push auf diesem Gerät aktivieren' }).click();
	await expect(page.getByText('Push wurde aktiviert.')).toBeVisible();
	expect(await page.evaluate(() => (window as unknown as { __appKey?: number }).__appKey)).toBe(65);
	const row = page.getByTestId('subscription-list').getByRole('listitem');
	await expect(row).toHaveCount(1);
	await expect(row).toContainText('dieses Gerät');
	await expect(row).toContainText('push.example.test');
	await row.getByRole('button', { name: 'Testnachricht senden' }).click();
	await expect(page.getByText('Testnachricht wurde gesendet.')).toBeVisible();

	// simulate the push service delivering messages to the service worker (CDP). Chromium occasionally drops a
	// delivery while the worker is winding down, so a delivery is repeated until its notification is visible.
	const { cdp } = worker;
	await expect.poll(() => worker.current()).toBeDefined();
	const origin = new URL(baseURL!).origin;
	const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data })));
	async function deliver(data: string, until: (list: Awaited<ReturnType<typeof shown>>) => boolean) {
		await expect
			.poll(
				async () => {
					await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: worker.current()!, data });
					await page.waitForTimeout(400);
					return until(await shown());
				},
				{ timeout: 20_000 }
			)
			.toBe(true);
	}

	await deliver(
		JSON.stringify({ title: 'Berichtsheft-Erinnerung', body: 'Öffne Timetrack für Details.', url: '/reports', tag: 'report_gap:2026-W42', kind: 'report_gap' }),
		(list) => list.some((n) => n.title === 'Berichtsheft-Erinnerung' && n.tag === 'report_gap:2026-W42' && n.body === 'Öffne Timetrack für Details.' && n.data?.url === '/reports' && n.data?.kind === 'report_gap')
	);
	// malformed payload: generic German fallback
	await deliver('{broken', (list) => list.some((n) => n.title === 'Timetrack' && n.body === 'Öffne Timetrack für Details.' && n.data?.url === '/'));

	// a NAVIGATE message from the worker (notification click) moves the open window within the app
	await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'NAVIGATE', url: '/reports' } })));
	await expect(page).toHaveURL(/\/reports$/);

	// back to the settings by client-side navigation (a reload would drop the patched PushManager of this test)
	await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'NAVIGATE', url: '/settings/notifications' } })));
	await page.getByRole('button', { name: 'Push auf diesem Gerät deaktivieren' }).click();
	await expect(page.getByText('Push wurde deaktiviert.')).toBeVisible();
	await context.close();
});

test('offline banner shows when the connection drops and never pretends success', async ({ browser }) => {
	const { context, page } = await loginAsAdmin(browser);
	await expect(page.getByTestId('offline-banner')).toHaveCount(0);
	await context.setOffline(true);
	await expect(page.getByTestId('offline-banner')).toContainText('Offline – Änderungen werden nicht gespeichert');
	await context.setOffline(false);
	await expect(page.getByTestId('offline-banner')).toHaveCount(0);
	await context.close();
});
