import { expect, test, type Page } from '@playwright/test';
import { buildWorktimeWorkbook, type WorktimeWorkbookInput } from '../mock/worktime-xlsx';
import { loginAsAdmin } from './helpers';

// Worktime workbook profile (ADR-0013) and the excused type against the in-repo mock API, serially on one server.
// All workbooks are synthetic. Dates lie in 2036 (Monday 2036-03-03) so the specs do not depend on the demo data.
test.describe.configure({ mode: 'serial' });

const day = (date: string, start: string | null, end: string | null, remark?: string) => ({ date, start, end, remark });
const book = (input: WorktimeWorkbookInput, name = 'Arbeitszeit.xlsx') => ({
	name,
	mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	buffer: Buffer.from(buildWorktimeWorkbook(input))
});

const WEEK = book({
	sheets: [
		{
			year: 2036,
			days: [
				day('2036-03-03', '8:00:20', '16:12'),
				day('2036-03-04', '8:00', '16:12', 'Urlaub'),
				day('2036-03-05', '8:00', '16:12', 'Urlaub (Freigestellt)'),
				day('2036-03-06', '9:00', '13:00', 'Arzttermin'),
				day('2036-03-07', '8:00', '16:12')
			]
		}
	]
});

/**
 * Recognition (step 1) -> preview. The legacy specs import full-day credits and expect absences; other specs of the shared mock server
 * may create work models with another day target, so they pin partialCredit to "absence" (the C23 default is covered by the C23 specs).
 */
async function toPreview(page: Page, file = WEEK, pinAbsence = true) {
	await page.goto('/import');
	await page.getByTestId('import-file').setInputFiles(file);
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Datei wählen');
	await expect(page.getByTestId('profile-banner')).toContainText('Das ist deine Arbeitszeit-Tabelle');
	await expect(page.getByTestId('profile-template')).toContainText('Vorlage: Meine Arbeitszeit-Tabelle (empfohlen)');
	await page.getByTestId('profile-next').click();
	await expect(page.getByTestId('step-heading')).toHaveText('Vorschau');
	await expect(page.getByTestId('worktime-preview')).toBeVisible();
	if (pinAbsence) {
		await openCustomize(page);
		await page.getByTestId('wt-credit-absence').check();
		await expect(page.getByTestId('wt-refreshing')).toHaveCount(0); // the preview has been refreshed with the new option
	}
}

/** Opens the collapsed "Anpassen (nur wenn nötig)" section. */
async function openCustomize(page: Page, expert = false) {
	const details = page.getByTestId('wt-customize');
	if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator('summary').first().click();
	if (expert) {
		const inner = page.getByTestId('wt-expert');
		if (!(await inner.evaluate((el) => (el as HTMLDetailsElement).open))) await inner.locator('summary').first().click();
	}
}

test('worktime import: recognition card, preview with summary, remark rule, one button commits, excused shows in calendar and day', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await toPreview(page);
	await expect(page.getByTestId('wt-summary')).toContainText('Das wird importiert:');
	await expect(page.getByRole('button', { name: 'Jetzt importieren' })).toHaveCount(1);
	await expect(page.getByTestId('wt-count-segments')).toHaveText('6');
	await expect(page.getByTestId('wt-count-absences')).toHaveText('2');
	await expect(page.getByTestId('wt-range')).toContainText('03.03.2036');
	await expect(page.getByTestId('wt-balance')).toContainText('Zeitkonto: Tabelle gegen App');
	await openCustomize(page, true);
	await expect(page.getByTestId('wt-rules-intro')).toContainText('erste passende Zeile von oben');
	await expect(page.getByTestId('wt-rule')).toHaveCount(6);
	await expect(page.getByTestId('wt-unmapped')).toContainText('Arzttermin');
	// one click remembers the meaning and refreshes the preview
	await page.getByRole('button', { name: 'Bedeutung für „Arzttermin“ merken' }).click();
	await expect(page.getByTestId('wt-unmapped')).toHaveCount(0);
	await expect(page.getByTestId('import-notice')).toContainText('Gemerkt');
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('step-heading')).toHaveText('Ergebnis');
	await expect(page.getByTestId('result-created')).toHaveText(/6 Einträge angelegt/);
	await expect(page.getByTestId('result-absences')).toContainText('2 Abwesenheiten angelegt');

	// excused: calendar chip, day mark with target 0
	await page.goto('/calendar?date=2036-03-05');
	await expect(page.locator('[data-date="2036-03-05"]:visible [data-chip="absence"]')).toContainText('Freigestellt');
	await expect(page.locator('[data-date="2036-03-04"]:visible [data-chip="absence"]')).toContainText('Urlaub');
	await page.goto('/time/2036-03-05');
	await expect(page.getByTestId('day-summary')).toContainText('Freigestellt');
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await expect(page.getByTestId('day-target-note')).toContainText('Freigestellt');
	await context.close();
});

