import type { Plugin } from 'vite';
import { createMockApi } from './api.ts';

/** Vite dev middleware serving the mock API under /api (enabled by `npm run dev:mock`). */
export function mockApiPlugin(): Plugin {
	const api = createMockApi();
	return {
		name: 'timetrack-mock-api',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use('/api', async (req, res) => {
				const chunks: Buffer[] = [];
				for await (const chunk of req) chunks.push(chunk as Buffer);
				const raw = Buffer.concat(chunks).toString('utf8');
				const cookies: Record<string, string> = {};
				for (const part of (req.headers.cookie ?? '').split(';')) {
					const [name, ...rest] = part.trim().split('=');
					if (name) cookies[name] = rest.join('=');
				}
				const csrf = req.headers['x-csrf-token'];
				const result = api.handle({
					method: req.method ?? 'GET',
					path: '/api' + (req.url ?? ''),
					body: raw ? JSON.parse(raw) : undefined,
					cookies,
					csrfToken: Array.isArray(csrf) ? csrf[0] : csrf,
					ifMatch: req.headers['if-match'] as string | undefined,
					authorization: req.headers.authorization
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
				if (result.body !== undefined) {
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(result.body));
				} else res.end();
			});
		}
	};
}
