import { describe, expect, it } from 'vitest';
import { isUsableAssetResponse } from './core';

describe('isUsableAssetResponse', () => {
	it('rejects HTML answers for asset URLs (SPA fallback for a missing hashed file)', () => {
		expect(isUsableAssetResponse('/_app/immutable/entry/app.abc.js', true, 'text/html; charset=utf-8')).toBe(false);
		expect(isUsableAssetResponse('/_app/immutable/assets/x.css', true, 'TEXT/HTML')).toBe(false);
		expect(isUsableAssetResponse('/manifest.webmanifest', true, 'text/html')).toBe(false);
	});
	it('rejects failed responses and accepts real assets', () => {
		expect(isUsableAssetResponse('/_app/immutable/entry/app.abc.js', false, 'text/javascript')).toBe(false);
		expect(isUsableAssetResponse('/_app/immutable/entry/app.abc.js', true, 'text/javascript; charset=utf-8')).toBe(true);
		expect(isUsableAssetResponse('/icons/icon-192.png', true, null)).toBe(true);
	});
	it('allows HTML for the shell and extension-less documents', () => {
		expect(isUsableAssetResponse('/index.html', true, 'text/html')).toBe(true);
		expect(isUsableAssetResponse('/offline', true, 'text/html')).toBe(true);
		expect(isUsableAssetResponse('/index.html', false, 'text/html')).toBe(false);
	});
});
