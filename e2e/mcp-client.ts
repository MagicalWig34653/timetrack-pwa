import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Small scripted MCP client (JSON-RPC 2.0 over Streamable HTTP, POST only) and OAuth helpers for package X1.
// Plain Node fetch: no browser, no cookies, only the Authorization header, like a real connector.

export interface RpcResponse {
	status: number;
	headers: Headers;
	text: string;
	json: any;
}

export async function rawPost(url: string, token: string | null, body: unknown, extraHeaders: Record<string, string> = {}): Promise<RpcResponse> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extraHeaders };
	if (token !== null) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(url, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
	const text = await res.text();
	let json: any = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		/* not JSON */
	}
	return { status: res.status, headers: res.headers, text, json };
}

export interface ToolResult {
	status: number;
	isError: boolean;
	structured: any;
	text: string;
	raw: any;
}

export class McpClient {
	private nextId = 1;
	constructor(
		readonly base: string,
		readonly token: string | null
	) {}

	get url() {
		return `${this.base}/mcp`;
	}

	/** One JSON-RPC request. */
	request(method: string, params?: unknown): Promise<RpcResponse> {
		return rawPost(this.url, this.token, { jsonrpc: '2.0', id: this.nextId++, method, ...(params === undefined ? {} : { params }) });
	}

	/** A JSON-RPC notification (no id): the server answers 202 without a body. */
	notify(method: string, params?: unknown): Promise<RpcResponse> {
		return rawPost(this.url, this.token, { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
	}

	initialize(protocolVersion = '2025-11-25') {
		return this.request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'timetrack-e2e', version: '1.0.0' } });
	}

	async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
		const res = await this.request('tools/call', { name, arguments: args });
		const result = res.json?.result;
		return {
			status: res.status,
			isError: result?.isError === true,
			structured: result?.structuredContent,
			text: result?.content?.[0]?.text ?? '',
			raw: res.json
		};
	}

	async toolNames(): Promise<string[]> {
		const res = await this.request('tools/list');
		return (res.json?.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
	}
}

export const b64url = (buf: Buffer) => buf.toString('base64url');

export function newPkce() {
	const verifier = b64url(randomBytes(48));
	return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export interface Callback {
	code?: string;
	state?: string;
	error?: string;
	iss?: string;
	params: URLSearchParams;
}

/** Tiny loopback HTTP listener standing in for a native client's redirect target; captures `?code=...&state=...`. */
export class LoopbackListener {
	private server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const state = url.searchParams.get('state') ?? '';
		const cb: Callback = {
			code: url.searchParams.get('code') ?? undefined,
			state: state || undefined,
			error: url.searchParams.get('error') ?? undefined,
			iss: url.searchParams.get('iss') ?? undefined,
			params: url.searchParams
		};
		this.received.set(state, cb);
		this.waiters.get(state)?.(cb);
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end('<!doctype html><title>callback</title><p>callback received</p>');
	});
	private received = new Map<string, Callback>();
	private waiters = new Map<string, (cb: Callback) => void>();
	port = 0;

	async start() {
		await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
		this.port = (this.server.address() as AddressInfo).port;
	}

	get redirectUri() {
		return `http://127.0.0.1:${this.port}/cb`;
	}

	wait(state: string, timeoutMs = 15_000): Promise<Callback> {
		const have = this.received.get(state);
		if (have) return Promise.resolve(have);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`no callback for state ${state}`)), timeoutMs);
			this.waiters.set(state, (cb) => (clearTimeout(timer), resolve(cb)));
		});
	}

	async stop() {
		this.server.closeAllConnections();
		await new Promise((r) => this.server.close(r));
	}
}

export async function registerClient(base: string, redirectUri: string, name = 'E2E Client') {
	const res = await rawPost(`${base}/oauth/register`, null, {
		client_name: name,
		redirect_uris: [redirectUri],
		token_endpoint_auth_method: 'none',
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code']
	});
	return res;
}

export interface AuthorizeParams {
	clientId: string;
	redirectUri: string;
	challenge: string;
	state: string;
	scope?: string;
	resource?: string;
	extra?: Record<string, string>;
}

export function authorizeUrl(base: string, p: AuthorizeParams): string {
	const url = new URL(`${base}/oauth/authorize`);
	const q = url.searchParams;
	q.set('response_type', 'code');
	q.set('client_id', p.clientId);
	q.set('redirect_uri', p.redirectUri);
	q.set('code_challenge', p.challenge);
	q.set('code_challenge_method', 'S256');
	q.set('state', p.state);
	q.set('resource', p.resource ?? `${base}/mcp`);
	if (p.scope) q.set('scope', p.scope);
	for (const [k, v] of Object.entries(p.extra ?? {})) q.set(k, v);
	return url.toString();
}

export async function tokenRequest(base: string, form: Record<string, string>): Promise<RpcResponse> {
	const res = await fetch(`${base}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: new URLSearchParams(form).toString()
	});
	const text = await res.text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* ignore */
	}
	return { status: res.status, headers: res.headers, text, json };
}