test('worktime import: re-import is detected as duplicates, a changed absence makes the rollback list typed conflicts', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await toPreview(page);
	await expect(page.getByTestId('wt-summary')).toContainText('Alles aus dieser Datei ist schon in der App');
	await expect(page.getByTestId('commit')).toBeDisabled();
	await context.close();

	const second = await loginAsAdmin(browser);
	const fresh = book({ sheets: [{ year: 2036, days: [day('2036-04-07', '8:00', '16:12', 'Urlaub'), day('2036-04-08', '8:00', '16:12', 'Urlaub'), day('2036-04-09', '8:00', '12:00')] }] });
	await toPreview(second.page, fresh);
	await second.page.getByTestId('commit').click();
	await expect(second.page.getByTestId('result-created')).toBeVisible();
	const changed = await second.page.evaluate(async () => {
		const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
		const list = await (await fetch('/api/v1/absences?from=2036-04-01&to=2036-04-30', { credentials: 'include' })).json();
		const response = await fetch(`/api/v1/absences/${list[0].id}`, {
			method: 'PUT',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'If-Match': String(list[0].version) },
			body: JSON.stringify({ kind: list[0].kind, startDate: list[0].startDate, endDate: list[0].endDate, status: list[0].status, note: 'geändert' })
		});
		return response.status;
	});
	expect(changed).toBe(200);
	await second.page.getByTestId('rollback').click();
	await second.page.getByTestId('rollback-confirm').click();
	await expect(second.page.getByTestId('rollback-conflicts')).toContainText('Abwesenheit');
	await expect(second.page.getByTestId('import-error')).toContainText('nicht zurückgenommen werden');
	await second.context.close();
});

test('worktime import: "Stattdessen Spalten selbst zuordnen" leaves the template, the generic wizard can return to it', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/import');
	await page.getByTestId('import-file').setInputFiles(WEEK);
	await page.getByRole('button', { name: 'Weiter' }).click();
	await page.getByTestId('profile-switch-generic').click();
	await expect(page.getByTestId('no-header')).toBeVisible();
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Spalten');
	await page.getByRole('button', { name: 'Zurück' }).click();
	await page.getByTestId('profile-switch-worktime').click();
	await expect(page.getByTestId('step-heading')).toHaveText('Vorschau');
	await expect(page.getByTestId('worktime-preview')).toBeVisible();
	await context.close();
});

test('worktime import: the empty template file can be downloaded from step 1', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/import');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('template-file-download').click()]);
	expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
	await expect(page.getByTestId('import-notice')).toContainText('Vorlage für');
	await context.close();
});

test('excused: absence form hint, list filter and vacation balance stays untouched', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/vacation');
	const before = await page.getByTestId('balance-available').textContent();
	await page.goto('/calendar?date=2036-06-02');
	await page.locator('[data-date="2036-06-03"]:visible').click();
	await page.getByTestId('day-panel').getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	await page.getByLabel('Art').selectOption('excused');
	await expect(page.getByTestId('absence-excused-hint')).toContainText('verbraucht keinen Urlaub');
	await page.locator('#abs-status').selectOption('approved');
	await page.getByTestId('absence-form').getByRole('button', { name: 'Speichern' }).click();
	await page.goto('/absences');
	for (let i = new Date().getFullYear(); i < 2036; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
	await page.getByLabel('Art', { exact: true }).selectOption('excused');
	// the imported day of the first test plus the one created here
	await expect(page.getByTestId('absence-row')).toHaveCount(2);
	await expect(page.getByTestId('absence-row').last()).toContainText('Freigestellt');
	await page.getByLabel('Art', { exact: true }).selectOption('sick');
	await expect(page.getByTestId('absences-empty')).toBeVisible();
	await page.goto('/vacation');
	await expect(page.getByTestId('balance-available')).toHaveText(before ?? '');
	await context.close();
});

