import type { MockResponse } from './api.ts';

// Mock of the MCP/OAuth surfaces (contract v0.7.0, ADR-0009): dynamic client registration, /oauth/authorize,
// consent requests, grants and personal tokens. Framework-free like the other mock modules.

const MCP_SCOPES = ['time:read', 'time:write', 'schedule:read', 'schedule:write', 'reports:read', 'reports:write', 'documents:read'] as const;
type Scope = (typeof MCP_SCOPES)[number];
const isScope = (value: unknown): value is Scope => typeof value === 'string' && (MCP_SCOPES as readonly string[]).includes(value);

const REQUEST_TTL_MS = 10 * 60_000;
const uuid = () => crypto.randomUUID();
const secret = () => (uuid() + uuid()).replace(/-/g, '').slice(0, 43);

function error(status: number, code: string): MockResponse {
	return { status, body: { error: { code, message: code } } };
}

interface Client {
	clientId: string;
	clientName: string;
	redirectUris: string[];
}

interface ConsentRequest {
	id: string;
	clientName: string;
	redirectUri: string;
	state: string | null;
	scopes: Scope[];
	expiresAt: number;
	decided: boolean;
}

interface Grant {
	id: string;
	accountId: string;
	clientName: string;
	scopes: Scope[];
	createdAt: string;
	lastUsedAt: string | null;
}

interface Token {
	id: string;
	accountId: string;
	name: string;
	scopes: Scope[];
	createdAt: string;
	expiresAt: string;
	lastUsedAt: string | null;
}

export interface McpMockSession {
	/** simulates a session too old for creating tokens (403 reauth_required) */
	stale?: boolean;
}

export interface McpMockOptions {
	clock: () => number;
}

/** https, or http only for loopback hosts (ADR-0009). */
export function isAllowedRedirect(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.hash) return false;
		if (url.protocol === 'https:') return true;
		return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	} catch {
		return false;
	}
}

