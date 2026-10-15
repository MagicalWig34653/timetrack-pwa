import { describe, expect, it } from 'vitest';
import { createMockFetch } from './fetch.ts';
import { moduleOfApiPath } from './modules.ts';

async function signedIn(options?: Parameters<typeof createMockFetch>[0]) {
	const mock = createMockFetch(options);
	const call = async (method: string, path: string, body?: unknown, csrf?: string) => {
		const response = await mock.fetch(path, {
			method,
			headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : undefined };
	};
	const options1 = await call('POST', '/api/v1/auth/login/options', {});
	const login = await call('POST', '/api/v1/auth/login/verify', { challengeId: options1.body.challengeId, credential: { id: 'mock-login' } });
	const csrf = login.body.csrfToken as string;
	return { mock, get: (p: string) => call('GET', p), put: (p: string, b: unknown) => call('PUT', p, b, csrf), post: (p: string, b: unknown) => call('POST', p, b, csrf) };
}

describe('module switches mock', () => {
	it('lists five enabled modules by default', async () => {
		const { get } = await signedIn();
		const { status, body } = await get('/api/v1/modules');
		expect(status).toBe(200);
		expect(body.map((m: any) => m.key)).toEqual(['reports', 'planning', 'transfer', 'automation', 'mcp']);
		expect(body.every((m: any) => m.effective && m.serverEnabled && m.accountEnabled && !m.lockedByOperator)).toBe(true);
	});

	it('answers 404 module_disabled for the endpoints of a switched-off module and restores them', async () => {
		const { get, put } = await signedIn();
		expect((await get('/api/v1/reports/learning-fields')).status).toBe(200);
		const off = await put('/api/v1/me/modules', { modules: { reports: false } });
		expect(off.body.find((m: any) => m.key === 'reports')).toMatchObject({ accountEnabled: false, effective: false });
		const blocked = await get('/api/v1/reports/learning-fields');
		expect(blocked).toMatchObject({ status: 404, body: { error: { code: 'module_disabled' } } });
		await put('/api/v1/me/modules', { modules: { reports: true } });
		expect((await get('/api/v1/reports/learning-fields')).status).toBe(200);
	});

	it('guards every group', async () => {
		const { get, put } = await signedIn();
		await put('/api/v1/me/modules', { modules: { reports: false, planning: false, transfer: false, automation: false, mcp: false } });
		for (const path of [
			'/api/v1/reports/entries',
			'/api/v1/vacation/settings',
			'/api/v1/absences?from=2026-01-01&to=2026-12-31',
			'/api/v1/calendar/holidays?year=2026',
			'/api/v1/shares',
			'/api/v1/export/time',
			'/api/v1/imports',
			'/api/v1/me/device-tokens',
			'/api/v1/time/suggestions',
			'/api/v1/me/api-tokens',
			'/api/v1/me/oauth-grants'
		]) {
			const r = await get(path);
			expect(r, path).toMatchObject({ status: 404, body: { error: { code: 'module_disabled' } } });
		}
		// core keeps working
		expect((await get('/api/v1/time/account')).status).toBe(200);
	});

	it('refuses to switch a server-disabled module on (409 module_locked) and keeps other keys unchanged', async () => {
		const { get, put } = await signedIn({ modulesDisabled: ['mcp'] });
		const list = (await get('/api/v1/modules')).body;
		expect(list.find((m: any) => m.key === 'mcp')).toMatchObject({ serverEnabled: false, effective: false, lockedByOperator: true });
		const r = await put('/api/v1/me/modules', { modules: { mcp: true, reports: false } });
		expect(r).toMatchObject({ status: 409, body: { error: { code: 'module_locked' } } });
		expect((await get('/api/v1/modules')).body.find((m: any) => m.key === 'reports').accountEnabled).toBe(true);
	});

	it('lets the admin switch a module server-wide, which blocks the account switch', async () => {
		const { get, put } = await signedIn();
		const off = await put('/api/v1/admin/modules', { modules: { planning: false } });
		expect(off.body.find((m: any) => m.key === 'planning')).toMatchObject({ enabled: false, lockedByOperator: false });
		expect((await get('/api/v1/vacation/settings')).status).toBe(404);
		expect((await put('/api/v1/me/modules', { modules: { planning: true } })).status).toBe(409);
		await put('/api/v1/admin/modules', { modules: { planning: true } });
		expect((await get('/api/v1/vacation/settings')).status).toBe(200);
	});

	it('refuses to change operator-locked modules in the admin API and rejects bad input', async () => {
		const { put } = await signedIn({ modulesDisabled: ['reports'] });
		expect((await put('/api/v1/admin/modules', { modules: { reports: true } })).status).toBe(409);
		expect((await put('/api/v1/admin/modules', { modules: { nope: true } })).status).toBe(400);
		expect((await put('/api/v1/me/modules', { modules: { mcp: 'yes' } })).status).toBe(400);
	});

	it('maps API paths to modules', () => {
		expect(moduleOfApiPath('/api/v1/absences/abc/attachments')).toBe('transfer');
		expect(moduleOfApiPath('/api/v1/absences/abc')).toBe('planning');
		expect(moduleOfApiPath('/api/v1/time/segments')).toBeNull();
		expect(moduleOfApiPath('/api/v1/time/suggestions/x/accept')).toBe('automation');
		expect(moduleOfApiPath('/api/v1/admin/storage')).toBe('transfer');
	});
});
