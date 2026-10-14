import { test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// Only runs when SCREENSHOT_DIR is set; used for the manual layout review (390 px phone and desktop, light and dark).
const dir = process.env.SCREENSHOT_DIR;
const routes = ['/', '/time', '/settings/work-model', '/settings/places', '/settings/account-time', '/settings/devices', '/suggestions', '/vacation', '/calendar', '/absences', '/settings/sharing', '/shared'];

test.describe('screenshots', () => {
	test.skip(!dir, 'set SCREENSHOT_DIR to capture screenshots');

	for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
		for (const scheme of ['light', 'dark'] as const) {
			test(`${name} ${scheme}`, async ({ browser }) => {
				const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
				const pages = [...routes];
				for (const route of pages) {
					await page.goto(route);
					await page.waitForLoadState('networkidle');
					const file = `${dir}/${name}-${scheme}-${route === '/' ? 'home' : route.slice(1).replace(/\//g, '_')}.png`;
					await page.screenshot({ path: file, fullPage: true });
				}
				// day detail of the most recent weekday with data
				await page.goto('/time');
				await page.getByTestId('week-list').getByRole('link').first().click();
				await page.waitForLoadState('networkidle');
				await page.screenshot({ path: `${dir}/${name}-${scheme}-day.png`, fullPage: true });
				// forms and a running timer
				await page.getByRole('button', { name: 'Korrigieren' }).first().click();
				await page.getByLabel(/^Grund/).fill('x');
				await page.screenshot({ path: `${dir}/${name}-${scheme}-day-correct.png`, fullPage: true });
				await page.goto('/settings/work-model');
				await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-work-model-form.png`, fullPage: true });
				await page.goto('/');
				await page.getByRole('heading', { name: 'Zeiterfassung' }).waitFor();
				if (await page.getByRole('button', { name: 'Start' }).isVisible()) await page.getByRole('button', { name: 'Start' }).click();
				await page.getByTestId('elapsed').waitFor();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-home-running.png`, fullPage: true });
				// planning: day panel with the absence form, shared view
				await page.goto('/calendar');
				await page.locator('[data-date]:visible').nth(2).click();
				await page.getByTestId('day-panel').getByRole('button', { name: 'Abwesenheit anlegen' }).click();
				await page.getByLabel('Art').selectOption('sick');
				await page.screenshot({ path: `${dir}/${name}-${scheme}-calendar-absence-form.png`, fullPage: true });
				await page.goto('/shared');
				await page.getByTestId('incoming-list').getByRole('button').first().click();
				await page.getByTestId('shared-plan').waitFor();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-shared-view.png`, fullPage: true });
				await context.close();
			});
		}
	}
});
