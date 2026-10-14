import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_MOCK_PORT ?? 5199);

// Mock-mode E2E: `npm run dev:mock` serves the in-repo mock API (no Swift backend needed).
// The mock state lives in the dev-server process, so the specs run serially against one server.
export default defineConfig({
	testDir: './e2e-mock',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	reporter: [['list']],
	webServer: {
		command: `npm run dev:mock -- --port ${port} --strictPort --host localhost`,
		url: `http://localhost:${port}/login`,
		reuseExistingServer: false,
		timeout: 120_000
	},
	use: { baseURL: `http://localhost:${port}`, headless: true, trace: 'off' }
});
