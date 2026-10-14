import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers';

// Berichtsheft against the in-repo mock API, serially on one server. Weeks lie in 2033 so nothing depends on "today".
test.describe.configure({ mode: 'serial' });

const WEEK = '/reports?year=2033&week=10'; // Mon 07.03.2033 .. Sun 13.03.2033
const MONDAY = '2033-03-07';
const TUESDAY = '2033-03-08';
const OTHER_WEEK = '/reports?year=2033&week=20'; // Mon 16.05.2033
const OTHER_MONDAY = '2033-05-16';
const day = (page: Page, date: string) => page.locator(`[data-testid="day"][data-date="${date}"]`);

async function addEntry(page: Page, date: string, field: string, duration: string, notes = '') {
	await day(page, date).getByTestId('add-entry').click();
	const form = day(page, date).getByTestId('entry-form');
	await form.getByTestId('entry-field').fill(field);
	await form.getByTestId('entry-duration').fill(duration);
	if (notes) await form.getByTestId('entry-notes').fill(notes);
	await form.getByTestId('entry-save').click();
	await expect(day(page, date).getByTestId('entry-form')).toHaveCount(0);
}

test('learning fields: create, edit, delete with confirmation; the list feeds the entry form', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/settings/learning-fields');
	await expect(page.getByTestId('learning-note')).toContainText('behalten den Namen');
	await page.getByTestId('learning-add').click();
	await page.getByTestId('learning-number').fill('4');
	await page.getByTestId('learning-name').fill('Netzwerke einrichten');
	await page.getByTestId('learning-save').click();
	await expect(page.getByTestId('learning-field')).toHaveText(/4 · Netzwerke einrichten/);

	await page.getByTestId('learning-add').click();
	await page.getByTestId('learning-name').fill('Betrieb');
	await page.getByTestId('learning-save').click();
	await expect(page.getByTestId('learning-field')).toHaveCount(2);

	// duplicate name
	await page.getByTestId('learning-add').click();
	await page.getByTestId('learning-name').fill('betrieb');
	await page.getByTestId('learning-save').click();
	await expect(page.getByTestId('learning-form-error')).toContainText('gibt es schon');
	await page.getByRole('button', { name: 'Abbrechen' }).click();

	// the combobox offers the list
	await page.goto(OTHER_WEEK);
	await day(page, OTHER_MONDAY).getByTestId('add-entry').click();
	const listId = await page.getByTestId('entry-field').getAttribute('list');
	await expect(page.locator(`datalist#${listId} option`)).toHaveCount(2);

	// rename keeps the old entry name; delete asks first
	await page.getByTestId('entry-field').fill('Netzwerke einrichten');
	await page.getByTestId('entry-duration').fill('1:00');
	await page.getByTestId('entry-save').click();
	await expect(day(page, OTHER_MONDAY).getByTestId('entry-learning-field')).toHaveText('Netzwerke einrichten');
	await page.goto('/settings/learning-fields');
	await page.getByRole('button', { name: 'Lernfeld „Netzwerke einrichten“ bearbeiten' }).click();
	await page.getByTestId('learning-name').fill('Netze');
	await page.getByTestId('learning-save').click();
	await expect(page.getByTestId('learning-list')).toContainText('4 · Netze');
	await page.getByRole('button', { name: 'Lernfeld „Betrieb“ löschen' }).click();
	await expect(page.getByTestId('learning-delete-confirm')).toContainText('Bestehende Einträge behalten den Namen');
	await page.getByTestId('learning-delete-yes').click();
	await expect(page.getByTestId('learning-field')).toHaveCount(1);
	await page.goto(OTHER_WEEK);
	await expect(day(page, OTHER_MONDAY).getByTestId('entry-learning-field')).toHaveText('Netzwerke einrichten');
	await context.close();
});

test('add entries, live duration hint, totals per day and learning field, tracked-time hint', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(WEEK);
	await expect(page.getByTestId('week-heading')).toHaveText('KW 10/2033');
	await expect(page.getByTestId('tracked-hint')).toContainText('Arbeitszeit laut Zeiterfassung: 0:00 h');
	await day(page, TUESDAY).getByTestId('add-entry').click();
	await page.getByTestId('entry-duration').fill('7,7');
	await expect(page.getByTestId('entry-duration-parsed')).toContainText('Gelesen als 7:42 h');
	await expect(page.getByTestId('entry-duration-parsed')).toContainText('nicht 7:07');
	await page.getByTestId('entry-duration').fill('1,5');
	await expect(page.getByTestId('entry-duration-parsed')).toContainText('Gelesen als 1:30 h');
	await page.getByRole('button', { name: 'Abbrechen' }).click();

	await addEntry(page, TUESDAY, 'Betrieb', '1,5', 'Ticketsystem');
	await addEntry(page, TUESDAY, 'Betrieb', '0:30');
	await addEntry(page, MONDAY, 'Schule', '2');
	await expect(day(page, TUESDAY).getByTestId('entry')).toHaveCount(2);
	await expect(page.getByTestId('week-total')).toHaveText('4:00 h');
	await expect(page.getByTestId('by-field-row')).toHaveText([/Schule\s*2:00 h/, /Betrieb\s*2:00 h/]);
	await expect(page.getByTestId('toast')).toHaveText('Eintrag gespeichert.');
	await context.close();
});

