import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// E-mail diagnosis page (package MAIL1, ADR-0022) against the mock. Serial: the mock keeps its scenario between tests.
test.describe.configure({ mode: 'serial' });
const dir = process.env.SCREENSHOT_DIR;

async function hook(page: Page, body: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	await page.request.post('/api/v1/mock/mail', { data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
}

test.afterEach(async ({ browser }) => {
	// leave the scenario clean for the next test
	const { page, context } = await loginAsAdmin(browser);
	await hook(page, { scenario: 'ok', rateLimit: false, old: false });
	await context.close();
});

test('the page is reachable from the sidebar group Verwaltung and the settings navigation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'E-Mail' }).click();
	await expect(page).toHaveURL(/\/admin\/mail$/);
	await expect(page.getByRole('heading', { name: 'E-Mail', level: 1 })).toBeVisible();
	await page.goto('/settings/profile');
	await expect(page.getByRole('link', { name: 'E-Mail' }).first()).toBeVisible();
	await context.close();
});

test('check shows every step ok, then a failure at tls and at auth with the explanation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/admin/mail');
	await expect(page.getByTestId('mail-configured')).toHaveText('Eingerichtet');
	await page.getByTestId('mail-check-run').click();
	await expect(page.getByTestId('mail-result')).toHaveAttribute('data-ok', 'true');
	for (const id of ['dns', 'tcp', 'tls', 'ehlo', 'auth', 'mailFrom']) await expect(page.getByTestId(`mail-step-${id}`)).toHaveAttribute('data-status', 'ok');
	if (dir) await page.screenshot({ path: `${dir}/mail-ok.png`, fullPage: true });

	await hook(page, { scenario: 'tls' });
	await page.getByTestId('mail-check-run').click();
	await expect(page.getByTestId('mail-problem-tls')).toContainText('abgelaufen');
	await expect(page.getByTestId('mail-step-ehlo')).toHaveAttribute('data-status', 'skipped');

	await hook(page, { scenario: 'auth' });
	await page.getByTestId('mail-check-run').click();
	await expect(page.getByTestId('mail-problem-auth')).toContainText('Was kann ich tun?');
	await expect(page.getByTestId('mail-result')).toHaveAttribute('data-ok', 'false');
	if (dir) await page.screenshot({ path: `${dir}/mail-auth.png`, fullPage: true });
	await context.close();
});

test('test mail: invalid address is refused, a valid one is sent, a stale session asks for sign-in', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/admin/mail');
	await page.getByLabel('Empfänger').fill('kaputt');
	await page.getByTestId('mail-test-send').click();
	await expect(page.getByTestId('mail-to-invalid')).toBeVisible();
	await page.getByLabel('Empfänger').fill('ich@example.org');
	await page.getByTestId('mail-test-send').click();
	await expect(page.getByTestId('mail-test-sent')).toContainText('Gesendet an ich@example.org');
	if (dir) await page.screenshot({ path: `${dir}/mail-test-sent.png`, fullPage: true });

	await page.request.post('/api/v1/mock/accounts', { data: { staleSessions: true }, headers: { 'X-CSRF-Token': (await (await page.request.get('/api/v1/auth/session')).json()).csrfToken } });
	await page.getByTestId('mail-test-send').click();
	await expect(page.getByTestId('reauth')).toBeVisible();
	await context.close();
});

test('not configured: checklist with copyable example; old server: friendly notice', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await hook(page, { scenario: 'not_configured' });
	await page.goto('/admin/mail');
	await expect(page.getByTestId('mail-configured')).toHaveText('Nicht eingerichtet');
	await expect(page.getByTestId('mail-example')).toContainText('SMTP_HOST=smtp.example.org');
	await expect(page.getByTestId('mail-check-run')).toHaveCount(0);
	if (dir) await page.screenshot({ path: `${dir}/mail-unconfigured.png`, fullPage: true });

	await hook(page, { scenario: 'ok', old: true });
	await page.goto('/admin/mail');
	await expect(page.getByTestId('mail-unsupported')).toContainText('Dieser Server unterstützt die Prüfung noch nicht');
	await context.close();
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`screenshots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await hook(page, { scenario: 'not_configured' });
			await page.goto('/admin/mail');
			await expect(page.getByTestId('mail-setup')).toBeVisible();
			await page.screenshot({ path: `${dir}/${name}-${scheme}-unconfigured.png`, fullPage: true });
			await hook(page, { scenario: 'ok' });
			await page.goto('/admin/mail');
			await page.getByTestId('mail-check-run').click();
			await expect(page.getByTestId('mail-result')).toBeVisible();
			await page.waitForTimeout(900);
			await page.screenshot({ path: `${dir}/${name}-${scheme}-ok.png`, fullPage: true });
			await hook(page, { scenario: 'auth' });
			await page.getByTestId('mail-check-run').click();
			await expect(page.getByTestId('mail-problem-auth')).toBeVisible();
			await page.waitForTimeout(900);
			await page.screenshot({ path: `${dir}/${name}-${scheme}-auth.png`, fullPage: true });
			await hook(page, { scenario: 'ok' });
			await page.getByLabel('Empfänger').fill('ich@example.org');
			await page.getByTestId('mail-test-send').click();
			await expect(page.getByTestId('mail-test-sent')).toBeVisible();
			await page.screenshot({ path: `${dir}/${name}-${scheme}-sent.png`, fullPage: true });
			await context.close();
		});
	}
}
