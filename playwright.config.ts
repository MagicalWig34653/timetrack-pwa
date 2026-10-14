import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 18090);

// Real-backend E2E: the Swift backend serves build/ on a single origin (RP-ID `localhost`).
export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.spec.ts',
	globalSetup: './e2e/global-setup.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${port}`,
		headless: true,
		trace: 'off'
	}
});
