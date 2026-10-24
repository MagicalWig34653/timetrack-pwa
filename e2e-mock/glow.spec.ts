import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Package G1: glass surfaces (backdrop blur on every floating surface) and the glow levels (Leuchteffekt).
test.describe.configure({ mode: 'serial' });

const backdrop = (page: Page, selector: string, pseudo?: string) =>
	page.evaluate(
		([sel, ps]) => {
			const el = document.querySelector(sel)!;
			const style = getComputedStyle(el, ps || null);
			return (style.backdropFilter || (style as unknown as Record<string, string>).webkitBackdropFilter) as string;
		},
		[selector, pseudo ?? ''] as const
	);
const fill = (page: Page, selector: string) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)!).backgroundColor, selector);
const syncState = (page: Page) => page.getByTestId('appearance-sync');
const alphaOf = (color: string) => (color.startsWith('rgba') || color.includes('/') || color.startsWith('color(') ? Number(/[,/]\s*([\d.]+)\)?$/.exec(color)?.[1] ?? 1) : 1);

test('floating surfaces blur what is behind them, also inside the header, and turn opaque with reduced transparency', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/');

	// the accent popover lives in the (blurred) header: no ancestor may be a backdrop root, or the popover would not blur
	await page.getByTestId('appearance-menu').click();
	const panel = page.getByRole('dialog', { name: 'Darstellung und Akzentfarbe' });
	await expect(panel).toBeVisible();
	expect(await backdrop(page, '[role=dialog][aria-label="Darstellung und Akzentfarbe"]')).toContain('blur');
	const rootAncestors = await page.evaluate(() => {
		let node = document.querySelector('[role=dialog][aria-label="Darstellung und Akzentfarbe"]')!.parentElement;
		const found: string[] = [];
		while (node) {
			const style = getComputedStyle(node);
			if (style.backdropFilter !== 'none' || style.filter !== 'none') found.push(node.tagName + '.' + node.className);
			node = node.parentElement;
		}
		return found;
	});
	expect(rootAncestors).toEqual([]);
	expect(await backdrop(page, '[data-testid=topbar]', '::before')).toContain('blur');
	expect(alphaOf(await fill(page, '[role=dialog][aria-label="Darstellung und Akzentfarbe"]'))).toBeLessThan(1);
	await page.keyboard.press('Escape');

	// native dialog and its scrim
	await page.getByRole('button', { name: 'Hilfe' }).first().click();
	await expect(page.getByRole('dialog')).toBeVisible();
	expect(await backdrop(page, 'dialog[open]')).toContain('blur');
	expect(await backdrop(page, 'dialog[open]', '::backdrop')).toContain('blur');
	await page.keyboard.press('Escape');

	// reduced transparency: no blur anywhere, opaque fills
	await page.goto('/settings/appearance');
	await page.getByTestId('transparency-toggle').check();
	await page.goto('/');
	await page.getByTestId('appearance-menu').click();
	expect(await backdrop(page, '[role=dialog][aria-label="Darstellung und Akzentfarbe"]')).toBe('none');
	expect(alphaOf(await fill(page, '[role=dialog][aria-label="Darstellung und Akzentfarbe"]'))).toBe(1);
	expect(await backdrop(page, '[data-testid=topbar]', '::before')).toBe('none');
	expect(await backdrop(page, '[data-testid=sidebar]', '::before')).toBe('none');
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Hilfe' }).first().click();
	expect(await backdrop(page, 'dialog[open]')).toBe('none');
	expect(await backdrop(page, 'dialog[open]', '::backdrop')).toBe('none');
	await context.close();
});

test('the mobile menu drawer and its scrim are glass', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await page.getByTestId('menu-button').click();
	await expect(page.getByTestId('mobile-menu')).toBeVisible();
	expect(await backdrop(page, '[data-testid=mobile-menu] [role=dialog]', '::before')).toContain('blur');
	expect(await backdrop(page, '[data-testid=mobile-menu] .glass-scrim')).toContain('blur');
	await context.close();
});

