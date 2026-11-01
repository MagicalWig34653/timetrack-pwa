import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Design language (ADR-0014) against the mock: shell, accent system, dark mode, transparency fallbacks, 390 px layout.
test.describe.configure({ mode: 'serial' });

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

async function setModules(page: Page, modules: Record<string, boolean>) {
	await page.evaluate(async (modules) => {
		const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
		await fetch('/api/v1/me/modules', {
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
			body: JSON.stringify({ modules })
		});
	}, modules);
}
const allOn = { reports: true, planning: true, transfer: true, automation: true, mcp: true };

test('sidebar groups navigation, hides module entries and filters settings by search', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
	await expect(page.getByTestId('sidebar')).toBeVisible();
	await expect(page.getByTestId('topbar')).toBeVisible();
	for (const group of ['daily', 'planning', 'data', 'admin']) await expect(page.getByTestId(`nav-group-${group}`)).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Heute' })).toHaveAttribute('aria-current', 'page');
	await expect(page.getByTestId('status-line')).toContainText('Online');
	// the sidebar is 256 px wide
	expect((await page.getByTestId('sidebar').boundingBox())!.width).toBe(256);

	await page.getByTestId('settings-search').fill('zeitkonto');
	await page.getByTestId('settings-search-results').getByRole('link', { name: 'Zeitkonto' }).click();
	await expect(page).toHaveURL(/\/settings\/account-time$/);
	await page.getByTestId('settings-search').fill('gibtesnicht');
	await expect(page.getByTestId('settings-search-results')).toContainText('Keine passende Einstellung');

	// module-aware: planning and transfer off hide their entries, restoring brings them back
	await setModules(page, { ...allOn, planning: false, transfer: false });
	await page.goto('/');
	await expect(nav.getByRole('link', { name: 'Urlaub', exact: true })).toHaveCount(0);
	await expect(nav.getByRole('link', { name: 'Export', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('nav-group-data')).toHaveCount(0);
	await expect(nav.getByRole('link', { name: 'Woche', exact: true })).toBeVisible();
	await setModules(page, allOn);
	await page.goto('/');
	await expect(nav.getByRole('link', { name: 'Urlaub', exact: true })).toBeVisible();
	await context.close();
});

test('mobile menu is an off-canvas dialog with focus trap, Escape and close on navigation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await expect(page.getByTestId('sidebar')).toBeHidden();
	const button = page.getByTestId('menu-button');
	await button.click();
	const dialog = page.getByRole('dialog', { name: 'Hauptnavigation' });
	await expect(dialog).toBeVisible();
	// the focus stays inside while tabbing around
	for (let i = 0; i < 25; i++) {
		await page.keyboard.press('Tab');
		expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
	}
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(button).toBeFocused();

	await button.click();
	await dialog.getByRole('link', { name: 'Woche', exact: true }).click();
	await expect(page).toHaveURL(/\/week$/);
	await expect(dialog).toHaveCount(0);
	await context.close();
});

test('accent change persists and updates the contrast tokens', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/appearance');
	await expect(page.getByRole('heading', { name: 'Darstellung', level: 1 })).toBeVisible();
	expect(await cssVar(page, '--ui-accent')).toBe('#2563eb');

	await page.getByTestId('accent-hex').fill('#facc15');
	await page.getByTestId('accent-apply').click();
	expect(await cssVar(page, '--ui-accent')).toBe('#facc15');
	expect(await cssVar(page, '--ui-accent-foreground')).toBe('#000000');
	const ink = await cssVar(page, '--ui-accent-ink');
	expect(ink).not.toBe('#facc15');
	expect(contrast(ink, '#ffffff')).toBeGreaterThanOrEqual(4.5);
	expect(contrast('#000000', '#facc15')).toBeGreaterThanOrEqual(4.5);

	// invalid input is rejected and keeps the previous colour
	await page.getByTestId('accent-hex').fill('rot');
	await page.getByTestId('accent-apply').click();
	await expect(page.getByRole('alert').filter({ hasText: 'Bitte eine Farbe' })).toBeVisible();
	expect(await cssVar(page, '--ui-accent')).toBe('#facc15');

	// dark scheme: ink is lightened/kept readable against the dark background
	await page.getByTestId('mode-dark').click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.getByTestId('accent-hex').fill('#1e3a8a');
	await page.getByTestId('accent-apply').click();
	expect(contrast(await cssVar(page, '--ui-accent-ink'), '#09090b')).toBeGreaterThanOrEqual(4.5);

	// persistence across a reload
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Darstellung', level: 1 })).toBeVisible();
	expect(await cssVar(page, '--ui-accent')).toBe('#1e3a8a');
	await expect(page.locator('html')).toHaveClass(/dark/);

	// the palette in the top bar works as well
	await page.getByTestId('appearance-menu').click();
	const menu = page.getByTestId('topbar');
	await menu.getByTestId('accent-green').click();
	expect(await cssVar(page, '--ui-accent')).toBe('#16a34a');
	await menu.getByRole('button', { name: 'Standard (Blau)' }).click();
	expect(await cssVar(page, '--ui-accent')).toBe('#2563eb');
	await page.keyboard.press('Escape');
	await page.goto('/settings/appearance');
	await page.getByTestId('mode-system').click();
	await context.close();
});

