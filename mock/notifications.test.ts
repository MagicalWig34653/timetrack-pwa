import { beforeEach, describe, expect, it } from 'vitest';
import { createMockFetch } from './fetch.ts';
import { normalizeSettings } from './notifications.ts';

let mock: ReturnType<typeof createMockFetch>;
let csrf = '';

async function login() {
	const options = await (await mock.fetch('/api/v1/auth/login/options', { method: 'POST' })).json();
	const session = await (await mock.fetch('/api/v1/auth/login/verify', { method: 'POST', body: JSON.stringify({ challengeId: options.challengeId, credential: { id: 'mock-login' } }) })).json();
	csrf = session.csrfToken;
}

async function call(method: string, path: string, body?: unknown) {
	const res = await mock.fetch(`/api/v1${path}`, {
		method,
		headers: method === 'GET' ? {} : { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

beforeEach(async () => {
	mock = createMockFetch();
	await login();
});

describe('notification list', () => {
	it('is newest first, pages by before cursor and counts unread', async () => {
		await call('POST', '/mock/notify', { kind: 'running_timer', count: 5 });
		const first = await call('GET', '/notifications?limit=2');
		expect(first.body.items).toHaveLength(2);
		expect(first.body.unreadCount).toBe(5);
		const cursor = first.body.items[1].createdAt;
		const next = await call('GET', `/notifications?limit=10&before=${encodeURIComponent(cursor)}`);
		expect(next.body.items).toHaveLength(3);
		expect(Date.parse(next.body.items[0].createdAt)).toBeLessThan(Date.parse(cursor));
		expect((await call('GET', '/notifications?limit=0')).status).toBe(400);
		expect((await call('GET', '/notifications?limit=101')).status).toBe(400);
	});

	it('marks read by ids and all, filters unreadOnly, deletes and isolates unknown ids', async () => {
		const created = (await call('POST', '/mock/notify', { kind: 'report_gap', count: 3 })).body;
		const read = await call('POST', '/notifications/read', { ids: [created[0].id] });
		expect(read.body.unreadCount).toBe(2);
		expect((await call('GET', '/notifications?unreadOnly=true')).body.items).toHaveLength(2);
		expect((await call('DELETE', `/notifications/${created[1].id}`)).status).toBe(204);
		expect((await call('DELETE', `/notifications/${created[1].id}`)).status).toBe(404);
		expect((await call('POST', '/notifications/read', { all: true })).body.unreadCount).toBe(0);
		expect((await call('POST', '/notifications/read', {})).status).toBe(400);
	});

	it('uses the real C18 link targets by kind', async () => {
		const urls: Record<string, string | null> = {};
		for (const kind of ['running_timer', 'pending_suggestions', 'report_gap', 'document_submission', 'system']) {
			urls[kind] = (await call('POST', '/mock/notify', { kind })).body[0].url;
		}
		expect(urls).toEqual({ running_timer: '/', pending_suggestions: '/', report_gap: '/reports', document_submission: '/absences', system: null });
	});
});

describe('settings', () => {
	it('returns defaults and replaces the whole document', async () => {
		const defaults = (await call('GET', '/notifications/settings')).body;
		expect(defaults.categories.running_timer.thresholdMinutes).toBe(600);
		expect(defaults.quietStart).toBe('22:00');
		const put = await call('PUT', '/notifications/settings', {
			categories: { running_timer: { inApp: true, push: false, thresholdMinutes: 45 } },
			quietStart: null,
			quietEnd: null
		});
		expect(put.status).toBe(200);
		expect(put.body.categories.running_timer).toEqual({ inApp: true, push: false, thresholdMinutes: 45 });
		expect(put.body.quietStart).toBeNull();
	});

	it('rejects invalid documents like the backend', () => {
		const ok = { categories: { running_timer: { inApp: true, push: true } } };
		expect(normalizeSettings(ok)).not.toBeNull();
		const bad: unknown[] = [
			null,
			{},
			{ categories: { unknown: { inApp: true, push: true } } },
			{ categories: { system: { inApp: true, push: true } } },
			{ categories: { running_timer: { inApp: 'yes', push: true } } },
			{ categories: { running_timer: { inApp: true, push: true, thresholdMinutes: 29 } } },
			{ categories: { running_timer: { inApp: true, push: true, thresholdMinutes: 1441 } } },
			{ categories: { running_timer: { inApp: true, push: true, weekday: 1 } } },
			{ categories: { report_gap: { inApp: true, push: true, weekday: 8 } } },
			{ categories: { report_gap: { inApp: true, push: true, time: '25:00' } } },
			{ categories: { report_gap: { inApp: true, push: true, time: '9:00' } } },
			{ ...ok, quietStart: '22:00' },
			{ ...ok, quietStart: '22:00', quietEnd: 'x' }
		];
		for (const doc of bad) expect(normalizeSettings(doc), JSON.stringify(doc)).toBeNull();
	});
});

describe('push', () => {
	const sub = (n: number) => ({ endpoint: `https://push.example/send/${n}`, keys: { p256dh: 'p', auth: 'a' }, userAgent: 'test' });

	it('exposes config, can be switched off and then answers 501', async () => {
		expect((await call('GET', '/push/config')).body.available).toBe(true);
		expect((await call('GET', '/push/config')).body.vapidPublicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);
		await call('POST', '/mock/push', { available: false });
		expect((await call('GET', '/push/config')).body).toEqual({ available: false });
		const res = await call('POST', '/me/push-subscriptions', sub(1));
		expect(res.status).toBe(501);
		expect(res.body.error.code).toBe('push_unavailable');
	});

	it('is idempotent over the endpoint, never exposes it, limits to 10 and isolates ids', async () => {
		const a = await call('POST', '/me/push-subscriptions', sub(1));
		const again = await call('POST', '/me/push-subscriptions', sub(1));
		expect(a.status).toBe(201);
		expect(again.body.id).toBe(a.body.id);
		expect(a.body.host).toBe('push.example');
		expect(JSON.stringify((await call('GET', '/me/push-subscriptions')).body)).not.toContain('/send/');
		for (let i = 2; i <= 10; i++) expect((await call('POST', '/me/push-subscriptions', sub(i))).status).toBe(201);
		const over = await call('POST', '/me/push-subscriptions', sub(11));
		expect(over.status).toBe(409);
		expect(over.body.error.code).toBe('too_many_subscriptions');
		expect((await call('DELETE', `/me/push-subscriptions/${a.body.id}`)).status).toBe(204);
		expect((await call('DELETE', `/me/push-subscriptions/${a.body.id}`)).status).toBe(404);
		expect((await call('POST', '/me/push-subscriptions', { ...sub(12), endpoint: 'http://push.example/x' })).status).toBe(400);
	});

	it('rate limits the test push at 5 per hour and can simulate a refusing push service', async () => {
		const id = (await call('POST', '/me/push-subscriptions', sub(1))).body.id;
		for (let i = 0; i < 5; i++) expect((await call('POST', `/me/push-subscriptions/${id}/test`)).status).toBe(202);
		expect((await call('POST', `/me/push-subscriptions/${id}/test`)).status).toBe(429);
		const other = (await call('POST', '/me/push-subscriptions', sub(2))).body.id;
		await call('POST', '/mock/push', { testResult: 'failed' });
		const failed = await call('POST', `/me/push-subscriptions/${other}/test`);
		expect(failed.status).toBe(502);
		expect(failed.body.error.code).toBe('push_failed');
	});
});
