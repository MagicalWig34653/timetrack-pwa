import { createMockApi, type MockOptions } from './api.ts';

/** Blob.arrayBuffer is missing in some jsdom versions; fall back to FileReader. */
async function readBytes(blob: Blob): Promise<Uint8Array> {
	if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(blob);
	});
}

/** fetch replacement backed by the mock API with a tiny cookie jar; used by tests. */
export function createMockFetch(options?: MockOptions) {
	const api = createMockApi(options);
	let sessionCookie: string | null = null;
	const calls: { method: string; path: string; csrf?: string; credentials?: string }[] = [];

	const mockFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
		const method = (init.method ?? 'GET').toUpperCase();
		const headers = new Headers(init.headers);
		const path = String(input);
		const csrfToken = headers.get('X-CSRF-Token') ?? undefined;
		calls.push({ method, path, csrf: csrfToken, credentials: init.credentials });
		let file;
		let rawBody: Uint8Array | undefined;
		if (ArrayBuffer.isView(init.body)) rawBody = new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength);
		if (init.body instanceof FormData) {
			const entry = init.body.get('file');
			if (entry instanceof Blob) file = { name: (entry as File).name ?? 'file', type: entry.type, bytes: await readBytes(entry) };
		}
		const result = api.handle({
			method,
			path,
			body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
			file,
			rawBody,
			fileName: headers.get('X-File-Name') ?? undefined,
			cookies: sessionCookie ? { tt_session: sessionCookie } : {},
			csrfToken,
			ifMatch: headers.get('If-Match') ?? undefined,
			authorization: headers.get('Authorization') ?? undefined
		});
		if (result.sessionCookie !== undefined) sessionCookie = result.sessionCookie;
		if (result.redirect) return new Response(null, { status: result.status, headers: { Location: result.redirect } });
		if (result.binary) {
			return new Response(result.binary.bytes as BodyInit, { status: result.status, headers: { 'Content-Type': result.binary.contentType, ...result.binary.headers } });
		}
		return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
			status: result.status,
			headers: { 'Content-Type': 'application/json' }
		});
	};
	return { fetch: mockFetch, calls, state: api.state };
}