test('export: worktime workbook option downloads an xlsx with the server filename', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/export');
	await page.getByRole('radio', { name: /Arbeitszeit-Tabelle/ }).check();
	await expect(page.getByTestId('export-worktime')).toContainText('behält die Formeln');
	await expect(page.getByTestId('export-worktime')).toContainText('Mac-Excel-Altformat');
	await page.getByLabel('Von').fill('2036-03-01');
	await page.getByLabel('Bis').fill('2036-03-31');
	await page.getByLabel('Datumssystem').selectOption('1904');
	await page.getByRole('radio', { name: /Tatsächlich/ }).check();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportieren' }).click()]);
	expect(download.suggestedFilename()).toBe('Arbeitszeit-Tabelle_2036-03-01_2036-03-31.xlsx');
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
	await expect(page.getByTestId('export-done')).toContainText('Arbeitszeit-Tabelle_2036-03-01_2036-03-31.xlsx');
	await context.close();
});

// C23: holiday times, partial credit, balance split, model start hint. The 2020 rows lie in the past (balance up to today),
// the 2036 rows in the future; 2020-03-05 and 2036-12-25 are Thursdays (first content day in the middle of the week).
const C23 = book({
	sheets: [
		{ year: 2020, days: [day('2020-03-05', '8:00', '16:12'), day('2020-03-06', '8:00', '11:00', 'Freigestellt')] },
		{ year: 2036, days: [day('2036-12-25', '8:00', '16:12'), day('2036-12-26', '8:00', '12:00', 'BS')] }
	]
});

test('worktime import: warnings in plain words, option changes refresh the preview, balance split', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await toPreview(page, C23, false);
	await openCustomize(page);
	await expect(page.getByTestId('wt-holiday-discard')).toBeChecked();
	await expect(page.getByTestId('wt-credit-work')).toBeChecked();
	await expect(page.getByTestId('wt-day-options')).toContainText('Mehrarbeit');

	const warnings = page.getByTestId('wt-warnings');
	await expect(warnings.locator('[data-code="holiday_times_discarded"]')).toContainText('1 Tag');
	await expect(warnings.locator('[data-code="school_on_holiday"]')).toContainText('An Feiertagen steht in der Tabelle eine Schulzeit.');
	await expect(warnings.locator('[data-code="credit_partial_as_work"]')).toContainText('Muss ich etwas tun?');
	await expect(page.getByTestId('wt-balance-value')).toHaveText('-5:12');
	await expect(page.getByTestId('wt-balance-future')).toHaveText('-4:12');
	await expect(page.getByTestId('wt-balance-total')).toContainText('-9:24');

	// both options switched: the preview refreshes by itself and shows no warnings
	await page.getByTestId('wt-holiday-keep').check();
	await page.getByTestId('wt-credit-absence').check();
	await expect(page.getByTestId('wt-warnings')).toHaveCount(0);
	await expect(page.getByTestId('commit')).toBeEnabled();
	// back to the recommendation with one button
	await page.getByTestId('wt-reset').click();
	await expect(page.getByTestId('wt-holiday-discard')).toBeChecked();
	await expect(page.getByTestId('wt-warnings')).toBeVisible();
	await context.close();
});

