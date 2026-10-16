import { describe, expect, it, vi } from 'vitest';
import { handleSubscriptionChange, replaceBody, type ChangeDeps, type SubscriptionLike } from './subscription-change';

function subscription(endpoint: string, key?: number[]): SubscriptionLike {
	return {
		endpoint,
		options: key ? { applicationServerKey: new Uint8Array(key).buffer } : undefined,
		toJSON: () => ({ keys: { p256dh: `p-${endpoint}`, auth: `a-${endpoint}` } }),
		getKey: () => null
	};
}

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

function setup(routes: Record<string, () => Response>, subscribed?: SubscriptionLike) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const subscribe = vi.fn(async (_key: Uint8Array<ArrayBuffer>) => subscribed ?? subscription('https://push.example/new'));
	const deps: ChangeDeps = {
		fetch: async (url, init) => {
			calls.push({ url, init });
			const route = routes[`${init?.method ?? 'GET'} ${url}`];
			return route ? route() : json(404);
		},
		subscribe,
		userAgent: 'TestAgent/1.0',
		keyToBytes: (key) => new Uint8Array([...key].map((c) => c.charCodeAt(0)))
	};
	return { deps, calls, subscribe };
}

const session = () => json(200, { csrfToken: 'csrf-1' });

describe('replaceBody', () => {
	it('sends previousEndpoint, new endpoint, keys and a truncated user agent', () => {
		const body = replaceBody(subscription('https://push.example/old'), subscription('https://push.example/new'), 'x'.repeat(300));
		expect(body).toEqual({
			previousEndpoint: 'https://push.example/old',
			endpoint: 'https://push.example/new',
			keys: { p256dh: 'p-https://push.example/new', auth: 'a-https://push.example/new' },
			userAgent: 'x'.repeat(200)
		});
	});
	it('omits previousEndpoint when the old subscription is unknown and falls back to getKey', () => {
		const next: SubscriptionLike = { endpoint: 'https://p/e', toJSON: () => ({}), getKey: (name) => new Uint8Array(name === 'p256dh' ? [251, 255] : [1, 2, 3]).buffer };
		const body = replaceBody(null, next, 'ua');
		expect(body).not.toHaveProperty('previousEndpoint');
		expect(body.keys).toEqual({ p256dh: '-_8', auth: 'AQID' });
	});
});

describe('handleSubscriptionChange', () => {
	it('uses the new subscription supplied by the browser, with the CSRF token from the session', async () => {
		const { deps, calls, subscribe } = setup({
			'GET /api/v1/auth/session': session,
			'POST /api/v1/me/push-subscriptions/replace': () => json(200, {})
		});
		const result = await handleSubscriptionChange(subscription('https://push.example/old'), subscription('https://push.example/given'), deps);
		expect(result).toBe('replaced');
		expect(subscribe).not.toHaveBeenCalled();
		const post = calls.find((c) => c.init?.method === 'POST')!;
		expect((post.init!.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1');
		expect(post.init!.credentials).toBe('include');
		expect(JSON.parse(post.init!.body as string)).toMatchObject({ previousEndpoint: 'https://push.example/old', endpoint: 'https://push.example/given', userAgent: 'TestAgent/1.0' });
	});

	it('re-subscribes with the application server key of the old subscription', async () => {
		const { deps, subscribe, calls } = setup({
			'GET /api/v1/auth/session': session,
			'POST /api/v1/me/push-subscriptions/replace': () => json(201, {})
		});
		const result = await handleSubscriptionChange(subscription('https://push.example/old', [4, 5, 6]), null, deps);
		expect(result).toBe('replaced');
		expect([...subscribe.mock.calls[0][0]]).toEqual([4, 5, 6]);
		expect(calls.some((c) => c.url.endsWith('/push/config'))).toBe(false);
	});

	it('asks the server for the VAPID key when the old subscription has none', async () => {
		const { deps, subscribe } = setup({
			'GET /api/v1/auth/session': session,
			'GET /api/v1/push/config': () => json(200, { available: true, vapidPublicKey: 'AB' }),
			'POST /api/v1/me/push-subscriptions/replace': () => json(200, {})
		});
		expect(await handleSubscriptionChange(null, null, deps)).toBe('replaced');
		expect([...subscribe.mock.calls[0][0]]).toEqual([65, 66]);
	});

	it('does nothing without a session (401)', async () => {
		const { deps, calls } = setup({ 'GET /api/v1/auth/session': () => json(401) });
		expect(await handleSubscriptionChange(subscription('o'), subscription('n'), deps)).toBe('no_session');
		expect(calls).toHaveLength(1);
	});

	it('reports unavailable when push is not configured', async () => {
		const noConfig = setup({ 'GET /api/v1/auth/session': session, 'GET /api/v1/push/config': () => json(200, { available: false }) });
		expect(await handleSubscriptionChange(null, null, noConfig.deps)).toBe('unavailable');
		const refused = setup({ 'GET /api/v1/auth/session': session, 'POST /api/v1/me/push-subscriptions/replace': () => json(501, {}) });
		expect(await handleSubscriptionChange(subscription('o'), subscription('n'), refused.deps)).toBe('unavailable');
	});

	it('reports failed on server errors, 409 and thrown network errors', async () => {
		const conflict = setup({ 'GET /api/v1/auth/session': session, 'POST /api/v1/me/push-subscriptions/replace': () => json(409, {}) });
		expect(await handleSubscriptionChange(subscription('o'), subscription('n'), conflict.deps)).toBe('failed');
		const broken = setup({});
		broken.deps.fetch = async () => {
			throw new TypeError('offline');
		};
		expect(await handleSubscriptionChange(subscription('o'), subscription('n'), broken.deps)).toBe('failed');
		const noToken = setup({ 'GET /api/v1/auth/session': () => json(200, {}) });
		expect(await handleSubscriptionChange(subscription('o'), subscription('n'), noToken.deps)).toBe('failed');
	});

	it('fails when subscribing throws (permission revoked)', async () => {
		const { deps } = setup({ 'GET /api/v1/auth/session': session });
		deps.subscribe = async () => {
			throw new DOMException('denied', 'NotAllowedError');
		};
		expect(await handleSubscriptionChange(subscription('o', [1]), null, deps)).toBe('failed');
	});
});
