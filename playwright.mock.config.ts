import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_MOCK_PORT ?? 5199);

// The production build and mock API share one origin. A fixture resets the API before each spec file.
export default defineConfig({
	testDir: './e2e-mock',
	testMatch: '**/*.spec.ts',
	globalSetup: './e2e-mock/global-setup.ts',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	reporter: [['list']],
	webServer: {
		command: `MOCK=1 TEST_HOOKS=1 node --import ./scripts/ts-extension-loader.mjs scripts/serve-build.mjs build ${port}`,
		url: `http://localhost:${port}/login`,
		reuseExistingServer: false,
		timeout: 60_000
	},
	use: { baseURL: `http://localhost:${port}`, headless: true, trace: 'off', actionTimeout: 20_000 }
});
