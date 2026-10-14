import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors.js';
import { WebAuthnError } from '../webauthn.js';
import { de } from './de.js';
import { errorMessage, t } from './index.js';

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
	});
}

describe('localization resource', () => {
	it('uses English dot-separated keys and non-empty German values', () => {
		for (const [key, value] of Object.entries(de)) {
			expect(key, key).toMatch(/^[a-z0-9_.-]+$/);
			expect(value.trim(), key).not.toBe('');
		}
	});

	it('defines every key referenced literally via t()', () => {
		const missing: string[] = [];
		for (const file of sourceFiles('src')) {
			const text = readFileSync(file, 'utf8');
			for (const match of text.matchAll(/\bt\(\s*['"]([a-z0-9_.-]+)['"]/g)) {
				if (!(match[1] in de)) missing.push(`${file}: ${match[1]}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it('maps every error code emitted by the mock API to a German message', () => {
		const mockSource = readFileSync('mock/api.ts', 'utf8') + readFileSync('mock/time.ts', 'utf8') + readFileSync('mock/planning.ts', 'utf8') + readFileSync('mock/transfer.ts', 'utf8');
		const codes = [...mockSource.matchAll(/(?:error|fail)\(\d+, '([a-z_]+)'/g)].map((m) => m[1]);
		expect(codes.length).toBeGreaterThan(5);
		for (const code of codes) expect(`error.${code}` in de, code).toBe(true);
	});

	it('does not leak technical codes in user messages', () => {
		expect(errorMessage(new ApiError(409, 'last_passkey', 'raw'))).toContain('Passkey');
		expect(errorMessage(new ApiError(429, 'something_new'))).toBe(de['error.status_429']);
		expect(errorMessage(new ApiError(418, 'teapot'))).toBe(de['error.unknown']);
		expect(errorMessage(new ApiError(0, 'network_error'))).toBe(de['error.network_error']);
		expect(errorMessage(new WebAuthnError('cancelled'))).toBe(de['webauthn.cancelled']);
		expect(errorMessage(new Error('boom'))).toBe(de['error.unknown']);
	});

	it('fills placeholders', () => {
		expect(t('home.title', { name: 'Mia' })).toBe('Hallo, Mia');
	});
});
