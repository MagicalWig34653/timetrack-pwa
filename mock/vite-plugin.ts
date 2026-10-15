import type { Plugin } from 'vite';
import { createMockApi } from './api.ts';
import { handleNodeRequest, MOCK_PREFIXES } from './node-handler.ts';

/** Vite dev middleware serving the mock API under /api (enabled by `npm run dev:mock`). */
export function mockApiPlugin(): Plugin {
	// OIDC is on by default in mock mode; MOCK_OIDC=0 mimics a server without it, MOCK_OIDC_NAME renames the provider.
	const api = createMockApi({ oidc: process.env.MOCK_OIDC === '0' ? false : { name: process.env.MOCK_OIDC_NAME || 'Mock-IdP' } });
	return {
		name: 'timetrack-mock-api',
		apply: 'serve',
		configureServer(server) {
			for (const prefix of MOCK_PREFIXES) {
				server.middlewares.use(prefix, (req, res) => void handleNodeRequest(api, prefix, req, res));
			}
		}
	};
}
