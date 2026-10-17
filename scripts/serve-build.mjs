// Serves a production build (default: build/) like the Swift backend's PWAStaticMiddleware, optionally with the in-repo
// mock API (MOCK=1). Used by the production-build and service-worker E2E specs. Node >= 22 runs the .ts mock natively.
//   node scripts/serve-build.mjs [dir] [port]      env: MOCK=1, HOST=127.0.0.1
// Test control (only with TEST_HOOKS=1): POST /__test/bump makes /service-worker.js differ byte-wise, i.e. a "new version".
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'build');
const port = Number(process.argv[3] ?? process.env.PORT ?? 5299);
const withMock = process.env.MOCK === '1';
const hooks = process.env.TEST_HOOKS === '1';
const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.txt': 'text/plain; charset=utf-8',
	'.woff2': 'font/woff2'
};
const passthrough = ['/api', '/health', '/ready', '/.well-known', '/oauth/authorize', '/mcp'];
let bump = 0;

let handleNodeRequest;
let api;
let prefixes = [];
if (withMock) {
	const { createMockApi } = await import('../mock/api.ts');
	({ handleNodeRequest } = await import('../mock/node-handler.ts'));
	({ MOCK_PREFIXES: prefixes } = await import('../mock/node-handler.ts'));
	api = createMockApi({ oidc: false });
}

http
	.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		if (hooks && url.pathname === '/__test/bump' && req.method === 'POST') {
			bump += 1;
			res.statusCode = 204;
			return res.end();
		}
		const prefix = prefixes.find((p) => url.pathname === p || url.pathname.startsWith(p + '/'));
		if (api && prefix) {
			req.url = req.url.slice(prefix.length) || '/';
			return handleNodeRequest(api, prefix, req, res).catch((e) => {
				res.statusCode = 500;
				res.end(String(e));
			});
		}
		if (req.method !== 'GET' || passthrough.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))) {
			res.statusCode = 404;
			return res.end();
		}
		let file = path.join(root, decodeURIComponent(url.pathname));
		if (!file.startsWith(root + path.sep) && file !== root) {
			res.statusCode = 404;
			return res.end();
		}
		if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
		const name = path.basename(file);
		const hashed = url.pathname.startsWith('/_app/immutable/') || /[.-][A-Za-z0-9_-]{8,}\./.test(name);
		res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
		res.setHeader('Cache-Control', name === 'index.html' ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
		res.setHeader('X-Content-Type-Options', 'nosniff');
		let body = fs.readFileSync(file);
		if (name === 'service-worker.js' && bump > 0) body = Buffer.concat([body, Buffer.from(`\n// test bump ${bump}\n`)]);
		res.end(body);
	})
	.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`serving ${root} on http://localhost:${port}${withMock ? ' (mock API)' : ''}`));