test('worktime import: result has ONE next step, the work model from the first day; a failure keeps the state and offers a retry', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const thursday = book({ sheets: [{ year: 2036, days: [day('2036-09-04', '8:00', '16:12'), day('2036-09-05', '8:00', '16:12'), day('2036-12-25', '8:00', '16:12')] }] });
	await toPreview(page, thursday, false);
	await expect(page.getByTestId('wt-model-pending')).toBeVisible();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('result-warnings').locator('[data-code="holiday_times_discarded"]')).toHaveAttribute('data-count', '1');
	await expect(page.getByTestId('wt-model-start')).toHaveAttribute('data-kind', 'earlier');
	await expect(page.getByTestId('wt-model-create')).toHaveText('Arbeitsmodell anlegen (ab 04.09.2036)');
	await expect(page.getByTestId('wt-next-why')).toContainText('Soll');
	// first try fails (simulated server answer), the page keeps its state and offers a retry
	let failOnce = true;
	await page.route('**/api/v1/work-models', async (route) => {
		if (route.request().method() === 'POST' && failOnce) {
			failOnce = false;
			await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'model_overlap', message: 'x' } }) });
		} else await route.continue();
	});
	await page.getByTestId('wt-model-create').click();
	await expect(page.getByTestId('wt-model-error')).toContainText('überschneidet sich mit einer späteren Arbeitsmodell-Version');
	await expect(page.getByTestId('result-created')).toBeVisible();
	await expect(page.getByTestId('wt-model-create')).toHaveText('Erneut versuchen');
	await page.getByTestId('wt-model-create').click();
	await expect(page.getByTestId('wt-model-done')).toContainText('ab 04.09.2036');
	await expect(page.getByTestId('wt-continue')).toHaveAttribute('href', '/time/2036-09-04');
	await context.close();
});

// Layout review (390 px phone and desktop, light and dark); only with SCREENSHOT_DIR set.
const dir = process.env.SCREENSHOT_DIR;
test.describe('worktime screenshots', () => {
	test.skip(!dir, 'set SCREENSHOT_DIR to capture screenshots');
	let variant = 0;
	for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
		for (const scheme of ['light', 'dark'] as const) {
			test(`${name} ${scheme}`, async ({ browser }) => {
				variant++;
				// every variant imports its own year (the mock server keeps the data between the specs)
				const y = 2040 + variant;
				const file = book({
					sheets: [
						{
							year: y,
							days: [
								day(`${y}-03-05`, '8:00:20', '16:12'),
								day(`${y}-03-06`, '8:00', '11:00', 'Freigestellt'),
								day(`${y}-03-09`, '8:00', '16:12', 'Urlaub'),
								day(`${y}-03-10`, '8:00', '16:12', 'Krank'),
								day(`${y}-03-11`, '8:00', '16:12', 'Berufsschule'),
								day(`${y}-03-12`, '9:00', '13:00', 'Arzttermin'),
								day(`${y}-12-25`, '8:00', '16:12'),
								day(`${y}-12-26`, '8:00', '12:00', 'BS')
							]
						}
					]
				}); // warnings, balance split and the work model step
				const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
				const shot = (label: string) => page.screenshot({ path: `${dir}/worktime-${name}-${scheme}-${label}.png`, fullPage: true });
				await page.goto('/import');
				await shot('upload');
				await page.getByTestId('import-file').setInputFiles(file);
				await page.getByRole('button', { name: 'Weiter' }).click();
				await page.getByTestId('profile-banner').waitFor();
				await page.getByTestId('profile-facts').waitFor();
				await shot('recognized');
				await page.getByTestId('profile-next').click();
				await page.getByTestId('worktime-preview').waitFor();
				await shot('preview');
				await page.getByTestId('wt-customize').locator('summary').first().click();
				await page.getByTestId('wt-day-options').scrollIntoViewIfNeeded();
				await shot('options');
				await page.getByTestId('wt-expert').locator('summary').first().click();
				await page.getByTestId('wt-rules').scrollIntoViewIfNeeded();
				await shot('expert');
				await page.getByTestId('commit').click();
				await page.getByTestId('wt-next-step').waitFor();
				await shot('result');
				await page.goto('/export');
				await page.getByRole('radio', { name: /Arbeitszeit-Tabelle/ }).check();
				await shot('export');
				await page.goto('/absences');
				await page.getByRole('button', { name: 'Abwesenheit anlegen' }).first().click();
				await page.locator('#abs-kind').selectOption('excused');
				await shot('absence-form');
				await page.goto('/calendar');
				await shot('calendar');
				await context.close();
			});
		}
	}
});