export function createMcpMock(options: McpMockOptions) {
	const now = options.clock;
	const clients = new Map<string, Client>();
	const requests = new Map<string, ConsentRequest>();
	const grants: Grant[] = [];
	const tokens: Token[] = [];

	function publicRequest(r: ConsentRequest) {
		return { id: r.id, clientName: r.clientName, redirectHost: new URL(r.redirectUri).host, scopes: r.scopes, expiresAt: new Date(r.expiresAt).toISOString() };
	}

	/** POST /oauth/register (RFC 7591), public clients only. */
	function register(body: any): MockResponse {
		const uris: unknown = body?.redirect_uris;
		const name = typeof body?.client_name === 'string' ? body.client_name.trim() : '';
		const invalid = (description: string): MockResponse => ({ status: 400, body: { error: 'invalid_client_metadata', error_description: description } });
		if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5) return invalid('redirect_uris: 1 to 5 required');
		if (!uris.every((u) => typeof u === 'string' && isAllowedRedirect(u))) return invalid('redirect_uris must be https or loopback http');
		if (name.length > 100) return invalid('client_name too long');
		if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') return invalid('public clients only');
		const client: Client = { clientId: 'mock-' + uuid(), clientName: name || 'Unbenannter Client', redirectUris: uris as string[] };
		clients.set(client.clientId, client);
		return { status: 201, body: { client_id: client.clientId, client_name: client.clientName, redirect_uris: client.redirectUris, token_endpoint_auth_method: 'none' } };
	}

	/** GET /oauth/authorize: validates, stores the consent request and redirects to the PWA consent page. */
	function authorize(path: string): MockResponse {
		const q = new URL(path, 'http://mock.invalid').searchParams;
		const bad = (description: string): MockResponse => ({ status: 400, body: { error: 'invalid_request', error_description: description } });
		const client = clients.get(q.get('client_id') ?? '');
		if (!client) return bad('unknown client_id');
		const redirectUri = q.get('redirect_uri') ?? '';
		if (!client.redirectUris.includes(redirectUri)) return bad('redirect_uri does not match the registration');
		const state = q.get('state');
		const back = (errorCode: string): MockResponse => {
			const target = new URL(redirectUri);
			target.searchParams.set('error', errorCode);
			if (state) target.searchParams.set('state', state);
			return { status: 302, redirect: target.toString() };
		};
		if (q.get('response_type') !== 'code') return back('unsupported_response_type');
		if (!q.get('code_challenge') || q.get('code_challenge_method') !== 'S256') return back('invalid_request');
		if (!(q.get('resource') ?? '').endsWith('/mcp')) return back('invalid_target');
		const asked = (q.get('scope') ?? '').split(/\s+/).filter(Boolean);
		if (!asked.every(isScope)) return back('invalid_scope');
		const scopes = (asked.length ? MCP_SCOPES.filter((s) => asked.includes(s)) : MCP_SCOPES.filter((s) => s.endsWith(':read'))) as Scope[];
		const request: ConsentRequest = { id: uuid(), clientName: client.clientName, redirectUri, state, scopes, expiresAt: now() + REQUEST_TTL_MS, decided: false };
		requests.set(request.id, request);
		return { status: 302, redirect: `/oauth/consent?request=${request.id}` };
	}

	function openRequest(id: string): ConsentRequest | undefined {
		const request = requests.get(id);
		return request && request.expiresAt > now() ? request : undefined;
	}

	/** Authenticated /api/v1 endpoints; null when the path is not an MCP endpoint. */
	function handle(accountId: string, session: McpMockSession, req: { method: string; path: string; body?: any }): MockResponse | null {
		const path = req.path.split('?')[0].replace(/\/+$/, '');
		const method = req.method.toUpperCase();
		const body = req.body ?? {};
		let m: RegExpMatchArray | null;

		// The request is deliberately not bound to a session in the mock, so "use another account" can open it again.
		if ((m = path.match(/^\/api\/v1\/oauth\/requests\/([^/]+)$/)) && method === 'GET') {
			const request = openRequest(m[1]);
			if (!request) return error(404, 'not_found');
			if (request.decided) return error(409, 'conflict');
			return { status: 200, body: publicRequest(request) };
		}
		if ((m = path.match(/^\/api\/v1\/oauth\/requests\/([^/]+)\/decision$/)) && method === 'POST') {
			const request = openRequest(m[1]);
			if (!request) return error(404, 'not_found');
			if (request.decided) return error(409, 'conflict');
			const target = new URL(request.redirectUri);
			if (body.approve === true) {
				const chosen: unknown = body.scopes;
				if (!Array.isArray(chosen) || chosen.length === 0 || !chosen.every(isScope) || !chosen.every((s) => request.scopes.includes(s))) {
					return error(400, 'bad_request');
				}
				request.decided = true;
				const scopes = MCP_SCOPES.filter((s) => chosen.includes(s)) as Scope[];
				grants.push({ id: uuid(), accountId, clientName: request.clientName, scopes, createdAt: new Date(now()).toISOString(), lastUsedAt: null });
				target.searchParams.set('code', secret());
			} else if (body.approve === false) {
				request.decided = true;
				target.searchParams.set('error', 'access_denied');
			} else return error(400, 'bad_request');
			if (request.state) target.searchParams.set('state', request.state);
			return { status: 200, body: { redirectUrl: target.toString() } };
		}

		if (path === '/api/v1/me/oauth-grants' && method === 'GET') {
			return { status: 200, body: grants.filter((g) => g.accountId === accountId).map(({ accountId: _a, ...rest }) => rest) };
		}
		if ((m = path.match(/^\/api\/v1\/me\/oauth-grants\/([^/]+)$/)) && method === 'DELETE') {
			const grant = grants.find((g) => g.id === m![1] && g.accountId === accountId);
			if (!grant) return error(404, 'not_found');
			grants.splice(grants.indexOf(grant), 1);
			return { status: 204 };
		}

		if (path === '/api/v1/me/api-tokens' && method === 'GET') {
			return { status: 200, body: tokens.filter((t) => t.accountId === accountId).map(({ accountId: _a, ...rest }) => rest) };
		}
		if (path === '/api/v1/me/api-tokens' && method === 'POST') {
			if (session.stale) return error(403, 'reauth_required');
			const name = typeof body.name === 'string' ? body.name.trim() : '';
			const days = body.expiresInDays;
			const asked: unknown = body.scopes;
			if (!name || name.length > 80) return error(400, 'bad_request');
			if (!Number.isInteger(days) || days < 1 || days > 365) return error(400, 'bad_request');
			if (!Array.isArray(asked) || asked.length === 0 || !asked.every(isScope)) return error(400, 'bad_request');
			const created: Token = {
				id: uuid(),
				accountId,
				name,
				scopes: MCP_SCOPES.filter((s) => asked.includes(s)) as Scope[],
				createdAt: new Date(now()).toISOString(),
				expiresAt: new Date(now() + days * 86_400_000).toISOString(),
				lastUsedAt: null
			};
			tokens.push(created);
			const { accountId: _a, ...publicToken } = created;
			return { status: 201, body: { ...publicToken, token: 'ttp_' + secret() } };
		}
		if ((m = path.match(/^\/api\/v1\/me\/api-tokens\/([^/]+)$/)) && method === 'DELETE') {
			const token = tokens.find((t) => t.id === m![1] && t.accountId === accountId);
			if (!token) return error(404, 'not_found');
			tokens.splice(tokens.indexOf(token), 1);
			return { status: 204 };
		}
		return null;
	}

	return { handle, register, authorize, state: { clients, requests, grants, tokens } };
}
