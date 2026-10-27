import { dePwa } from '../i18n/de-pwa';

// Pure helpers shared by the service worker and the page. No DOM, no `$service-worker` imports, so they are unit-testable.

/** Paths the service worker must never cache or intercept (API, OAuth, MCP, discovery, probes). */
export const BYPASS_PREFIXES = ['/api', '/oauth', '/mcp', '/.well-known', '/health', '/ready', '/t', '/ics'] as const;

export function isBypassPath(pathname: string): boolean {
	return BYPASS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

/** True when the service worker may answer this request itself: same-origin GET outside the bypass list. */
export function isInterceptable(url: URL, method: string, origin: string): boolean {
	return method === 'GET' && url.origin === origin && !isBypassPath(url.pathname);
}

/**
 * Accepts only same-origin relative targets ("/reports", "/time?x=1"). Everything else (absolute URLs, protocol-relative
 * "//host", "javascript:", backslashes, control characters) yields null so push payloads cannot navigate elsewhere.
 */
export function safeRelativeUrl(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0 || value.length > 500) return null;
	if (!value.startsWith('/') || value.startsWith('//')) return null;
	if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
	try {
		const probe = new URL(value, 'https://origin.invalid');
		if (probe.origin !== 'https://origin.invalid') return null;
		return probe.pathname + probe.search + probe.hash;
	} catch {
		return null;
	}
}

/** Offline fallback URL that remembers the requested page (`/offline?from=<path>`). */
export function offlineUrlFor(requested: string): string {
	const target = returnTargetFromParam(requested);
	return target ? `/offline?from=${encodeURIComponent(target)}` : '/offline';
}

/**
 * Validates the `from` parameter of the offline page: a same-origin relative path that is not the offline page itself
 * (no loop). Anything else yields null, so the parameter can never act as an open redirect.
 */
export function returnTargetFromParam(value: unknown): string | null {
	const safe = safeRelativeUrl(value);
	if (!safe) return null;
	const path = safe.split(/[?#]/)[0];
	if (path === '/offline' || path === '/offline.html' || path.startsWith('/offline/')) return null;
	return safe;
}

export interface PushPayload {
	title: string;
	body: string;
	url: string;
	tag: string | undefined;
	kind: string | undefined;
}

export const PUSH_FALLBACK: PushPayload = {
	title: dePwa['pwa.push_fallback_title'],
	body: dePwa['pwa.push_fallback_body'],
	url: '/',
	tag: undefined,
	kind: undefined
};

const text = (value: unknown, max: number): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/** Parses the push body `{title, body, url, tag, kind}`; anything malformed falls back to a generic German message. */
export function parsePushPayload(raw: string | null | undefined): PushPayload {
	if (!raw) return { ...PUSH_FALLBACK };
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ...PUSH_FALLBACK };
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ...PUSH_FALLBACK };
	const record = data as Record<string, unknown>;
	return {
		title: text(record.title, 120) ?? PUSH_FALLBACK.title,
		body: text(record.body, 300) ?? PUSH_FALLBACK.body,
		url: safeRelativeUrl(record.url) ?? '/',
		tag: text(record.tag, 100),
		kind: text(record.kind, 40)
	};
}

/** Converts a base64url string (VAPID public key) to the bytes `pushManager.subscribe` expects. */
export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Bytes (ArrayBuffer from `getKey`) to unpadded base64url, the format of the subscription keys in the API. */
export function bytesToBase64url(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cache name for a build version; older `tt-` caches are removed on activation. */
export const CACHE_PREFIX = 'tt-static-';
export const cacheNameFor = (version: string) => CACHE_PREFIX + version;
export const isOldCache = (name: string, version: string) => name.startsWith(CACHE_PREFIX) && name !== cacheNameFor(version);

/** iOS Safari (incl. iPadOS reporting as Mac with touch) needs the app on the home screen for push. */
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
	return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** True for the SPA shell and other documents; only these may be HTML. */
const isDocumentPath = (pathname: string) => pathname === '/index.html' || pathname === '/offline' || pathname === '/offline.html' || !/\.[A-Za-z0-9]+$/.test(pathname);

/**
 * Guards the cache against the "HTML answered for an asset" failure (a server falling back to the SPA shell for a
 * missing hashed file). A response may be cached or served for `pathname` only when it is OK and, unless the path is a
 * document, is not text/html.
 */
export function isUsableAssetResponse(pathname: string, ok: boolean, contentType: string | null): boolean {
	if (!ok) return false;
	if (isDocumentPath(pathname)) return true;
	return !/text\/html/i.test(contentType ?? '');
}
