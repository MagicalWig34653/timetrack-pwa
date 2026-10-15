/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { cacheNameFor, isInterceptable, isOldCache, parsePushPayload, safeRelativeUrl } from './lib/pwa/core';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Strategy (ADR-0010): precache build assets ($app/manifest, SvelteKit 3) + static files + the SPA shell; hashed assets cache-first; navigations
// network-first with /offline as fallback. API, OAuth, MCP, discovery and probe paths and cross-origin requests are
// never touched. No offline writing.
const CACHE = cacheNameFor(version);
const SHELL = '/index.html';
const OFFLINE_PATH = '/offline';
// manifest paths are relative to the base path (no leading slash); the app is served from the origin root
const absolute = (path: string) => '/' + path.replace(/^\/+/, '');
const PRECACHE = [...new Set([...immutable.map((entry) => absolute(entry.path)), ...assets.map((entry) => absolute(entry.path)), SHELL])];
const PRECACHED = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	// No skipWaiting here: a new version waits until the user confirms the update banner (SKIP_WAITING message).
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((path) => new Request(sw.location.origin + path, { cache: 'reload' }))))
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
		const shell = await (await caches.open(CACHE)).match(SHELL);
		if (url.pathname === OFFLINE_PATH && shell) return shell;
		return Response.redirect(sw.location.origin + OFFLINE_PATH, 302);
	}
}

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok && response.type === 'basic') void cache.put(request, response.clone());
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
