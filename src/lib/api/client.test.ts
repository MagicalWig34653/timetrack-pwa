import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../mock/fetch.ts';
import { splitRange } from '../time/dates.js';
import { api, ApiError, invalidateReadCache, mergeSharedViews, retryAfterMs, setCsrfToken, setRetryDelays } from './client.js';

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

	it('sends the OIDC start purpose and invite token and adopts the CSRF token from oidcRegister', async () => {
		const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			if (body.pendingId) {
				return new Response(JSON.stringify({ account: { id: 'a', handle: 'x', displayName: 'X', role: 'member' }, csrfToken: 'csrf-oidc', recovery: false, expiresAt: '2030-01-01T00:00:00Z' }), { status: 201 });
			}
			return new Response(JSON.stringify({ authorizationUrl: 'https://idp.example/auth' }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchSpy);
		await expect(api.oidcStart('register', 'tok')).resolves.toEqual({ authorizationUrl: 'https://idp.example/auth' });
		expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/auth/oidc/start');
		expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ purpose: 'register', inviteToken: 'tok' });
		await api.oidcRegister({ pendingId: 'p', handle: 'xyz', displayName: 'X' });
		await api.unlinkIdentity('11111111-1111-1111-1111-111111111111').catch(() => undefined);
		expect((fetchSpy.mock.calls.at(-1)![1]!.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-oidc');
	});

	describe('transient failures and read cache (X1)', () => {
		const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
		beforeEach(() => {
			setRetryDelays([0, 0]);
			invalidateReadCache();
		});
		afterEach(() => setRetryDelays([400, 1200]));

		it('retries an idempotent GET after 503 and after a network error, then succeeds', async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(json(503, { error: { code: 'not_ready', message: 'x' } }))
				.mockRejectedValueOnce(new TypeError('network'))
				.mockResolvedValueOnce(json(200, []));
			vi.stubGlobal('fetch', fetchMock);
			await expect(api.listPlaces()).resolves.toEqual([]);
			expect(fetchMock).toHaveBeenCalledTimes(3);
		});

		it('gives up after the bounded number of attempts and reports the last error', async () => {
			const fetchMock = vi.fn(async () => json(503, { error: { code: 'not_ready', message: 'x' } }));
			vi.stubGlobal('fetch', fetchMock);
			await expect(api.listPlaces()).rejects.toMatchObject({ status: 503 });
			expect(fetchMock).toHaveBeenCalledTimes(3);
		});

		it('never retries mutating requests and does not retry client errors', async () => {
			const fetchMock = vi.fn(async () => json(503, { error: { code: 'not_ready', message: 'x' } }));
			vi.stubGlobal('fetch', fetchMock);
			await expect(api.revokeOtherSessions()).rejects.toMatchObject({ status: 503 });
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const notFound = vi.fn(async () => json(404, { error: { code: 'not_found', message: 'x' } }));
			vi.stubGlobal('fetch', notFound);
			await expect(api.listPlaces()).rejects.toMatchObject({ status: 404 });
			expect(notFound).toHaveBeenCalledTimes(1);
		});

		describe('database_unavailable with Retry-After (contract 0.20.0)', () => {
			const unavailable = (retryAfter: string) =>
				new Response(JSON.stringify({ error: { code: 'database_unavailable', message: 'Datenbank nicht erreichbar' } }), {
					status: 503,
					headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter }
				});
			beforeEach(() => {
				vi.useFakeTimers();
				setRetryDelays([400, 1200]);
			});
			afterEach(() => vi.useRealTimers());

			it('parses Retry-After seconds and dates and caps at 5 seconds', () => {
				expect(retryAfterMs('2')).toBe(2000);
				expect(retryAfterMs('60')).toBe(5000);
				expect(retryAfterMs(null)).toBeNull();
				expect(retryAfterMs('soon')).toBeNull();
				const now = Date.parse('2026-10-18T10:00:00Z');
				expect(retryAfterMs('Sun, 18 Oct 2026 10:00:03 GMT', now)).toBe(3000);
				expect(retryAfterMs('Sun, 18 Oct 2026 09:00:00 GMT', now)).toBe(0);
			});

			it('retries a GET twice, waiting for Retry-After (capped), then succeeds', async () => {
				const fetchMock = vi
					.fn()
					.mockResolvedValueOnce(unavailable('2'))
					.mockResolvedValueOnce(unavailable('9'))
					.mockResolvedValueOnce(json(200, []));
				vi.stubGlobal('fetch', fetchMock);
				const result = api.listPlaces();
				await vi.advanceTimersByTimeAsync(1999);
				expect(fetchMock).toHaveBeenCalledTimes(1);
				await vi.advanceTimersByTimeAsync(1);
				expect(fetchMock).toHaveBeenCalledTimes(2);
				await vi.advanceTimersByTimeAsync(4999);
				expect(fetchMock).toHaveBeenCalledTimes(2);
				await vi.advanceTimersByTimeAsync(1);
				await expect(result).resolves.toEqual([]);
				expect(fetchMock).toHaveBeenCalledTimes(3);
			});

			it('gives up after two retries with database_unavailable', async () => {
				const fetchMock = vi.fn(async () => unavailable('1'));
				vi.stubGlobal('fetch', fetchMock);
				const result = api.listPlaces().catch((e) => e);
				await vi.advanceTimersByTimeAsync(5000);
				expect(await result).toMatchObject({ status: 503, code: 'database_unavailable' });
				expect(fetchMock).toHaveBeenCalledTimes(3);
			});

			it('never retries a write and maps the code to a German message', async () => {
				const fetchMock = vi.fn(async () => unavailable('2'));
				vi.stubGlobal('fetch', fetchMock);
				const error = await api.revokeOtherSessions().catch((e) => e);
				expect(fetchMock).toHaveBeenCalledTimes(1);
				expect(error).toMatchObject({ status: 503, code: 'database_unavailable' });
				const { errorMessage } = await import('../i18n/index.js');
				expect(errorMessage(error)).toContain('Datenbank');
			});
		});

		it('serves the time account from a short cache until a write succeeds', async () => {
			const account = { asOf: '2026-10-16', balanceSeconds: 1, openingSeconds: 0, adjustmentSeconds: 0, provisional: false };
			const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'GET' ? json(200, account) : new Response(null, { status: 204 })));
			vi.stubGlobal('fetch', fetchMock);
			await api.getTimeAccount();
			await api.getTimeAccount();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			await api.revokeOtherSessions();
			await api.getTimeAccount();
			expect(fetchMock).toHaveBeenCalledTimes(3);
		});
	});
});
