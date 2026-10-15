import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors.js';
import { WebAuthnError } from '../webauthn.js';
import { de } from './de.js';
import { OIDC_ERROR_CODES } from '../api/types.js';
import { MCP_SCOPES } from '../mcp/scopes.js';
import { errorMessage, oidcErrorMessage, scopeText, t } from './index.js';

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
		const mockSource = readFileSync('mock/api.ts', 'utf8') + readFileSync('mock/time.ts', 'utf8') + readFileSync('mock/planning.ts', 'utf8') + readFileSync('mock/transfer.ts', 'utf8') + readFileSync('mock/reports.ts', 'utf8') + readFileSync('mock/mcp.ts', 'utf8') + readFileSync('mock/notifications.ts', 'utf8');
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

	it('has a German message for every OIDC callback error code and falls back to oidc_failed', () => {
		for (const code of OIDC_ERROR_CODES) {
			expect(`oidc.error.${code}` in de, code).toBe(true);
			expect(oidcErrorMessage(code), code).not.toContain('oidc_');
		}
		expect(oidcErrorMessage('oidc_not_linked')).toContain('per Einladung');
		expect(oidcErrorMessage('oidc_not_linked')).toContain('Einstellungen');
		expect(oidcErrorMessage('something_new')).toBe(de['oidc.error.oidc_failed']);
	});

	it('maps last_login_method and reauth_required to German', () => {
		expect(errorMessage(new ApiError(409, 'last_login_method'))).toBe(de['error.last_login_method']);
		expect(errorMessage(new ApiError(403, 'reauth_required'))).toContain('erneut an');
	});

	it('has a plain-language German label and description for every MCP scope', () => {
		for (const scope of MCP_SCOPES) {
			const { label, description } = scopeText(scope);
			expect(label.trim(), scope).not.toBe('');
			expect(description.length, scope).toBeGreaterThan(15);
			expect(label + description, scope).not.toContain(':');
		}
		expect(scopeText('time:read').description).toBe('Zeitbuchungen, Tagesübersichten und Zeitkonto lesen');
		expect(scopeText('time:write').description).toBe('Zeiten erfassen und korrigieren');
	});
});
