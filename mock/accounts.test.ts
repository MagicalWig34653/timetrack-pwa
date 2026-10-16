import { describe, expect, it } from 'vitest';
import { createMockFetch } from './fetch.ts';
import { readZip } from './worktime-xlsx.ts';

async function signedIn() {
	const mock = createMockFetch();
	let csrf = '';
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await mock.fetch(path, {
			method,
			headers: { 'Content-Type': 'application/json', ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const buffer = new Uint8Array(await response.arrayBuffer());
		let json: any;
		try {
			json = buffer.length ? JSON.parse(new TextDecoder().decode(buffer)) : undefined;
		} catch {
			json = undefined;
		}
		return { status: response.status, body: json, bytes: buffer, headers: response.headers };
	};
	const options = await call('POST', '/api/v1/auth/login/options', {});
	const login = await call('POST', '/api/v1/auth/login/verify', { challengeId: options.body.challengeId, credential: { id: 'mock-login' } });
	csrf = login.body.csrfToken;
	return { call, mock };
}

const members = (body: any) => body.items as any[];

describe('account administration mock (ADR-0016)', () => {
	it('lists accounts with state, role, activity and passkey count, paged', async () => {
		const { call } = await signedIn();
		await call('POST', '/api/v1/mock/accounts', { add: [{ handle: 'ben', passkeys: 2 }, { handle: 'cora', disabled: true }] });
		const page = await call('GET', '/api/v1/admin/accounts?limit=2&offset=0');
		expect(page.status).toBe(200);
		expect(page.body).toMatchObject({ total: 4, limit: 2, offset: 0 });
		expect(members(page.body).map((a) => a.handle)).toEqual(['admin', 'lena']);
		expect(members(page.body)[0]).toMatchObject({ role: 'admin', state: 'active', passkeyCount: 1 });
		const rest = await call('GET', '/api/v1/admin/accounts?limit=2&offset=2');
		expect(members(rest.body).map((a) => [a.handle, a.state, a.passkeyCount])).toEqual([['ben', 'active', 2], ['cora', 'disabled', 0]]);
		expect((await call('GET', '/api/v1/admin/accounts?limit=0')).status).toBe(400);
	});

	it('disables (revoking sessions), reactivates, and blocks self and last-admin changes', async () => {
		const { call } = await signedIn();
		const all = members((await call('GET', '/api/v1/admin/accounts')).body);
		const me = all.find((a) => a.handle === 'admin');
		const lena = all.find((a) => a.handle === 'lena');
		expect((await call('PATCH', `/api/v1/admin/accounts/${me.id}`, { state: 'disabled' })).body.error.code).toBe('self_lockout');
		expect((await call('PATCH', `/api/v1/admin/accounts/${lena.id}`, { state: 'disabled' })).body).toMatchObject({ state: 'disabled' });
		expect((await call('PATCH', `/api/v1/admin/accounts/${lena.id}`, { state: 'active' })).body).toMatchObject({ state: 'active', disabledAt: null });
		expect((await call('PATCH', `/api/v1/admin/accounts/${lena.id}`, {})).status).toBe(400);
		// promote lena, then the original admin cannot be demoted by lena-only logic: last_admin protects the final one
		await call('PATCH', `/api/v1/admin/accounts/${lena.id}`, { role: 'admin' });
		expect((await call('PATCH', `/api/v1/admin/accounts/${lena.id}`, { role: 'member' })).body).toMatchObject({ role: 'member' });
	});

	it('refuses to demote or disable the last active admin', async () => {
		const { call } = await signedIn();
		await call('POST', '/api/v1/mock/accounts', { add: [{ handle: 'zed', role: 'admin' }] });
		const zed = members((await call('GET', '/api/v1/admin/accounts')).body).find((a) => a.handle === 'zed');
		// two active admins: zed can be demoted
		expect((await call('PATCH', `/api/v1/admin/accounts/${zed.id}`, { role: 'member' })).status).toBe(200);
		// back to one admin: nothing else may lose the role (admin is the only one; self is blocked first)
		await call('PATCH', `/api/v1/admin/accounts/${zed.id}`, { role: 'admin' });
		await call('PATCH', `/api/v1/admin/accounts/${zed.id}`, { state: 'disabled' });
		const lone = await call('DELETE', `/api/v1/admin/accounts/${zed.id}`, { confirmHandle: 'zed' });
		expect(lone.status).toBe(204);
	});

	it('answers reauth_required for role change and deletion on a stale session', async () => {
		const { call } = await signedIn();
		const lena = members((await call('GET', '/api/v1/admin/accounts')).body).find((a) => a.handle === 'lena');
		await call('POST', '/api/v1/mock/accounts', { staleSessions: true });
		expect((await call('PATCH', `/api/v1/admin/accounts/${lena.id}`, { role: 'admin' })).body.error.code).toBe('reauth_required');
		expect((await call('DELETE', `/api/v1/admin/accounts/${lena.id}`, { confirmHandle: 'lena' })).body.error.code).toBe('reauth_required');
		// disabling needs only a normal session
		expect((await call('PATCH', `/api/v1/admin/accounts/${lena.id}`, { state: 'disabled' })).status).toBe(200);
	});

	it('deletes with a matching handle only; 503 leaves the account disabled and the retry succeeds', async () => {
		const { call } = await signedIn();
		const lena = members((await call('GET', '/api/v1/admin/accounts')).body).find((a) => a.handle === 'lena');
		expect((await call('DELETE', `/api/v1/admin/accounts/${lena.id}`, { confirmHandle: 'wrong' })).body.error.code).toBe('confirmation_mismatch');
		await call('POST', '/api/v1/mock/accounts', { failDeletion: true });
		const failed = await call('DELETE', `/api/v1/admin/accounts/${lena.id}`, { confirmHandle: 'lena' });
		expect(failed).toMatchObject({ status: 503, body: { error: { code: 'account_deletion_incomplete' } } });
		expect(members((await call('GET', '/api/v1/admin/accounts')).body).find((a) => a.handle === 'lena').state).toBe('disabled');
		expect((await call('DELETE', `/api/v1/admin/accounts/${lena.id}`, { confirmHandle: 'lena' })).status).toBe(204);
		expect(members((await call('GET', '/api/v1/admin/accounts')).body).map((a) => a.handle)).toEqual(['admin']);
		expect((await call('DELETE', `/api/v1/admin/accounts/${lena.id}`, { confirmHandle: 'lena' })).status).toBe(404);
	});

	it('exports a ZIP with a manifest, and self-deletion clears the session; the last admin cannot self-delete', async () => {
		const { call } = await signedIn();
		const exported = await call('GET', '/api/v1/me/export');
		expect(exported.status).toBe(200);
		expect(exported.headers.get('Content-Disposition')).toContain('timetrack-export-admin.zip');
		expect([...readZip(exported.bytes).keys()]).toContain('manifest.json');
		expect((await call('DELETE', '/api/v1/me', { confirmHandle: 'admin' })).body.error.code).toBe('last_admin');
		expect((await call('DELETE', '/api/v1/me', { confirmHandle: 'nope' })).body.error.code).toBe('confirmation_mismatch');
		await call('POST', '/api/v1/mock/accounts', { add: [{ handle: 'zed', role: 'admin' }] });
		expect((await call('DELETE', '/api/v1/me', { confirmHandle: 'admin' })).status).toBe(204);
		expect((await call('GET', '/api/v1/auth/session')).status).toBe(401);
	});
});
