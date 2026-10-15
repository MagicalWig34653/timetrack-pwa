import { expect, test, type Browser } from '@playwright/test';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { apiCall as api, newActor as baseActor, registerViaInvite, type Actor } from './helpers';

// Package L16 against the real Swift backend (C18): settings, push config, subscriptions, test push, empty in-app list.
// Seventh backend instance (E2E_NOTIFICATIONS_PORT): background runner off, generated VAPID key. No real push delivery:
// subscriptions use a fake https endpoint (the backend only validates it).
test.describe.configure({ mode: 'serial' });

const BASE = `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 6}`;
// new headless Chromium: the headless shell reports Notification.permission as denied even when granted
test.use({ baseURL: BASE, channel: 'chromium' });
const newActor = (browser: Browser) => baseActor(browser, [], BASE);

let alice: Actor;

test.afterAll(async () => {
	await alice?.context.close();
});

/** Valid subscription material: uncompressed P-256 point (65 bytes) and a 16-byte auth secret, both base64url. */
function keys() {
	const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
	const p256dh = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');
	return { p256dh, auth: randomBytes(16).toString('base64url') };
}
const endpoint = (n: number) => `https://push.nx-e2e.timetrack-test.net/wpush/v2/e2e-device-${n}`;

test('register the account', async ({ browser }) => {
	alice = await newActor(browser);
	await registerViaInvite(alice, new URL(process.env.E2E_NOTIFICATIONS_BOOTSTRAP_LINK!).pathname, 'alice.notif', 'Alice Hinweise', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Hinweise' })).toBeVisible();
});

test('settings: defaults from the server, UI roundtrip persists in the backend', async () => {
	const { page } = alice;
	const defaults = await api(page, 'GET', '/api/v1/notifications/settings');
	expect(defaults.status).toBe(200);
	expect(defaults.body.categories.running_timer).toMatchObject({ inApp: true, push: true, thresholdMinutes: 600 });

	await page.goto('/settings/notifications');
	const timer = page.locator('[data-kind="running_timer"]');
	const gap = page.locator('[data-kind="report_gap"]');
	await expect(timer.getByLabel('Erinnern nach (Minuten)')).toHaveValue('600');
	await timer.getByLabel('Erinnern nach (Minuten)').fill('45');
	await timer.getByLabel('Push').uncheck();
	await gap.getByLabel('Wochentag').selectOption('3');
	await gap.getByLabel('Uhrzeit').fill('14:15');
	await page.getByLabel('Ruhezeiten verwenden').uncheck();
	await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
	await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible();

	const saved = await api(page, 'GET', '/api/v1/notifications/settings');
	expect(saved.body.categories.running_timer).toMatchObject({ inApp: true, push: false, thresholdMinutes: 45 });
	expect(saved.body.categories.report_gap).toMatchObject({ weekday: 3, time: '14:15' });
	expect(saved.body.quietStart ?? null).toBeNull();
	await page.reload();
	await expect(timer.getByLabel('Erinnern nach (Minuten)')).toHaveValue('45');
	await expect(page.getByLabel('Ruhezeiten verwenden')).not.toBeChecked();

	// the backend rejects what the form would never send
	const bad = await api(page, 'PUT', '/api/v1/notifications/settings', { categories: { running_timer: { inApp: true, push: true, thresholdMinutes: 5 } } });
	expect(bad.status).toBe(400);
});

test('push config is available and the settings page offers enabling', async () => {
	const { page } = alice;
	const config = await api(page, 'GET', '/api/v1/push/config');
	expect(config.status).toBe(200);
	expect(config.body.available).toBe(true);
	expect(config.body.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
	await page.goto('/settings/notifications');
	await expect(page.getByTestId('push-state')).toContainText('nicht aktiviert');
	await expect(page.getByRole('button', { name: 'Push auf diesem Gerät aktivieren' })).toBeVisible();
});

test('subscriptions: validation, idempotency, list without the endpoint, limit of 10, delete', async () => {
	const { page } = alice;
	const k = keys();
	const created = await api(page, 'POST', '/api/v1/me/push-subscriptions', { endpoint: endpoint(1), keys: k, userAgent: 'e2e' });
	expect(created.status).toBe(201);
	expect(created.body.host).toBe('push.nx-e2e.timetrack-test.net');
	const again = await api(page, 'POST', '/api/v1/me/push-subscriptions', { endpoint: endpoint(1), keys: k, userAgent: 'e2e' });
	expect(again.body.id).toBe(created.body.id);

	const list = await api(page, 'GET', '/api/v1/me/push-subscriptions');
	expect(list.body).toHaveLength(1);
	expect(JSON.stringify(list.body)).not.toContain('e2e-device');

	expect((await api(page, 'POST', '/api/v1/me/push-subscriptions', { endpoint: 'http://push.nx-e2e.timetrack-test.net/x', keys: keys() })).status).toBe(400);
	expect((await api(page, 'POST', '/api/v1/me/push-subscriptions', { endpoint: endpoint(2), keys: { p256dh: 'abc', auth: 'def' } })).status).toBe(400);

	for (let n = 2; n <= 10; n++) {
		expect((await api(page, 'POST', '/api/v1/me/push-subscriptions', { endpoint: endpoint(n), keys: keys() })).status, `device ${n}`).toBe(201);
	}
	const over = await api(page, 'POST', '/api/v1/me/push-subscriptions', { endpoint: endpoint(11), keys: keys() });
	expect(over.status).toBe(409);
	expect(over.body.error.code).toBe('too_many_subscriptions');

	// UI shows the list with host and removal
	await page.goto('/settings/notifications');
	await expect(page.getByTestId('subscription-list').getByRole('listitem')).toHaveCount(10);
	await page.getByTestId('subscription-list').getByRole('listitem').first().getByRole('button', { name: 'Entfernen' }).click();
	await expect(page.getByText('Gerät entfernt.')).toBeVisible();
	await expect(page.getByTestId('subscription-list').getByRole('listitem')).toHaveCount(9);

	const remaining = (await api(page, 'GET', '/api/v1/me/push-subscriptions')).body as { id: string }[];
	expect(remaining).toHaveLength(9);
	expect((await api(page, 'DELETE', `/api/v1/me/push-subscriptions/${remaining[0].id}`)).status).toBe(204);
	expect((await api(page, 'DELETE', `/api/v1/me/push-subscriptions/${remaining[0].id}`)).status).toBe(404);
	for (const sub of remaining.slice(1)) expect((await api(page, 'DELETE', `/api/v1/me/push-subscriptions/${sub.id}`)).status).toBe(204);
	expect((await api(page, 'GET', '/api/v1/me/push-subscriptions')).body).toHaveLength(0);
});

test('test push to a fake endpoint: what the backend really answers, and the UI message for it', async () => {
	const { page } = alice;
	const sub = await api(page, 'POST', '/api/v1/me/push-subscriptions', { endpoint: endpoint(50), keys: keys() });
	expect(sub.status).toBe(201);
	const res = await api(page, 'POST', `/api/v1/me/push-subscriptions/${sub.body.id}/test`);
	// Real behaviour (C18/C19): the host is on the test allow-list but does not resolve (NXDOMAIN), so no real push service is contacted and the backend answers 502 push_failed.
	expect(res.status).toBe(502);
	console.log(`test push to fake endpoint answered ${res.status} ${JSON.stringify(res.body)}`);

	await page.goto('/settings/notifications');
	await page.getByTestId('subscription-list').getByRole('button', { name: 'Testnachricht senden' }).click();
	{
		expect(res.body.error.code).toBe('push_failed');
		await expect(page.getByText('Der Push-Dienst hat die Nachricht nicht angenommen. Bitte versuche es später erneut.')).toBeVisible({ timeout: 30_000 });
	}
	expect((await api(page, 'POST', '/api/v1/me/push-subscriptions/00000000-0000-4000-8000-000000000000/test')).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/me/push-subscriptions/${sub.body.id}`)).status).toBe(204);
});

test('enabling in the UI with granted permission registers the (fake) browser subscription at the backend', async ({ baseURL }) => {
	const { page, context } = alice;
	await context.grantPermissions(['notifications'], { origin: baseURL });
	const material = keys();
	await page.goto('/settings/notifications');
	await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/')))).toBe(true);
	await page.reload(); // let the worker take control before the page is patched
	// patch the page realm with a deterministic fake subscription carrying valid key material
	await page.evaluate(
		({ material }) => {
			let current: unknown = null;
			const fake = {
				endpoint: 'https://push.nx-e2e.timetrack-test.net/wpush/v2/ui-device',
				toJSON() {
					return { endpoint: this.endpoint, keys: material };
				},
				getKey: () => null,
				unsubscribe: async () => {
					current = null;
					return true;
				}
			};
			PushManager.prototype.subscribe = async () => ((current = fake), fake as unknown as PushSubscription);
			PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
		},
		{ material }
	);
	await page.getByRole('button', { name: 'Push auf diesem Gerät aktivieren' }).click();
	await expect(page.getByText('Push wurde aktiviert.')).toBeVisible();
	const row = page.getByTestId('subscription-list').getByRole('listitem');
	await expect(row).toHaveCount(1);
	await expect(row).toContainText('dieses Gerät');
	await expect(row).toContainText('push.nx-e2e.timetrack-test.net');
	await page.getByRole('button', { name: 'Push auf diesem Gerät deaktivieren' }).click();
	await expect(page.getByText('Push wurde deaktiviert.')).toBeVisible();
	expect((await api(page, 'GET', '/api/v1/me/push-subscriptions')).body).toHaveLength(0);
});

test('in-app list: empty, unread count 0, mark-all ok, center empty state, no bell badge', async () => {
	const { page } = alice;
	const list = await api(page, 'GET', '/api/v1/notifications');
	expect(list.status).toBe(200);
	expect(list.body).toEqual({ items: [], unreadCount: 0 });
	expect((await api(page, 'GET', '/api/v1/notifications?limit=0')).status).toBe(400);
	const read = await api(page, 'POST', '/api/v1/notifications/read', { all: true });
	expect(read.status).toBe(200);
	expect(read.body.unreadCount).toBe(0);
	expect((await api(page, 'DELETE', '/api/v1/notifications/00000000-0000-4000-8000-000000000000')).status).toBe(404);

	await page.goto('/notifications');
	await expect(page.getByTestId('notifications-empty')).toHaveText('Keine Hinweise vorhanden.');
	await expect(page.getByTestId('bell')).toBeVisible();
	await expect(page.getByTestId('bell-badge')).toHaveCount(0);
});

test('backend serves service worker, manifest and icons with correct types; the worker is not cached immutably', async ({ request }) => {
	const sw = await request.get('/service-worker.js');
	expect(sw.status()).toBe(200);
	expect(sw.headers()['content-type']).toMatch(/javascript/);
	console.log('service-worker.js Cache-Control:', sw.headers()['cache-control'], '| Content-Type:', sw.headers()['content-type']);
	expect(sw.headers()['cache-control'] ?? '').not.toMatch(/immutable|max-age=[1-9]/);

	const manifest = await request.get('/manifest.webmanifest');
	expect(manifest.status()).toBe(200);
	console.log('manifest Content-Type:', manifest.headers()['content-type'], '| Cache-Control:', manifest.headers()['cache-control']);
	// Known backend gap (see docs/handoffs/L16.md): .webmanifest has no MIME mapping, so no Content-Type is sent (+ nosniff).
	// Browsers parse manifests regardless; the body must still be the manifest.
	expect([undefined, 'application/manifest+json', 'application/json']).toContain(manifest.headers()['content-type']);
	expect((await manifest.json()).short_name).toBe('Timetrack');
	expect(manifest.headers()['cache-control'] ?? '').not.toMatch(/immutable/);
	for (const icon of ['icon-192.png', 'icon-512.png', 'icon-mask.png', 'apple-180.png']) {
		const res = await request.get(`/icons/${icon}`);
		expect(res.status(), icon).toBe(200);
		expect(res.headers()['content-type'], icon).toBe('image/png');
		expect(res.headers()['cache-control'] ?? '', icon).not.toMatch(/immutable/);
	}
	// API and probes are not shadowed by the static fallback
	expect((await request.get('/api/v1/does-not-exist')).headers()['content-type'] ?? '').not.toContain('text/html');
});
