import type { MockResponse } from './api.ts';

// Mock of the module switches (contract v0.9.0, ADR-0012): GET /modules, PUT /me/modules, GET/PUT /admin/modules and the
// central guard that answers 404 module_disabled for every endpoint of a switched-off module.
// Mock-only hook (authenticated): POST /api/v1/mock/modules {locked?: ModuleKey[], server?: {key: boolean}}
//   `locked` replaces the operator lock (module is off and cannot be changed, like MODULES_DISABLED=...);
//   `server` sets the server-wide availability without the lock rules.
// Dev server: MOCK_MODULES_DISABLED=reports,mcp starts the mock with an operator lock.

export const MODULE_KEYS = ['reports', 'planning', 'transfer', 'automation', 'mcp'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

const isKey = (value: unknown): value is ModuleKey => MODULE_KEYS.includes(value as ModuleKey);
const fail = (status: number, code: string): MockResponse => ({ status, body: { error: { code, message: code } } });

/** Which module an API path belongs to (mirrors the groups in ADR-0012); null = core. Query string already removed. */
export function moduleOfApiPath(path: string): ModuleKey | null {
	if (/^\/api\/v1\/absences\/[^/]+\/attachments(\/|$)/.test(path)) return 'transfer';
	if (/^\/api\/v1\/(export|imports|import-templates|files|admin\/storage)(\/|$)/.test(path)) return 'transfer';
	if (/^\/api\/v1\/reports(\/|$)/.test(path)) return 'reports';
	if (/^\/api\/v1\/(vacation|absences|calendar|plan|shares)(\/|$)/.test(path)) return 'planning';
	if (/^\/api\/v1\/(me\/device-tokens|me\/trigger-links|automation\/events|time\/suggestions)(\/|$)/.test(path)) return 'automation';
	if (/^\/api\/v1\/(me\/api-tokens|me\/oauth-grants|oauth\/requests)(\/|$)/.test(path)) return 'mcp';
	if (/^\/(oauth\/register|oauth\/authorize|oauth\/token|oauth\/revoke|mcp|\.well-known\/oauth-[a-z-]+)$/.test(path)) return 'mcp';
	return null;
}

export function createModulesMock(options: { disabledByOperator?: ModuleKey[] } = {}) {
	const server = new Map<ModuleKey, boolean>(MODULE_KEYS.map((k) => [k, true]));
	const locked = new Set<ModuleKey>();
	const accounts = new Map<string, Map<ModuleKey, boolean>>();

	function setLocked(keys: ModuleKey[]): void {
		for (const key of locked) server.set(key, true);
		locked.clear();
		for (const key of keys) {
			locked.add(key);
			server.set(key, false);
		}
	}
	setLocked(options.disabledByOperator ?? []);

	function accountState(accountId: string): Map<ModuleKey, boolean> {
		let state = accounts.get(accountId);
		if (!state) accounts.set(accountId, (state = new Map(MODULE_KEYS.map((k) => [k, true]))));
		return state;
	}

	function effective(accountId: string, key: ModuleKey): boolean {
		return !!server.get(key) && !!accountState(accountId).get(key);
	}

	const statusList = (accountId: string) =>
		MODULE_KEYS.map((key) => {
			const serverEnabled = !!server.get(key);
			const accountEnabled = !!accountState(accountId).get(key);
			return { key, serverEnabled, accountEnabled, effective: serverEnabled && accountEnabled, lockedByOperator: locked.has(key) };
		});
	const serverList = () => MODULE_KEYS.map((key) => ({ key, enabled: !!server.get(key), lockedByOperator: locked.has(key) }));

	function parseSelection(body: any): Partial<Record<ModuleKey, boolean>> | null {
		const modules = body?.modules;
		if (!modules || typeof modules !== 'object' || Array.isArray(modules)) return null;
		const selection: Partial<Record<ModuleKey, boolean>> = {};
		for (const [key, value] of Object.entries(modules)) {
			if (!isKey(key) || typeof value !== 'boolean') return null;
			selection[key] = value;
		}
		return selection;
	}

	/** 404 module_disabled when the path belongs to a module that is not effective for this account; null otherwise. */
	function guard(accountId: string, path: string): MockResponse | null {
		const key = moduleOfApiPath(path);
		return key && !effective(accountId, key) ? fail(404, 'module_disabled') : null;
	}

	function handle(accountId: string, role: 'admin' | 'member', req: { method: string; path: string; body?: any }): MockResponse | null {
		const { method, path, body } = req;
		if (path === '/api/v1/modules' && method === 'GET') return { status: 200, body: statusList(accountId) };
		if (path === '/api/v1/me/modules' && method === 'PUT') {
			const selection = parseSelection(body);
			if (!selection) return fail(400, 'bad_request');
			// all-or-nothing: a rejected key changes nothing
			for (const [key, value] of Object.entries(selection) as [ModuleKey, boolean][]) {
				if (value && !server.get(key)) return fail(409, 'module_locked');
			}
			const state = accountState(accountId);
			for (const [key, value] of Object.entries(selection) as [ModuleKey, boolean][]) state.set(key, value);
			return { status: 200, body: statusList(accountId) };
		}
		if (path === '/api/v1/admin/modules') {
			if (role !== 'admin') return fail(403, 'forbidden');
			if (method === 'GET') return { status: 200, body: serverList() };
			if (method === 'PUT') {
				const selection = parseSelection(body);
				if (!selection) return fail(400, 'bad_request');
				for (const [key, value] of Object.entries(selection) as [ModuleKey, boolean][]) {
					if (locked.has(key) && value !== !!server.get(key)) return fail(409, 'module_locked');
				}
				for (const [key, value] of Object.entries(selection) as [ModuleKey, boolean][]) server.set(key, value);
				return { status: 200, body: serverList() };
			}
		}
		if (path === '/api/v1/mock/modules' && method === 'POST') {
			if (Array.isArray(body?.locked)) setLocked(body.locked.filter(isKey));
			if (body?.server && typeof body.server === 'object') {
				for (const [key, value] of Object.entries(body.server)) if (isKey(key) && typeof value === 'boolean' && !locked.has(key)) server.set(key, value);
			}
			return { status: 200, body: serverList() };
		}
		return null;
	}

	return { handle, guard, effective, serverEnabled: (key: ModuleKey) => !!server.get(key), state: { server, locked, accounts } };
}
