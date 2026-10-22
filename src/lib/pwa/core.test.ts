import { describe, expect, it } from 'vitest';
import {
	base64urlToBytes,
	bytesToBase64url,
	cacheNameFor,
	isBypassPath,
	isInterceptable,
	isIosDevice,
	isOldCache,
	parsePushPayload,
	PUSH_FALLBACK,
	safeRelativeUrl
} from './core';
import { shouldRegisterServiceWorker } from './pwa.svelte';

describe('base64url key conversion', () => {
	it('converts the 65-byte VAPID public key and round-trips', () => {
		const key = 'BBBor-TQmvD66r1vNEeVc7YYNaBaQZ20EWY8wS8fJ-FK305b4uT_i8mI444mmfMe7699EtyIV6zHkjH0d90k_Dw';
		const bytes = base64urlToBytes(key);
		expect(bytes.length).toBe(65);
		expect(bytes[0]).toBe(4);
		expect(bytesToBase64url(bytes)).toBe(key);
	});

	it('handles url-safe characters and missing padding', () => {
		expect(Array.from(base64urlToBytes('-_8'))).toEqual([0xfb, 0xff]);
		expect(bytesToBase64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
		expect(bytesToBase64url(new Uint8Array([]).buffer)).toBe('');
	});
});

describe('safeRelativeUrl', () => {
	it('accepts same-origin relative paths with query and hash', () => {
		expect(safeRelativeUrl('/')).toBe('/');
		expect(safeRelativeUrl('/reports')).toBe('/reports');
		expect(safeRelativeUrl('/time/2026-10-14?x=1#top')).toBe('/time/2026-10-14?x=1#top');
	});

	it('rejects absolute, protocol-relative, scheme and malformed targets', () => {
		for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'reports', '', '/a\nb', '/\t/evil', null, undefined, 42, {}]) {
			expect(safeRelativeUrl(bad), String(bad)).toBeNull();
		}
		expect(safeRelativeUrl('/' + 'a'.repeat(600))).toBeNull();
	});
});

describe('parsePushPayload', () => {
	it('reads the C18 payload', () => {
		const p = parsePushPayload(JSON.stringify({ title: 'Timer läuft noch', body: 'Öffne Timetrack für Details.', url: '/', tag: 'running_timer:1', kind: 'running_timer' }));
		expect(p).toEqual({ title: 'Timer läuft noch', body: 'Öffne Timetrack für Details.', url: '/', tag: 'running_timer:1', kind: 'running_timer' });
	});

	it('falls back to the generic German message for missing, malformed or hostile input', () => {
		for (const raw of [null, undefined, '', 'not json', '[]', '"text"', '123', 'null']) {
			expect(parsePushPayload(raw)).toEqual(PUSH_FALLBACK);
		}
		expect(PUSH_FALLBACK.title).toBe('Timetrack');
		expect(PUSH_FALLBACK.body).toBe('Öffne Timetrack für Details.');
	});

	it('keeps valid fields and replaces invalid ones; a foreign url becomes "/"', () => {
		const p = parsePushPayload(JSON.stringify({ title: 5, body: '  ', url: 'https://evil.example/x', tag: 'a' }));
		expect(p.title).toBe(PUSH_FALLBACK.title);
		expect(p.body).toBe(PUSH_FALLBACK.body);
		expect(p.url).toBe('/');
		expect(p.tag).toBe('a');
	});
});

describe('request interception rules', () => {
	const origin = 'https://app.example';
	it('never touches API, OAuth, MCP, discovery and probes', () => {
		for (const p of ['/api/v1/time/segments', '/api', '/oauth/consent', '/oauth/authorize', '/mcp', '/.well-known/oauth-authorization-server', '/health', '/ready', '/t', '/t/abc/start', '/t/abc/toggle?at=2026-10-22T08:00:00Z']) {
			expect(isBypassPath(p), p).toBe(true);
			expect(isInterceptable(new URL(p, origin), 'GET', origin), p).toBe(false);
		}
	});

	it('intercepts same-origin GET navigations and assets only', () => {
		expect(isInterceptable(new URL('/time', origin), 'GET', origin)).toBe(true);
		expect(isInterceptable(new URL('/_app/immutable/entry/app.js', origin), 'GET', origin)).toBe(true);
		expect(isInterceptable(new URL('/time', origin), 'POST', origin)).toBe(false);
		expect(isInterceptable(new URL('https://cdn.example/x.js'), 'GET', origin)).toBe(false);
		expect(isBypassPath('/apiary')).toBe(false);
		// '/t' is the trigger link prefix (ADR-0027), but must not swallow other paths that merely start with t
		expect(isBypassPath('/time')).toBe(false);
		expect(isBypassPath('/time/2026-10-15')).toBe(false);
		expect(isBypassPath('/tx')).toBe(false);
	});
});

describe('cache versioning', () => {
	it('removes only older tt- caches', () => {
		expect(isOldCache(cacheNameFor('1'), '2')).toBe(true);
		expect(isOldCache(cacheNameFor('2'), '2')).toBe(false);
		expect(isOldCache('other-cache', '2')).toBe(false);
	});
});

describe('environment helpers', () => {
	it('registers only in production (or flagged) on https/localhost', () => {
		const https = { protocol: 'https:', hostname: 'app.example' };
		const local = { protocol: 'http:', hostname: 'localhost' };
		const plain = { protocol: 'http:', hostname: 'app.example' };
		expect(shouldRegisterServiceWorker({ prod: true }, https)).toBe(true);
		expect(shouldRegisterServiceWorker({ prod: true }, local)).toBe(true);
		expect(shouldRegisterServiceWorker({ prod: true }, plain)).toBe(false);
		expect(shouldRegisterServiceWorker({ prod: false }, local)).toBe(false);
		expect(shouldRegisterServiceWorker({ prod: false, flag: '1' }, local)).toBe(true);
	});

	it('detects iOS including iPadOS in desktop mode', () => {
		expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
		expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
		expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
		expect(isIosDevice('Mozilla/5.0 (Linux; Android 14)', 5)).toBe(false);
	});
});
