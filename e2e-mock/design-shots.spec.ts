import { test } from '@playwright/test';
import { loginAsAdmin, newAuthenticatorContext } from './helpers';

// Review screenshots for the design language; only runs with SCREENSHOT_DIR (light/dark x 390/1280 px).
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

const pages = ['/', '/time', '/calendar', '/reports', '/vacation', '/absences', '/shared', '/suggestions', '/export', '/import', '/notifications', '/settings/work-model', '/settings/modules', '/settings/appearance', '/settings/places', '/settings/passkeys', '/settings/api-tokens', '/admin/modules', '/admin/invitations'];

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`design shots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR');
			test.setTimeout(240_000);
			const anon = await newAuthenticatorContext(browser, { viewport, colorScheme: scheme });
			await anon.page.goto('/login');
			await anon.page.getByRole('button', { name: 'Mit Passkey anmelden' }).waitFor();
			await anon.page.screenshot({ path: `${dir}/${name}-${scheme}-login.png` });
			await anon.context.close();

			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			for (const route of pages) {
				await page.goto(route);
				await page.waitForLoadState('networkidle');
				await page.screenshot({ path: `${dir}/${name}-${scheme}-${route === '/' ? 'home' : route.slice(1).replace(/\//g, '_')}.png`, fullPage: true });
			}
			await page.goto('/time');
			await page.getByTestId('week-list').getByRole('link').first().click();
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${dir}/${name}-${scheme}-day.png`, fullPage: true });
			// dialogs: help dialog and the mobile menu / appearance popover
			await page.goto('/');
			if (name === 'phone') {
				await page.getByTestId('menu-button').click();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-menu.png` });
				await page.keyboard.press('Escape');
			} else {
				await page.getByTestId('appearance-menu').click();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-appearance-popover.png` });
				await page.keyboard.press('Escape');
			}
			if (name === 'phone') await page.getByTestId('menu-button').click();
			await page.getByRole('button', { name: 'Hilfe' }).click();
			await page.getByTestId('help-dialog').waitFor();
			await page.screenshot({ path: `${dir}/${name}-${scheme}-help-dialog.png` });
			await context.close();
		});
	}
}
