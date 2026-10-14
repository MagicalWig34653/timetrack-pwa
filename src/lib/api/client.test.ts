import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../mock/fetch.ts';
import { splitRange } from '../time/dates.js';
import { api, ApiError, mergeSharedViews, setCsrfToken } from './client.js';

describe('api client', () => {
	let mock: ReturnType<typeof createMockFetch>;

	beforeEach(() => {
		mock = createMockFetch();
		vi.stubGlobal('fetch', mock.fetch);
		setCsrfToken(null);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('sends cookies and omits the CSRF header on GET requests', async () => {
		await expect(api.currentSession()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
		expect(mock.calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/auth/session', credentials: 'include' });
		expect(mock.calls[0].csrf).toBeUndefined();
	});

	it('accepts a bodyless 202 response (PUT /me/recovery/email)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })));
		await expect(api.enableEmailRecovery('user@example.org')).resolves.toBeUndefined();
	});

	it('adopts the CSRF token from a session response and sends it on mutating calls', async () => {
		const options = await api.loginOptions();
		const session = await api.loginVerify(options.challengeId, { id: 'mock-login' });
		expect(session.account.handle).toBe('admin');
		await api.revokeOtherSessions();
		const call = mock.calls.at(-1)!;
		expect(call).toMatchObject({ method: 'DELETE', path: '/api/v1/me/sessions' });
		expect(call.csrf).toBe(session.csrfToken);
	});

	it('rejects mutating calls with a wrong CSRF token using a uniform ApiError', async () => {
		const options = await api.loginOptions();
		await api.loginVerify(options.challengeId, { id: 'mock-login' });
		setCsrfToken('wrong');
		const error = await api.revokeOtherSessions().catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 403, code: 'csrf_invalid' });
	});

	it('maps network failures to code network_error', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
		await expect(api.listPasskeys()).rejects.toMatchObject({ status: 0, code: 'network_error' });
	});

	it('falls back to an http_<status> code for non-JSON error bodies', async () => {
		vi.stubGlobal('fetch', async () => new Response('<html>bad gateway</html>', { status: 502 }));
		await expect(api.listPasskeys()).rejects.toMatchObject({ status: 502, code: 'http_502' });
	});

	it('returns undefined for 204 responses', async () => {
		const options = await api.loginOptions();
		await api.loginVerify(options.challengeId, { id: 'mock-login' });
		await expect(api.revokeOtherSessions()).resolves.toBeUndefined();
	});
});

describe('range helpers', () => {
	it('splits ranges into chunks of at most N days', () => {
		expect(splitRange('2026-01-01', '2026-01-03', 5)).toEqual([{ from: '2026-01-01', to: '2026-01-03' }]);
		expect(splitRange('2026-01-01', '2026-01-10', 4)).toEqual([
			{ from: '2026-01-01', to: '2026-01-04' },
			{ from: '2026-01-05', to: '2026-01-08' },
			{ from: '2026-01-09', to: '2026-01-10' }
		]);
	});

	it('merges chunked shared views and overlapping vacation periods', () => {
		const merged = mergeSharedViews([
			{ plan: [{ date: '2026-01-01', mode: 'office' }], vacation: [{ startDate: '2026-12-28', endDate: '2027-01-01' }] },
			{ plan: [{ date: '2027-01-05', mode: 'home' }], vacation: [{ startDate: '2026-12-30', endDate: '2027-01-03' }] }
		]);
		expect(merged.plan).toHaveLength(2);
		expect(merged.vacation).toEqual([{ startDate: '2026-12-28', endDate: '2027-01-03' }]);
		expect(merged.actual).toBeUndefined();
	});
});
