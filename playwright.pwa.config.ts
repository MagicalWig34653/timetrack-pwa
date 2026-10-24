import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PWA_PORT ?? 5299);

// Production-build checks: serves build/ (like the backend's static middleware) with the in-repo mock API, so the
// service worker, manifest, offline fallback and push handling run exactly as shipped. Run `npm run build` first.
export default defineConfig({
	testDir: './e2e-pwa',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	reporter: [['list']],
	webServer: {
		command: `MOCK=1 TEST_HOOKS=1 node --import ./scripts/ts-extension-loader.mjs scripts/serve-build.mjs build ${port}`,
		url: `http://localhost:${port}/login`,
		reuseExistingServer: false,
		timeout: 60_000
	},
	// new headless Chromium: the headless shell reports Notification.permission as denied even when granted
	use: { baseURL: `http://localhost:${port}`, headless: true, channel: 'chromium', trace: 'off' }
});
