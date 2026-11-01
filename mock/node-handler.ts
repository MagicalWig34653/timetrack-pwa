import type { createMockApi } from './api.ts';

/** Translates a Node HTTP request into a mock API call and writes the response. Shared by the Vite plugin and scripts/serve-build.mjs. */
export async function handleNodeRequest(api: ReturnType<typeof createMockApi>, prefix: string, req: any, res: any): Promise<void> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const buffer = Buffer.concat(chunks);
	const contentType = req.headers['content-type'] ?? '';
	let file;
	let raw = '';
	let rawBody: Uint8Array | undefined;
	if (contentType.startsWith('multipart/form-data')) {
		const form = await new Request('http://localhost/', { method: 'POST', headers: { 'content-type': contentType }, body: buffer }).formData();
		const entry = form.get('file');
		if (entry instanceof File) file = { name: entry.name, type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) };
	} else if (contentType.startsWith('application/pdf')) rawBody = new Uint8Array(buffer);
	else raw = buffer.toString('utf8');
	const cookies: Record<string, string> = {};
	for (const part of (req.headers.cookie ?? '').split(';')) {
		const [name, ...rest] = part.trim().split('=');
		if (name) cookies[name] = rest.join('=');
	}
	const csrf = req.headers['x-csrf-token'];
	const result = api.handle({
		method: req.method ?? 'GET',
		path: prefix + (req.url === '/' ? '' : (req.url ?? '')),
		body: raw ? JSON.parse(raw) : undefined,
		file,
		rawBody,
		contentType: contentType || undefined,
		fileName: req.headers['x-file-name'] as string | undefined,
		cookies,
		csrfToken: Array.isArray(csrf) ? csrf[0] : csrf,
		ifMatch: req.headers['if-match'] as string | undefined,
		authorization: req.headers.authorization,
		editSecret: req.headers['x-edit-secret'] as string | undefined
	});
	res.statusCode = result.status;
	if (result.sessionCookie !== undefined) {
		res.setHeader(
			'Set-Cookie',
			result.sessionCookie === null
				? 'tt_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
				: `tt_session=${result.sessionCookie}; Path=/; HttpOnly; SameSite=Lax`
		);
	}
	if (result.redirect) {
		res.setHeader('Location', result.redirect);
		res.end();
	} else if (result.binary) {
		res.setHeader('Content-Type', result.binary.contentType);
		for (const [name, value] of Object.entries(result.binary.headers)) res.setHeader(name, value);
		res.end(Buffer.from(result.binary.bytes));
	} else if (result.body !== undefined) {
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify(result.body));
	} else res.end();
}

/** Prefixes served by the mock: the REST API plus the authorization-server endpoints (ADR-0009). */
export const MOCK_PREFIXES = ['/api', '/oauth/register', '/oauth/authorize'];
