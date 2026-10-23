/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { base64urlToBytes, cacheNameFor, isInterceptable, isOldCache, isUsableAssetResponse, parsePushPayload, safeRelativeUrl } from './lib/pwa/core';
import { handleSubscriptionChange, type SubscriptionLike } from './lib/pwa/subscription-change';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Strategy (ADR-0010): precache build assets ($app/manifest, SvelteKit 3) + static files + the SPA shell; hashed assets cache-first; navigations
// network-first with /offline as fallback. API, OAuth, MCP, discovery and probe paths and cross-origin requests are
// never touched. No offline writing.
const CACHE = cacheNameFor(version);
const SHELL = '/index.html';
const OFFLINE_PATH = '/offline';
// self-contained static fallback (static/offline.html, precached) for when even the SPA shell is missing from the cache
const OFFLINE_HTML = '/offline.html';
// manifest paths are relative to the base path (no leading slash); the app is served from the origin root
const absolute = (path: string) => '/' + path.replace(/^\/+/, '');
const PRECACHE = [...new Set([...immutable.map((entry) => absolute(entry.path)), ...assets.map((entry) => absolute(entry.path)), SHELL])];
const PRECACHED = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	// No skipWaiting here: a new version waits until the user confirms the update banner (SKIP_WAITING message).
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// Not cache.addAll(): a server that answers the SPA shell (HTML) for a missing .js file would be stored as that file.
			// Any unusable response fails the install, so the previous worker and its caches stay in charge.
			await Promise.all(
				PRECACHE.map(async (path) => {
					const response = await fetch(new Request(sw.location.origin + path, { cache: 'reload' }));
					if (!isUsableAssetResponse(path, response.ok, response.headers.get('content-type'))) throw new Error(`precache: unusable response for ${path}`);
					await cache.put(path, response);
				})
			);
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const name of await caches.keys()) if (isOldCache(name, version)) await caches.delete(name);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (!isInterceptable(url, request.method, sw.location.origin)) return;

	if (request.mode === 'navigate') {
		event.respondWith(navigate(request, url));
		return;
	}
	if (PRECACHED.has(url.pathname) || url.pathname.startsWith('/_app/immutable/')) {
		event.respondWith(cacheFirst(request));
	}
});

async function navigate(request: Request, url: URL): Promise<Response> {
	try {
		return await fetch(request);
	} catch {
		const cache = await caches.open(CACHE);
		const shell = await cache.match(SHELL);
		if (url.pathname === OFFLINE_PATH && shell) return shell;
		if (shell) return Response.redirect(sw.location.origin + OFFLINE_PATH, 302);
		// No shell cached (install never completed, cache evicted): never redirect into a loop, show the static page instead.
		const fallback = await cache.match(OFFLINE_HTML);
		return fallback ?? new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
	}
}

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const pathname = new URL(request.url).pathname;
	// icons and the manifest are linked with ?v=<n> (cache busting); the precache holds them by path
	const hit = await cache.match(request, { ignoreSearch: PRECACHED.has(pathname) });
	if (hit && isUsableAssetResponse(pathname, hit.ok, hit.headers.get('content-type'))) return hit;
	if (hit) await cache.delete(request);
	const response = await fetch(request);
	if (isUsableAssetResponse(pathname, response.ok, response.headers.get('content-type'))) {
		if (response.type === 'basic') void cache.put(request, response.clone());
		return response;
	}
	// HTML (or an error) for an asset URL: never cache it and never hand a document to a script/style loader.
	if (response.ok) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
	return response;
}

sw.addEventListener('push', (event) => {
	let raw: string | null = null;
	try {
		raw = event.data ? event.data.text() : null;
	} catch {
		raw = null;
	}
	const payload = parsePushPayload(raw);
	event.waitUntil(
		sw.registration.showNotification(payload.title, {
			body: payload.body,
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			tag: payload.tag,
			data: { url: payload.url, kind: payload.kind }
		})
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = safeRelativeUrl((event.notification.data as { url?: unknown } | null)?.url) ?? '/';
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const existing = windows.find((client) => new URL(client.url).origin === sw.location.origin);
			if (existing) {
				try {
					await existing.focus();
					existing.postMessage({ type: 'NAVIGATE', url: target });
					return;
				} catch {
					// fall through to opening a new window
				}
			}
			await sw.clients.openWindow(target);
		})()
	);
});

// The push service rotated or expired the subscription: subscribe again and tell the server (B2, ADR-0017).
sw.addEventListener('pushsubscriptionchange', (event) => {
	const change = event as unknown as { oldSubscription?: SubscriptionLike | null; newSubscription?: SubscriptionLike | null; waitUntil(promise: Promise<unknown>): void };
	change.waitUntil(
		handleSubscriptionChange(change.oldSubscription ?? null, change.newSubscription ?? null, {
			fetch: (input, init) => fetch(input, init),
			subscribe: (applicationServerKey) => sw.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }) as Promise<SubscriptionLike>,
			userAgent: sw.navigator.userAgent,
			keyToBytes: base64urlToBytes
		})
	);
});
