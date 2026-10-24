import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Adapter } from '@sveltejs/kit';
import { mockApiPlugin } from './mock/vite-plugin.ts';
import { resolveBuildInfo } from './scripts/build-info.ts';

// `VITE_MOCK=1 vite dev` serves the in-repo mock API instead of proxying to the backend.
const useMock = process.env.VITE_MOCK === '1';
const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:18080';

// Embedded build metadata (Hilfe > Version und Build) and build/version.json, which the backend reports under `pwa`.
const buildInfo = resolveBuildInfo();
const staticAdapter = adapter({ pages: 'build', assets: 'build', fallback: 'index.html' });
const adapterWithVersion: Adapter = {
	...staticAdapter,
	async adapt(builder) {
		await staticAdapter.adapt(builder);
		mkdirSync('build', { recursive: true });
		writeFileSync('build/version.json', JSON.stringify(buildInfo, null, 2) + '\n');
	}
};

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(buildInfo.version),
		__APP_REVISION__: JSON.stringify(buildInfo.revision),
		__APP_BUILD_DATE__: JSON.stringify(buildInfo.buildDate)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// SPA fallback: the backend serves build/index.html for unknown paths so deep links work.
			adapter: adapterWithVersion,
			// The service worker is registered by src/lib/pwa (production on https/localhost only, never in dev).
			serviceWorker: { register: false }
		}),
		...(useMock ? [mockApiPlugin()] : [])
	],
	server: {
		// Single origin in development so the HttpOnly session cookie works (RP-ID `localhost`).
		proxy: useMock ? undefined : { '/api': { target: backendUrl, changeOrigin: false } }
	},
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: {
		environment: 'jsdom',
		testTimeout: 30_000,
		hookTimeout: 30_000,
		include: ['src/**/*.test.ts', 'mock/**/*.test.ts'],
		setupFiles: ['./vitest-setup.ts']
	}
});
