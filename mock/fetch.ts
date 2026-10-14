import { createMockApi, type MockOptions } from './api.ts';

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
		const result = api.handle({
			method,
			path,
			body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
			cookies: sessionCookie ? { tt_session: sessionCookie } : {},
			csrfToken,
			ifMatch: headers.get('If-Match') ?? undefined,
			authorization: headers.get('Authorization') ?? undefined
		});
		if (result.sessionCookie !== undefined) sessionCookie = result.sessionCookie;
		return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
			status: result.status,
			headers: { 'Content-Type': 'application/json' }
		});
	};
	return { fetch: mockFetch, calls, state: api.state };
}
