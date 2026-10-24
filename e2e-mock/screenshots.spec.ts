import { test } from './test';
import { loginAsAdmin } from './helpers';

// Only runs when SCREENSHOT_DIR is set; used for the manual layout review (390 px phone and desktop, light and dark).
const dir = process.env.SCREENSHOT_DIR;
const routes = ['/', '/time', '/settings/work-model', '/settings/places', '/settings/account-time', '/settings/devices', '/settings/trigger-links', '/suggestions', '/vacation', '/calendar', '/absences', '/settings/sharing', '/shared', '/export', '/import', '/settings/storage'];

let variant = 0;

test.describe('screenshots', () => {
	test.skip(!dir, 'set SCREENSHOT_DIR to capture screenshots');

	for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
		for (const scheme of ['light', 'dark'] as const) {
			test(`${name} ${scheme}`, async ({ browser }) => {
				// every variant imports into its own year: the mock server keeps its state across the variants
				const year = 2033 + variant++;
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
				await page.getByRole('button', { name: 'Stopp' }).click();
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
				// transfer: export, import wizard steps, attachments in the absence form
				await page.goto('/export');
				await page.getByRole('button', { name: 'Exportieren' }).waitFor();
				await page.goto('/import');
				await page.getByTestId('import-file').setInputFiles({
					name: 'zeiten.csv',
					mimeType: 'text/csv',
					buffer: Buffer.from(`Datum;Beginn;Ende;Art\r\n02.03.${year};8:00;12:00;Arbeit\r\n02.03.${year};12:30;16:45;Arbeit\r\nkaputt;8:00;9:00;Arbeit\r\nSumme;;;\r\n`)
				});
				await page.screenshot({ path: `${dir}/${name}-${scheme}-import-1-upload.png`, fullPage: true });
				await page.getByRole('button', { name: 'Weiter' }).click();
				await page.getByTestId('raw-table').waitFor();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-import-2-sheet.png`, fullPage: true });
				await page.getByRole('button', { name: 'Weiter' }).click();
				await page.getByLabel('Zeitformat').selectOption('decimal_hours');
				await page.screenshot({ path: `${dir}/${name}-${scheme}-import-3-mapping.png`, fullPage: true });
				await page.getByLabel('Zeitformat').selectOption('HH:mm');
				await page.getByRole('button', { name: 'Vorschau prüfen' }).click();
				await page.getByTestId('preview-counts').waitFor();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-import-4-preview.png`, fullPage: true });
				await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
				await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
				await page.getByLabel(/Fehlerzeilen überspringen/).check();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-import-5-confirm.png`, fullPage: true });
				await page.getByTestId('commit').click();
				await page.getByTestId('result-created').waitFor();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-import-6-result.png`, fullPage: true });
				await page.goto('/absences');
				await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
				await page.getByTestId('absence-form').getByLabel('Art').selectOption('sick');
				await page.getByTestId('absence-form').getByLabel('Von', { exact: true }).fill(`${year}-06-01`);
				await page.getByTestId('absence-form').getByLabel('Bis', { exact: true }).fill(`${year}-06-02`);
				await page.getByTestId('absence-form').getByRole('button', { name: 'Speichern' }).click();
				for (let i = new Date().getFullYear(); i < year; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
				await page.getByTestId('absence-row').first().getByRole('button', { name: 'Bearbeiten' }).click();
				await page.getByTestId('attachment-file').setInputFiles({ name: 'Krankmeldung.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
				await page.getByRole('button', { name: 'Hochladen' }).click();
				await page.getByTestId('attachment').waitFor();
				await page.screenshot({ path: `${dir}/${name}-${scheme}-absence-attachments.png`, fullPage: true });
				await context.close();
			});
		}
	}
});