test('edit with a conflict: 412 offers the current version or keeping my input', async ({ browser }) => {
	const first = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const second = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await first.page.goto(WEEK);
	await second.page.goto(WEEK);
	const open = (page: Page) => day(page, MONDAY).getByRole('button', { name: 'Eintrag „Schule“ bearbeiten' });

	await open(first.page).click();
	await open(second.page).click();
	const other = day(second.page, MONDAY).getByTestId('entry-form');
	await other.getByTestId('entry-duration').fill('3:00');
	await other.getByTestId('entry-save').click();
	await expect(day(second.page, MONDAY).getByTestId('entry-duration-shown')).toHaveText('3:00 h');

	const mine = day(first.page, MONDAY).getByTestId('entry-form');
	await mine.getByTestId('entry-notes').fill('meine Notiz');
	await mine.getByTestId('entry-save').click();
	await expect(mine.getByTestId('entry-stale')).toContainText('Der Eintrag wurde zwischenzeitlich geändert.');
	await expect(mine.getByTestId('entry-stale-current')).toContainText('Schule, 3:00 h');
	await mine.getByRole('button', { name: 'Aktuelle Fassung laden' }).click();
	await expect(mine.getByTestId('entry-duration')).toHaveValue('3:00');
	await expect(mine.getByTestId('entry-notes')).toHaveValue('');

	// own input on top of the new version
	await mine.getByTestId('entry-notes').fill('meine Notiz');
	await mine.getByTestId('entry-save').click();
	await expect(day(first.page, MONDAY).getByTestId('entry-notes-shown')).toHaveText('meine Notiz');
	await expect(day(first.page, MONDAY).getByTestId('entry-duration-shown')).toHaveText('3:00 h');
	await first.context.close();
	await second.context.close();
});

test('delete asks for confirmation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(WEEK);
	await day(page, TUESDAY).getByRole('button', { name: 'Eintrag „Betrieb“ löschen' }).first().click();
	await expect(page.getByTestId('entry-delete-confirm')).toContainText('wirklich löschen');
	await page.getByTestId('entry-delete-confirm').getByRole('button', { name: 'Abbrechen' }).click();
	await expect(day(page, TUESDAY).getByTestId('entry')).toHaveCount(2);
	await day(page, TUESDAY).getByRole('button', { name: 'Eintrag „Betrieb“ löschen' }).first().click();
	await page.getByTestId('entry-delete-yes').click();
	await expect(day(page, TUESDAY).getByTestId('entry')).toHaveCount(1);
	await context.close();
});

test('copy as text: clipboard receives the standard format and a toast confirms', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto(WEEK);
	await page.getByTestId('copy-text').click();
	await expect(page.getByTestId('toast')).toHaveText('In die Zwischenablage kopiert');
	const text = await page.evaluate(() => navigator.clipboard.readText());
	expect(text.split('\n')).toEqual([
		'Berichtsheft KW 10/2033 (07.03.2033 – 13.03.2033)',
		'',
		'Montag, 07.03.2033',
		'Schule | 3:00 h | meine Notiz',
		'',
		'Dienstag, 08.03.2033',
		'Betrieb | 0:30 h |',
		'',
		'Wochensumme: 3:30 h',
		''
	]);

	// preview dialog shows the same text and copies again
	await page.getByTestId('copy-preview').click();
	const dialog = page.getByTestId('text-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('text-preview')).toHaveValue(text);
	await dialog.getByRole('button', { name: 'Schließen' }).click();
	await expect(dialog).toBeHidden();
	await context.close();
});

test('copy as text without clipboard permission falls back to a selected text in the dialog', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(WEEK);
	await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }));
	await page.getByTestId('copy-text').click();
	const dialog = page.getByTestId('text-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('copy-fallback')).toContainText('Strg+C');
	const selected = await dialog.getByTestId('text-preview').evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
	expect(selected).toContain('Wochensumme: 3:30 h');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await context.close();
});