test('the glow level is chosen on the appearance page and in the palette, saved to the account and applied without a flash', async ({ browser }) => {
	const first = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const { page } = first;
	await page.goto('/settings/appearance');
	await expect(syncState(page)).toHaveAttribute('data-state', 'saved');
	await expect(page.locator('html')).toHaveAttribute('data-glow', 'subtle');
	await expect(page.getByTestId('glow-subtle')).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByTestId('glow-description')).toContainText('kaum sichtbar');

	await page.getByTestId('glow-off').click();
	await expect(page.locator('html')).toHaveAttribute('data-glow', 'off');
	expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=accent-preview] [data-slot=button]')!).boxShadow)).toBe('none');
	await page.getByTestId('glow-strong').click();
	await expect(syncState(page)).toHaveAttribute('data-state', 'saved');
	await expect(page.getByTestId('glow-description')).toContainText('gläserne Fläche');
	expect(await backdrop(page, '.app-sheet')).toContain('blur');
	expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=accent-preview] [data-slot=button]')!).boxShadow)).not.toBe('none');
	expect(await page.evaluate(async () => (await (await fetch('/api/v1/me/preferences', { credentials: 'include' })).json()).glow)).toBe('strong');

	// the sheet is opaque and nothing glows when transparency is reduced
	await page.getByTestId('transparency-toggle').check();
	expect(await backdrop(page, '.app-sheet')).toBe('none');
	expect(alphaOf(await fill(page, '.app-sheet'))).toBe(1);
	expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=accent-preview] [data-slot=button]')!).boxShadow)).toBe('none');
	await page.getByTestId('transparency-toggle').uncheck();

	// the palette popover offers the same control
	await page.getByTestId('appearance-menu').click();
	await page.getByTestId('topbar').getByTestId('glow-medium').click();
	await expect(page.locator('html')).toHaveAttribute('data-glow', 'medium');
	await page.keyboard.press('Escape');

	// a reload applies the cached level before the app starts (early script), another browser gets it from the account
	await page.reload();
	expect(await page.evaluate(() => document.documentElement.dataset.glow)).toBe('medium');
	const second = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await expect.poll(() => second.page.evaluate(() => document.documentElement.dataset.glow)).toBe('medium');
	await first.context.close();
	await second.context.close();
});

test('the new white-text presets are offered, saved and shown with white text', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/appearance');
	for (const id of ['indigo', 'navy', 'purple', 'magenta', 'crimson', 'forest', 'petrol', 'bronze', 'wine', 'slate', 'cocoa', 'olive', 'ocean', 'ink']) {
		await expect(page.getByTestId(`accent-${id}`)).toHaveAttribute('data-white-text', 'true');
	}
	await expect(page.getByTestId('accent-orange')).toHaveAttribute('data-white-text', 'false');
	await page.getByTestId('accent-crimson').click();
	await expect(syncState(page)).toHaveAttribute('data-state', 'saved');
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-accent-foreground').trim())).toBe('#ffffff');
	expect(await page.evaluate(async () => (await (await fetch('/api/v1/me/preferences', { credentials: 'include' })).json()).accent)).toBe('crimson');
	await context.close();
});

test('AC2 accents are saved with their ids and shown with their German names', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/appearance');
	const names = { wine: 'Wein', slate: 'Schiefer', cocoa: 'Kakao', olive: 'Oliv', ocean: 'Ozean', ink: 'Tinte' };
	for (const [id, name] of Object.entries(names)) {
		await expect(page.getByTestId(`accent-${id}`)).toHaveAttribute('aria-label', name);
		await page.getByTestId(`accent-${id}`).click();
		await expect(syncState(page)).toHaveAttribute('data-state', 'saved');
		expect(await page.evaluate(async () => (await (await fetch('/api/v1/me/preferences', { credentials: 'include' })).json()).accent)).toBe(id);
	}
	await page.getByTestId('accent-blue').click();
	await context.close();
});
