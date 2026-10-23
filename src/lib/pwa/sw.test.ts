import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ version: 'v-test' }));
vi.mock('$app/manifest', () => ({
	immutable: [{ path: '_app/immutable/entry/app.abc.js' }],
	assets: [{ path: 'manifest.webmanifest' }, { path: 'icons/icon-192.png' }]
}));

type Handler = (event: any) => void;
const listeners: Record<string, Handler> = {};
const showNotification = vi.fn(async () => {});
const skipWaiting = vi.fn(async () => {});
const pushSubscribe = vi.fn();
const matchAll = vi.fn();
const openWindow = vi.fn(async () => null);
const cacheStore = new Map<string, Response>();
const cachePut = vi.fn(async (key: string | Request, response: Response) => {
	cacheStore.set(typeof key === 'string' ? key : new URL(key.url).pathname, response);
});
const cacheNames = ['tt-static-old', 'tt-static-v-test', 'unrelated'];
const deleted: string[] = [];

beforeAll(async () => {
	vi.stubGlobal('self', {
		addEventListener: (type: string, handler: Handler) => (listeners[type] = handler),
		location: { origin: 'https://app.example' },
		registration: { showNotification, pushManager: { subscribe: pushSubscribe } },
		navigator: { userAgent: 'SW-Test/1.0' },
		clients: { matchAll, openWindow, claim: vi.fn(async () => {}) },
		skipWaiting
	});
	vi.stubGlobal('caches', {
		open: async () => ({
			match: async (key: string | Request) => cacheStore.get(typeof key === 'string' ? key : new URL(key.url).pathname),
			put: cachePut,
			delete: vi.fn(async () => true)
		}),
		keys: async () => cacheNames,
		delete: async (name: string) => (deleted.push(name), true)
	});
	await import('../../service-worker');
});

beforeEach(() => {
	showNotification.mockClear();
	matchAll.mockReset();
	openWindow.mockClear();
	skipWaiting.mockClear();
});

