import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// J1: switching between pages of one section (settings, admin) must not make the shell jump: the nav keeps its box,
// the content column keeps its x offset and width, and the scroll position behaves predictably.
test.describe.configure({ mode: 'serial' });
// Headless Chromium hides scrollbars by default, which would mask the very shift this spec guards against.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar'] } });

const SETTINGS = [
	'profile', 'work-model', 'appearance', 'places', 'account-time', 'learning-fields', 'notifications', 'modules', 'devices',
	'trigger-links', 'sharing', 'vacation-form', 'passkeys', 'identities', 'connections', 'api-tokens', 'mcp-help', 'recovery',
	'sessions', 'privacy', 'storage'
].map((p) => `/settings/${p}`);

interface Metrics {
	nav: { x: number; y: number; w: number } | null;
	content: { x: number; w: number } | null;
	header: { x: number; y: number; w: number; h: number } | null;
	clientWidth: number; // width of <main>
	scrollY: number;
}

async function measure(page: Page): Promise<Metrics> {
	return page.evaluate(() => {
		const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
		const nav = box(document.querySelector('[data-testid="settings-tabs"]'));
		const content = box(document.querySelector('main [data-testid="settings-content"]'));
		const h1 = box(document.querySelector('main h1'));
		return {
			nav: nav && nav.width ? { x: nav.x, y: nav.y, w: nav.width } : null,
			content: content ? { x: content.x, w: content.width } : null,
			header: h1 ? { x: h1.x, y: h1.y + window.scrollY, w: h1.width, h: h1.height } : null,
			clientWidth: document.querySelector('main')!.getBoundingClientRect().width,
			scrollY: window.scrollY
		};
	});
}

async function settle(page: Page) {
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(150);
}

/** Navigates through the section nav; returns the layout measured right after the URL changed (before data has loaded). */
async function openViaNav(page: Page, route: string, wideNav: boolean): Promise<Metrics> {
	if (!wideNav) await page.getByTestId('settings-nav-toggle').click();
	await page.locator(`#settings-nav-list a[href="${route}"]`).click();
	await page.waitForURL(`**${route}`);
	const early = await measure(page);
	await settle(page);
	return early;
}

// 'tall': a large monitor where short pages fit without a scrollbar and long ones need one
for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['tall', { width: 1280, height: 1400 }], ['phone', { width: 390, height: 800 }]] as const) {
	test(`settings routes keep nav, content column and viewport width stable (${label})`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport });
		await page.goto(SETTINGS[0]);
		await settle(page);
		const base = await measure(page);
		const wideNav = viewport.width >= 1100;
		const problems: string[] = [];
		for (const route of SETTINGS.slice(1)) {
			const early = await openViaNav(page, route, wideNav);
			const m = await measure(page);
			// the page head is part of the first paint and does not move while data loads (no title pop-in)
			if (!early.header) problems.push(`${route}: no page title right after navigation`);
			else if (Math.abs(early.header.y - m.header!.y) > 0.5 || Math.abs(early.header.h - m.header!.h) > 0.5) problems.push(`${route}: title moved while loading (${early.header.y}/${early.header.h} -> ${m.header!.y}/${m.header!.h})`);
			if (early.content && Math.abs(early.content.x - m.content!.x) > 0.5) problems.push(`${route}: content x moved while loading`);
			if (m.header && base.header && Math.abs(m.header.y - base.header.y) > 0.5) problems.push(`${route}: title y ${m.header.y} vs ${base.header.y}`);
			if (m.clientWidth !== base.clientWidth) problems.push(`${route}: main width ${m.clientWidth} vs ${base.clientWidth} (scrollbar toggled)`);
			if (!m.content) problems.push(`${route}: no settings content column`);
			else if (Math.abs(m.content.x - base.content!.x) > 0.5) problems.push(`${route}: content x ${m.content.x} vs ${base.content!.x}`);
			else if (Math.abs(m.content.w - base.content!.w) > 0.5) problems.push(`${route}: content width ${m.content.w} vs ${base.content!.w}`);
			if (wideNav) {
				if (!m.nav) problems.push(`${route}: settings nav missing`);
				else if (Math.abs(m.nav.x - base.nav!.x) > 0.5 || Math.abs(m.nav.w - base.nav!.w) > 0.5) problems.push(`${route}: nav box ${JSON.stringify(m.nav)} vs ${JSON.stringify(base.nav)}`);
			}
			if (m.header && base.header && Math.abs(m.header.x - base.header.x) > 0.5) problems.push(`${route}: title x ${m.header.x} vs ${base.header.x}`);
			if (m.scrollY !== 0) problems.push(`${route}: scrollY ${m.scrollY} after navigation (expected 0 on a new sub page)`);
		}
		expect(problems).toEqual([]);
		await context.close();
	});
}

test('admin mail is reachable from the settings nav without losing the section nav', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 800 } });
	await page.goto('/settings/storage');
	await settle(page);
	const before = await measure(page);
	await openViaNav(page, '/admin/mail', true);
	const after = await measure(page);
	expect(after.nav, 'settings nav stays visible on /admin/mail').not.toBeNull();
	expect(Math.abs(after.nav!.x - before.nav!.x)).toBeLessThan(0.5);
	expect(Math.abs(after.nav!.y - before.nav!.y)).toBeLessThan(0.5);
	expect(Math.abs(after.content!.x - before.content!.x)).toBeLessThan(0.5);
	await context.close();
});

test('scrolled settings page: nav stays sticky under the top bar, new sub page starts at the top', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 600 } });
	await page.goto('/settings/mcp-help');
	await settle(page);
	await page.evaluate(() => window.scrollTo(0, 400));
	await page.waitForTimeout(100);
	const sticky = await page.getByTestId('settings-nav-sticky').boundingBox();
	expect(sticky!.y, 'nav sits below the 60 px top bar').toBeGreaterThanOrEqual(60);
	expect(sticky!.y, 'nav is still on screen').toBeLessThan(120);
	expect(sticky!.y + sticky!.height, 'nav never extends below the window').toBeLessThanOrEqual(600);
	await page.screenshot({ path: 'test-results/j1-sticky.png', scale: 'css' });
	// the last entry is reachable although the list is taller than the window
	await page.locator('#settings-nav-list a[href="/settings/privacy"]').click();
	await page.waitForURL('**/settings/privacy');
	await settle(page);
	expect((await measure(page)).scrollY).toBe(0);
	await context.close();
});

for (const [label, routes] of [
	['admin', ['/admin/invitations', '/admin/accounts', '/admin/modules', '/admin/mail']],
	['main', ['/', '/week', '/reports', '/calendar', '/vacation', '/absences', '/shared']]
] as const) {
	test(`${label} pages keep the viewport width (no scrollbar toggling)`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 800 } });
		const widths: Record<string, number> = {};
		for (const route of routes) {
			await page.goto(route);
			await settle(page);
			widths[route] = (await measure(page)).clientWidth;
		}
		expect(new Set(Object.values(widths)).size, JSON.stringify(widths)).toBe(1);
		await context.close();
	});
}
