import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Hilfe > "Version und Build" (ADR-0023 of the backend repository). Screenshots only with SCREENSHOT_DIR.
const dir = process.env.SCREENSHOT_DIR;

async function openHelp(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: 'Hilfe' }).first().click();
	await expect(page.getByTestId('help-dialog')).toBeVisible();
	await expect(page.getByTestId('version-backend-number')).toBeVisible();
}

test('the help dialog shows frontend and backend versions and a copyable support line', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await openHelp(page);
	await expect(page.getByTestId('version-backend-number')).toHaveText('0.19.0-mock');
	await expect(page.getByTestId('version-backend-commit')).toHaveText('0123456');
	await expect(page.getByTestId('version-pwa-commit')).toHaveText(/^[0-9a-f]{7}$/);
	await expect(page.getByTestId('version-info')).toContainText('Datenbank-Migrationen');
	await expect(page.getByTestId('version-info')).toContainText('42 angewendet');
	// the dev server reports the same PWA build it serves: no mismatch hint
	await expect(page.getByTestId('version-mismatch')).toHaveCount(0);

	await page.getByRole('button', { name: 'Commit-ID kopieren' }).nth(1).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0123456789abcdef0123456789abcdef01234567');
	await page.getByRole('button', { name: 'Angaben kopieren' }).click();
	const text = await page.evaluate(() => navigator.clipboard.readText());
	expect(text).toMatch(/^Timetrack PWA \S+ \([0-9a-f]{7}, \d{4}-\d{2}-\d{2}\), Backend 0\.19\.0-mock \(0123456, 2026-10-18\), API 0\.19\.0, sqlite$/);
	await context.close();
});

test('members see only version fields (no database, migrations, uptime, replica) and a clean copy text', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	// contract v0.23.0: for members the operator keys are absent
	await page.route('**/api/v1/system/info', async (route) => {
		const response = await route.fetch();
		const body = await response.json();
		for (const key of ['database', 'schemaMigrations', 'migrationsPending', 'uptimeSeconds', 'replicaId']) delete body.backend[key];
		await route.fulfill({ response, json: body });
	});
	await openHelp(page);
	const info = page.getByTestId('version-info');
	await expect(page.getByTestId('version-backend-number')).toHaveText('0.19.0-mock');
	for (const label of ['Datenbank', 'Laufzeit', 'Replikat']) await expect(info).not.toContainText(label);
	await expect(info).not.toContainText(/undefined|NaN/);
	await expect(page.getByTestId('version-mismatch')).toHaveCount(0);
	await page.getByRole('button', { name: 'Angaben kopieren' }).click();
	const text = await page.evaluate(() => navigator.clipboard.readText());
	expect(text).toMatch(/Backend 0\.19\.0-mock \(0123456, 2026-10-18\), API 0\.19\.0$/);
	await context.close();
});

test('an older loaded interface is flagged and the refresh button reloads', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.route('**/api/v1/system/info', async (route) => {
		const response = await route.fetch();
		const body = await response.json();
		body.pwa.revision = '9999999999999999999999999999999999999999';
		await route.fulfill({ response, json: body });
	});
	await openHelp(page);
	await expect(page.getByTestId('version-mismatch')).toContainText('älter als die auf dem Server');
	const navigation = page.waitForEvent('framenavigated');
	await page.getByRole('button', { name: 'Neu laden / Aktualisieren' }).click();
	await navigation;
	await context.close();
});

test('older servers without the endpoint still show the interface version', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.route('**/api/v1/system/info', (route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'not_found' } } }));
	await page.getByRole('button', { name: 'Hilfe' }).first().click();
	await expect(page.getByTestId('version-unavailable')).toBeVisible();
	await expect(page.getByTestId('version-pwa-commit')).toBeVisible();
	await expect(page.getByTestId('version-mismatch')).toHaveCount(0);
	await context.close();
});

test('a 503 database_unavailable on a GET is retried transparently (Retry-After honoured)', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	let calls = 0;
	await page.route('**/api/v1/system/info', async (route) => {
		calls += 1;
		if (calls === 1) {
			await route.fulfill({
				status: 503,
				headers: { 'Retry-After': '1' },
				json: { error: { code: 'database_unavailable', message: 'Datenbank nicht erreichbar' } }
			});
		} else await route.fallback();
	});
	await page.getByRole('button', { name: 'Hilfe' }).first().click();
	await expect(page.getByTestId('version-backend-number')).toBeVisible();
	expect(calls).toBe(2);
	await context.close();
});

for (const [name, viewport, scheme] of [
	['desktop-light', { width: 1280, height: 900 }, 'light'],
	['desktop-dark', { width: 1280, height: 900 }, 'dark'],
	['phone-light', { width: 390, height: 844 }, 'light']
] as const) {
	test(`screenshot ${name}`, async ({ browser }) => {
		test.skip(!dir, 'set SCREENSHOT_DIR');
		const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
		if (name.startsWith('phone')) await page.getByTestId('menu-button').click();
		await openHelp(page);
		await page.screenshot({ path: `${dir}/version-${name}.png` });
		await page.getByTestId('help-dialog').evaluate((dialog) => dialog.scrollTo(0, dialog.scrollHeight));
		await page.screenshot({ path: `${dir}/version-${name}-bottom.png` });
		await context.close();
	});
}
