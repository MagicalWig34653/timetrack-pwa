import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// J2: client-side navigation between ANY two app pages must not move the page shell. The spec walks every route (forwards and
// backwards, so each page is both source and target) and compares geometry with the first page, at classic scrollbars.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar'] } });

const MAIN = ['/', '/week', '/suggestions', '/reports', '/calendar', '/vacation', '/vacation/planner', '/absences', '/shared', '/export', '/import', '/plan', '/stats', '/notifications'];
const ADMIN = ['/admin/invitations', '/admin/accounts', '/admin/modules'];
const SETTINGS = [
	'profile', 'work-model', 'appearance', 'places', 'account-time', 'learning-fields', 'notifications', 'modules', 'devices', 'trigger-links',
	'calendar-feeds', 'sharing', 'vacation-form', 'passkeys', 'identities', 'connections', 'api-tokens', 'mcp-help', 'recovery', 'sessions', 'privacy', 'storage'
].map((p) => `/settings/${p}`);
const SETTINGS_SHELL = [...SETTINGS, '/admin/mail'];
const ALL = [...MAIN, ...ADMIN, ...SETTINGS_SHELL];

interface Box { x: number; y: number; w: number; h: number }
interface Shot { main: Box; sidebar: Box | null; content: Box | null; h1: Box | null; overflowX: number; scrollY: number }

async function measure(page: Page): Promise<Shot> {
	return page.evaluate(() => {
		const box = (el: Element | null) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return r.width ? { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height } : null;
		};
		const doc = document.documentElement;
		return {
			main: box(document.querySelector('main'))!,
			sidebar: box(document.querySelector('[data-testid="sidebar"]')),
			content: box(document.querySelector('[data-testid="settings-content"]')),
			h1: box(document.querySelector('main h1')),
			overflowX: doc.scrollWidth - doc.clientWidth,
			scrollY: window.scrollY
		};
	});
}

/** Client-side navigation (SvelteKit intercepts anchor clicks), so the shell is not re-created by a full page load. */
async function go(page: Page, route: string) {
	await page.evaluate((href) => {
		const a = document.createElement('a');
		a.href = href;
		document.body.append(a);
		a.click();
		a.remove();
	}, route);
	await page.waitForURL((u) => (route === '/' ? u.pathname === '/' : u.pathname.startsWith(route)));
}

const same = (a: number, b: number) => Math.abs(a - b) <= 0.5;

for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['tall', { width: 1280, height: 1400 }], ['tablet', { width: 900, height: 800 }], ['phone', { width: 390, height: 800 }]] as const) {
	test(`every route keeps shell geometry across navigation (${label})`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport });
		const problems: string[] = [];
		let base: Shot | null = null;
		let settingsBase: Shot | null = null;
		let visits = 0;
		for (const route of [...ALL, ...[...ALL].reverse()]) {
			await go(page, route);
			const early = await measure(page);
			await page.waitForTimeout(350);
			const late = await measure(page);
			visits++;
			base ??= late;
			const at = `${route}`;
			if (!same(late.main.x, base.main.x) || !same(late.main.w, base.main.w)) problems.push(`${at}: main x/w ${late.main.x}/${late.main.w} vs ${base.main.x}/${base.main.w}`);
			if (base.sidebar && late.sidebar && (!same(late.sidebar.x, base.sidebar.x) || !same(late.sidebar.w, base.sidebar.w))) problems.push(`${at}: sidebar moved`);
			if (late.overflowX > 0) problems.push(`${at}: horizontal page overflow ${late.overflowX}px`);
			if (!same(early.main.w, late.main.w) || !same(early.main.x, late.main.x)) problems.push(`${at}: main moved while loading`);
			if (early.h1 && late.h1 && (!same(early.h1.x, late.h1.x) || !same(early.h1.y, late.h1.y))) problems.push(`${at}: title moved while loading`);
			if (late.scrollY !== 0) problems.push(`${at}: scrollY ${late.scrollY}`);
			if (SETTINGS_SHELL.includes(route)) {
				settingsBase ??= late;
				if (!late.content || !same(late.content.x, settingsBase.content!.x) || !same(late.content.w, settingsBase.content!.w)) problems.push(`${at}: settings content column moved`);
				if (late.h1 && settingsBase.h1 && (!same(late.h1.x, settingsBase.h1.x) || !same(late.h1.y, settingsBase.h1.y))) problems.push(`${at}: settings title ${late.h1.x}/${late.h1.y} vs ${settingsBase.h1.x}/${settingsBase.h1.y}`);
			}
		}
		expect(visits).toBe(ALL.length * 2);
		expect(problems).toEqual([]);
		await context.close();
	});
}

test('settings nav stays mounted: its scroll position and DOM node survive a page change', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 500 } });
	await page.goto('/settings/profile');
	await expect(page.getByTestId('settings-tabs')).toBeVisible();
	await page.evaluate(() => {
		(document.querySelector('[data-testid="settings-tabs"]') as HTMLElement).dataset.mark = 'kept';
		document.querySelector('[data-testid="settings-nav-sticky"]')!.scrollTop = 200;
	});
	for (const route of ['/settings/privacy', '/admin/mail', '/settings/places']) {
		await page.locator(`#settings-nav-list a[href="${route}"]`).click();
		await page.waitForURL(`**${route}`);
		const state = await page.evaluate(() => ({
			mark: (document.querySelector('[data-testid="settings-tabs"]') as HTMLElement | null)?.dataset.mark ?? 'lost',
			scroll: document.querySelector('[data-testid="settings-nav-sticky"]')!.scrollTop
		}));
		// /admin/mail has its own layout component (separate route tree), so only the settings pages must keep the node
		if (route.startsWith('/settings/')) expect(state, route).toEqual({ mark: 'kept', scroll: 200 });
		else await page.evaluate(() => { (document.querySelector('[data-testid="settings-tabs"]') as HTMLElement).dataset.mark = 'kept'; document.querySelector('[data-testid="settings-nav-sticky"]')!.scrollTop = 200; });
	}
	await context.close();
});