test('dark mode follows the system and can be overridden', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
	await expect(page.locator('html')).toHaveClass(/dark/);
	const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(background).not.toMatch(/^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/);
	await page.goto('/settings/appearance');
	await page.getByTestId('mode-light').click();
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toMatch(/^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/);
	await page.getByTestId('mode-system').click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await context.close();
});

test('reduced transparency and reduced motion fall back to opaque surfaces without animation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	// the header paints its glass on a ::before layer (G1), so that popovers inside it can blur the page behind them
	const blur = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="topbar"]')!, '::before').backdropFilter);
	expect(await blur()).toContain('blur');
	await page.goto('/settings/appearance');
	await page.getByTestId('transparency-toggle').check();
	await expect(page.locator('html')).toHaveAttribute('data-transparency', 'reduced');
	expect(await blur()).toBe('none');
	await page.getByTestId('transparency-toggle').uncheck();
	expect(await blur()).toContain('blur');

	// the built stylesheet carries the media-query and @supports fallbacks
	const rules = await page.evaluate(() => {
		const out: string[] = [];
		const walk = (list: CSSRuleList) => {
			for (const rule of Array.from(list)) {
				if (rule instanceof CSSMediaRule) out.push(`media:${rule.conditionText}`);
				if (rule instanceof CSSSupportsRule) out.push(`supports:${rule.conditionText}`);
				if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
			}
		};
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				walk(sheet.cssRules);
			} catch {
				// cross-origin sheet
			}
		}
		return out;
	});
	expect(rules.some((r) => r.includes('prefers-reduced-transparency'))).toBe(true);
	expect(rules.some((r) => r.startsWith('supports:') && r.includes('not'))).toBe(true);
	expect(rules.some((r) => r.includes('prefers-reduced-motion'))).toBe(true);

	await page.emulateMedia({ reducedMotion: 'reduce' });
	const duration = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="menu-button"], [data-testid="bell"]')!).transitionDuration);
	expect(parseFloat(duration)).toBeLessThan(0.01);
	await context.close();
});

const MAIN_PAGES = [
	'/', '/week', '/calendar', '/reports', '/vacation', '/absences', '/shared', '/suggestions', '/export', '/import', '/notifications',
	'/settings/profile', '/onboarding', '/settings/work-model', '/settings/appearance', '/settings/places', '/settings/account-time', '/settings/learning-fields', '/settings/notifications',
	'/settings/modules', '/settings/devices', '/settings/sharing', '/settings/passkeys', '/settings/identities', '/settings/connections',
	'/settings/api-tokens', '/settings/mcp-help', '/settings/recovery', '/settings/sessions', '/settings/storage', '/admin/invitations', '/admin/modules'
];

test('no horizontal scrolling at 390 px on any main page', async ({ browser }) => {
	test.setTimeout(180_000);
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	for (const route of MAIN_PAGES) {
		await page.goto(route);
		await page.waitForLoadState('networkidle');
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
	}
	await context.close();
});