function pushEvent(text: string | null) {
	const waits: Promise<unknown>[] = [];
	listeners.push({ data: text === null ? null : { text: () => text }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
	return Promise.all(waits);
}

function clickEvent(data: unknown) {
	const waits: Promise<unknown>[] = [];
	const close = vi.fn();
	listeners.notificationclick({ notification: { data, close }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
	return Promise.all(waits).then(() => close);
}

describe('lifecycle', () => {
	it('precaches build assets, static files and the shell, and does not skip waiting on install', async () => {
		const fetched: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
			fetched.push(new URL(req.url).pathname);
			const html = new URL(req.url).pathname === '/index.html';
			return new Response('x', { status: 200, headers: { 'content-type': html ? 'text/html' : 'text/javascript' } });
		}));
		const waits: Promise<unknown>[] = [];
		listeners.install({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
		await Promise.all(waits);
		expect(fetched).toEqual(['/_app/immutable/entry/app.abc.js', '/manifest.webmanifest', '/icons/icon-192.png', '/index.html']);
		expect(cachePut).toHaveBeenCalledTimes(4);
		expect(skipWaiting).not.toHaveBeenCalled();
	});

	it('fails the install instead of caching HTML for a script URL', async () => {
		cachePut.mockClear();
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })));
		const waits: Promise<unknown>[] = [];
		listeners.install({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
		await expect(Promise.all(waits)).rejects.toThrow(/unusable response/);
		expect(cachePut).not.toHaveBeenCalledWith('/_app/immutable/entry/app.abc.js', expect.anything());
	});

	it('activates a new version only after the SKIP_WAITING message', () => {
		listeners.message({ data: { type: 'something' } });
		expect(skipWaiting).not.toHaveBeenCalled();
		listeners.message({ data: { type: 'SKIP_WAITING' } });
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});

	it('removes only older tt- caches on activate', async () => {
		const waits: Promise<unknown>[] = [];
		listeners.activate({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
		await Promise.all(waits);
		expect(deleted).toEqual(['tt-static-old']);
	});
});

describe('fetch', () => {
	const run = async (url: string, init: { method?: string; mode?: string } = {}) => {
		let responded: Promise<Response> | null = null;
		listeners.fetch({
			request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
			respondWith: (p: Promise<Response>) => (responded = p)
		});
		return responded as Promise<Response> | null;
	};

	it('does not intercept API, OAuth, MCP, discovery, probes, writes or cross-origin requests', async () => {
		for (const url of [
			'https://app.example/api/v1/notifications',
			'https://app.example/oauth/consent',
			'https://app.example/mcp',
			'https://app.example/.well-known/oauth-protected-resource',
			'https://app.example/health',
			'https://app.example/ready',
			'https://other.example/_app/immutable/entry/app.abc.js'
		]) {
			expect(await run(url, { mode: 'navigate' }), url).toBeNull();
		}
		expect(await run('https://app.example/time', { method: 'POST' })).toBeNull();
	});

	it('answers precached assets from the cache and offline navigations with /offline', async () => {
		cacheStore.set('/icons/icon-192.png', new Response('icon'));
		const asset = await run('https://app.example/icons/icon-192.png');
		expect(await (await asset)!.text()).toBe('icon');

		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
		cacheStore.set('/index.html', new Response('shell'));
		const nav = await run('https://app.example/time', { mode: 'navigate' });
		const res = await nav!;
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('https://app.example/offline');
		const offlinePage = await run('https://app.example/offline', { mode: 'navigate' });
		expect(await (await offlinePage)!.text()).toBe('shell');
	});

	it('serves the static offline page instead of redirecting when the SPA shell is not cached', async () => {
		cacheStore.delete('/index.html');
		cacheStore.set('/offline.html', new Response('<h1>Keine Verbindung</h1>'));
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
		const res = await (await run('https://app.example/time', { mode: 'navigate' }))!;
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Keine Verbindung');
		cacheStore.delete('/offline.html');
		const bare = await (await run('https://app.example/time', { mode: 'navigate' }))!;
		expect(bare.status).toBe(503);
		vi.unstubAllGlobals();
	});
});

describe('push', () => {
	it('shows the notification from the JSON payload with icon, badge and tag', async () => {
		await pushEvent(JSON.stringify({ title: 'Berichtsheft-Erinnerung', body: 'Öffne Timetrack für Details.', url: '/reports', tag: 'report_gap:2026-W42', kind: 'report_gap' }));
		expect(showNotification).toHaveBeenCalledWith('Berichtsheft-Erinnerung', {
			body: 'Öffne Timetrack für Details.',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			tag: 'report_gap:2026-W42',
			data: { url: '/reports', kind: 'report_gap' }
		});
	});

	it('tolerates empty and malformed payloads with a generic German message', async () => {
		for (const raw of [null, 'oops', '{"title":']) {
			showNotification.mockClear();
			await pushEvent(raw);
			expect(showNotification).toHaveBeenCalledTimes(1);
			const [title, options] = showNotification.mock.calls[0] as unknown as [string, { body: string; data: { url: string } }];
			expect(title).toBe('Timetrack');
			expect(options.body).toBe('Öffne Timetrack für Details.');
			expect(options.data.url).toBe('/');
		}
	});
});

describe('notificationclick', () => {
	it('focuses an existing same-origin window and asks it to navigate', async () => {
		const client = { url: 'https://app.example/time', focus: vi.fn(async () => {}), postMessage: vi.fn() };
		matchAll.mockResolvedValue([{ url: 'https://other.example/', focus: vi.fn(), postMessage: vi.fn() }, client]);
		const close = await clickEvent({ url: '/absences' });
		expect(close).toHaveBeenCalled();
		expect(client.focus).toHaveBeenCalled();
		expect(client.postMessage).toHaveBeenCalledWith({ type: 'NAVIGATE', url: '/absences' });
		expect(openWindow).not.toHaveBeenCalled();
	});

	it('opens a new window when none exists, and never follows non-relative urls', async () => {
		matchAll.mockResolvedValue([]);
		await clickEvent({ url: '/reports' });
		expect(openWindow).toHaveBeenLastCalledWith('/reports');
		await clickEvent({ url: 'https://evil.example/phish' });
		expect(openWindow).toHaveBeenLastCalledWith('/');
		await clickEvent(null);
		expect(openWindow).toHaveBeenLastCalledWith('/');
	});
});

describe('pushsubscriptionchange', () => {
	const subscription = (endpoint: string) => ({ endpoint, toJSON: () => ({ keys: { p256dh: 'pk', auth: 'ak' } }), getKey: () => null });

	it('re-subscribes with the old key and replaces the stored subscription', async () => {
		pushSubscribe.mockResolvedValue(subscription('https://push.example/new'));
		const requests: { url: string; init?: RequestInit }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				requests.push({ url, init });
				return url.endsWith('/auth/session') ? new Response(JSON.stringify({ csrfToken: 'tok' })) : new Response('{}', { status: 200 });
			})
		);
		const waits: Promise<unknown>[] = [];
		const old = { ...subscription('https://push.example/old'), options: { applicationServerKey: new Uint8Array([9, 9]).buffer } };
		listeners.pushsubscriptionchange({ oldSubscription: old, newSubscription: null, waitUntil: (p: Promise<unknown>) => waits.push(p) });
		expect(await waits[0]).toBe('replaced');
		expect(pushSubscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
		const post = requests.find((r) => r.init?.method === 'POST')!;
		expect(post.url).toBe('/api/v1/me/push-subscriptions/replace');
		expect(JSON.parse(post.init!.body as string)).toMatchObject({ previousEndpoint: 'https://push.example/old', endpoint: 'https://push.example/new', keys: { p256dh: 'pk', auth: 'ak' }, userAgent: 'SW-Test/1.0' });
	});
});
