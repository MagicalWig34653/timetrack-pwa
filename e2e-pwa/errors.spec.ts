import { expect, test } from '@playwright/test';

// Production build (static fallback = index.html): an unknown address renders the designed 404 page, with the app's own icons only.
test('an unknown address shows the designed 404 page from the static fallback', async ({ page }) => {
	await page.goto('/gibt-es-nicht');
	await expect(page.getByRole('heading', { level: 1, name: 'Seite nicht gefunden' })).toBeVisible();
	await expect(page.getByTestId('error-path')).toHaveText('/gibt-es-nicht');
	await expect(page.getByRole('link', { name: 'Kalender' }).first()).toBeVisible();
	const icons = await page.locator('head link[rel~="icon"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
	expect(icons.length).toBeGreaterThan(0);
	for (const href of icons) expect(href, 'template favicons must not appear').toMatch(/^(https?:\/\/[^/]+)?\/favicon(-\d+\.png|\.svg|\.ico)\?v=\d+$/);
});

test('the static offline page is served as HTML and is self-contained', async ({ request }) => {
	const response = await request.get('/offline.html');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('text/html');
	expect(await response.text()).toContain('Keine Verbindung');
});