test('week status toggles, persists and does not lock editing', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(WEEK);
	await expect(page.getByTestId('status-draft')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('status-done').click();
	await expect(page.getByTestId('week-status-badge')).toHaveText('Erledigt');
	await page.reload();
	await expect(page.getByTestId('status-done')).toHaveAttribute('aria-pressed', 'true');
	await addEntry(page, MONDAY, 'Schule', '0:15');
	await expect(page.getByTestId('status-done')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('status-draft').click();
	await expect(page.getByTestId('week-status-badge')).toHaveText('Entwurf');
	await context.close();
});

test('week navigation: previous/next, jump, week 53 and invalid weeks', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(WEEK);
	await page.getByTestId('week-next').click();
	await expect(page.getByTestId('week-heading')).toHaveText('KW 11/2033');
	await expect(page).toHaveURL(/year=2033&week=11/);
	await expect(page.getByTestId('week-total')).toHaveText('0:00 h');
	await page.getByTestId('week-prev').click();
	await expect(page.getByTestId('week-total')).toHaveText('3:45 h');

	await page.getByTestId('week-year').fill('2026');
	await page.getByTestId('week-number').fill('53');
	await page.getByTestId('week-number').press('Enter');
	await expect(page.getByTestId('week-range')).toHaveText('28.12.2026 bis 03.01.2027');
	await page.getByTestId('week-next').click();
	await expect(page.getByTestId('week-heading')).toHaveText('KW 1/2027');
	await page.getByTestId('week-year').fill('2027');
	await page.getByTestId('week-number').fill('53');
	await page.getByTestId('week-number').press('Enter');
	await expect(page.getByTestId('week-nav-error')).toHaveText('Dieses Jahr hat nur 52 Kalenderwochen.');
	await page.getByTestId('week-today').click();
	await expect(page.getByTestId('week-today')).toBeDisabled();
	await context.close();
});

test('sources: text note and file upload, download and removal', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(WEEK);
	const sources = page.getByTestId('sources');
	await sources.getByTestId('source-note').fill('Stichpunkte: Router konfiguriert');
	await sources.getByTestId('source-day').selectOption(TUESDAY);
	await sources.getByTestId('source-note-add').click();
	await expect(sources.getByTestId('source')).toHaveCount(1);

	await sources.getByTestId('source-file').setInputFiles({ name: 'skript.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%mock\n') });
	await expect(sources.getByTestId('source-picked')).toContainText('skript.pdf');
	await sources.getByTestId('source-upload').click();
	await expect(sources.getByTestId('source')).toHaveCount(2);

	const downloadPromise = page.waitForEvent('download');
	await sources.getByRole('button', { name: 'Datei „skript.pdf“ herunterladen' }).click();
	expect((await downloadPromise).suggestedFilename()).toBe('skript.pdf');

	await sources.getByTestId('source-file').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
	await expect(sources.getByTestId('sources-error')).toContainText('Dieser Dateityp ist nicht erlaubt');

	await page.reload();
	await expect(page.getByTestId('sources').getByTestId('source')).toHaveCount(2);
	await page.getByTestId('sources').getByRole('button', { name: 'Quelle „skript.pdf“ entfernen' }).click();
	await expect(page.getByTestId('sources').getByTestId('source')).toHaveCount(1);
	await context.close();
});

test('dashboard teaser shows the entry count of the current week and opens the Berichtsheft', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/reports');
	await expect(page.getByTestId('week-heading')).toHaveText(/^KW \d+\/\d{4}$/);
	const today = await page.locator('[data-testid="day"][aria-current="date"]').getAttribute('data-date');
	await addEntry(page, today!, 'Betrieb', '1:00');
	await page.goto('/');
	await expect(page.getByTestId('reports-teaser-count')).toHaveText('1 Eintrag in dieser Woche');
	await page.getByRole('link', { name: 'Berichtsheft öffnen' }).click();
	await expect(page).toHaveURL(/\/reports\?year=\d{4}&week=\d+/);
	await expect(page.getByTestId('week-total')).toHaveText('1:00 h');
	await context.close();
});

// Layout review: 390 px phone and desktop, light and dark. Only with SCREENSHOT_DIR.
const dir = process.env.SCREENSHOT_DIR;
test.describe('reports screenshots', () => {
	test.skip(!dir, 'set SCREENSHOT_DIR to capture screenshots');
	for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
		for (const scheme of ['light', 'dark'] as const) {
			test(`${name} ${scheme}`, async ({ browser }) => {
				const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
				await page.goto(WEEK);
				await page.getByTestId('week-total').waitFor();
				await page.waitForLoadState('networkidle');
				const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
				expect(hasOverflow, 'horizontal page scroll').toBe(false);
				await page.screenshot({ path: `${dir}/reports-${name}-${scheme}-week.png`, fullPage: true });
				await day(page, MONDAY).getByRole('button', { name: /bearbeiten/ }).first().click();
				await page.getByTestId('entry-duration').fill('7,7');
				await page.screenshot({ path: `${dir}/reports-${name}-${scheme}-form.png`, fullPage: true });
				await page.getByRole('button', { name: 'Abbrechen' }).click();
				await page.getByTestId('copy-preview').click();
				await page.getByTestId('text-dialog').waitFor();
				await page.screenshot({ path: `${dir}/reports-${name}-${scheme}-dialog.png` });
				await page.keyboard.press('Escape');
				await page.goto('/settings/learning-fields');
				await page.getByTestId('learning-add').click();
				await page.waitForLoadState('networkidle');
				const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
				expect(overflow, 'horizontal page scroll on learning fields').toBe(false);
				await page.screenshot({ path: `${dir}/reports-${name}-${scheme}-learning.png`, fullPage: true });
				await page.goto('/');
				await page.getByTestId('reports-teaser').waitFor();
				await page.screenshot({ path: `${dir}/reports-${name}-${scheme}-home.png`, fullPage: true });
				await context.close();
			});
		}
	}
});
