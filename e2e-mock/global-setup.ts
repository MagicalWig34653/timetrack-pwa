import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
	const baseURL = config.projects[0].use.baseURL;
	if (!baseURL) throw new Error('Mock E2E baseURL is missing');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Mit Passkey anmelden' }).waitFor();
	} finally {
		await browser.close();
	}
}
