import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Planning, vacation and sharing pages against the in-repo mock API (`npm run dev:mock`), serially on one server.
// Dates lie in 2031 so the specs do not depend on the demo data relative to "today".
test.describe.configure({ mode: 'serial' });

const monday = '2031-03-10';

test('calendar: create an approved vacation from a day, see it in the grid and in the balance', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto(`/calendar?date=${monday}`);
	await expect(page.getByTestId('calendar-month')).toHaveText('März 2031');
	await page.locator(`[data-date="${monday}"]:visible`).click();
	const panel = page.getByTestId('day-panel');
	await panel.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	await page.getByLabel('Bis').fill('2031-03-14');
	await page.getByLabel('Status').selectOption('approved');
	await page.getByTestId('absence-form').getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Abwesenheit gespeichert.')).toBeVisible();
	await expect(page.getByTestId('month-grid').locator('[data-chip="absence"]')).toHaveCount(5);

	await page.goto('/vacation');
	for (let i = new Date().getFullYear(); i < 2031; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
	await expect(page.getByTestId('vacation-year')).toHaveText('2031');
	await expect(page.getByTestId('balance-booked')).toHaveText('5 Tage');
	await expect(page.getByTestId('balance-available')).toHaveText('25 Tage');
	await context.close();
});

test('day view: an approved vacation sets the target to 0 with a neutral note (C9 behaviour)', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/time/2031-03-12');
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await expect(page.getByTestId('day-target-note')).toContainText('Soll 0: Der Tag ist als „Urlaub“ gewertet.');
	await page.goto('/time/2031-03-17');
	await expect(page.getByTestId('day-target')).not.toHaveText('0:00');
	await expect(page.getByTestId('day-target-note')).toHaveCount(0);
	await context.close();
});

test('vacation: list manual entries of the year and delete one after confirmation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/vacation');
	for (let i = new Date().getFullYear(); i < 2031; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
	await expect(page.getByTestId('entries-empty')).toBeVisible();
	await page.getByLabel('Datum').last().fill('2031-04-01');
	await page.getByLabel('Tage (+ oder −)').fill('1');
	await page.getByLabel('Grund').fill('Gutschrift Test');
	await page.getByRole('button', { name: 'Korrektur speichern' }).click();
	const entry = page.getByTestId('vacation-entry');
	await expect(entry).toContainText('Korrektur 01.04.2031: +1 Tag');
	await expect(page.getByTestId('balance-available')).toHaveText('26 Tage');
	await entry.getByRole('button', { name: 'Löschen' }).click();
	await entry.getByRole('button', { name: 'Jetzt löschen' }).click();
	await expect(page.getByTestId('entries-empty')).toBeVisible();
	await expect(page.getByTestId('balance-available')).toHaveText('25 Tage');
	await context.close();
});

test('absence overlap is explained in German and nothing is saved', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto(`/calendar?date=${monday}`);
	await page.locator(`[data-date="2031-03-12"]:visible`).click();
	await page.getByTestId('day-panel').getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	await page.getByLabel('Art').selectOption('sick');
	await page.getByTestId('absence-form').getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('absence-error')).toContainText('Abwesenheiten dürfen sich nicht überschneiden');
	await page.goto('/absences');
	for (let i = new Date().getFullYear(); i < 2031; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
	await expect(page.getByTestId('absence-row')).toHaveCount(1);
	await expect(page.getByTestId('absence-counted')).toContainText('Zählt: 5 Tage');
	await context.close();
});

test('absences list: filter by status and edit approved to taken without changing the balance', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/absences');
	for (let i = new Date().getFullYear(); i < 2031; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
	await page.getByLabel('Status', { exact: true }).selectOption('planned');
	await expect(page.getByTestId('absences-empty')).toBeVisible();
	await page.getByLabel('Status', { exact: true }).selectOption('approved');
	await page.getByRole('button', { name: 'Bearbeiten' }).click();
	await page.locator('#abs-status').selectOption('taken');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Abwesenheit gespeichert.')).toBeVisible();
	await page.getByLabel('Status', { exact: true }).selectOption('taken');
	await expect(page.getByTestId('absence-row')).toHaveCount(1);
	await page.goto('/vacation');
	for (let i = new Date().getFullYear(); i < 2031; i++) await page.getByRole('button', { name: 'Folgejahr' }).click();
	await expect(page.getByTestId('balance-booked')).toHaveText('5 Tage');
	await context.close();
});

test('sharing: create, change scopes, revoke; unknown recipient is explained', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/sharing');
	await expect(page.getByTestId('never-shared')).toContainText('Freistellungstage');
	for (const name of [/^Planung/, /^Tatsächliche Zeiten/, /^Urlaub/]) await expect(page.getByRole('checkbox', { name }).first()).not.toBeChecked();
	await page.getByLabel('Kontoname der Person').fill('niemand');
	await page.getByRole('checkbox', { name: /^Planung/ }).check();
	await page.getByRole('button', { name: 'Freigabe anlegen' }).click();
	await expect(page.getByTestId('share-error')).toContainText('Dieses Konto wurde nicht gefunden');

	await page.getByLabel('Kontoname der Person').fill('lena');
	await page.getByRole('button', { name: 'Freigabe anlegen' }).click();
	const row = page.getByTestId('share-row');
	await expect(row).toContainText('lena');
	await row.getByRole('checkbox', { name: 'Urlaub lena' }).check();
	await expect(page.getByTestId('share-notice')).toContainText('geändert');
	await row.getByRole('button', { name: 'Widerrufen lena' }).click();
	await row.getByRole('button', { name: 'Jetzt widerrufen lena' }).click();
	await expect(page.getByTestId('shares-empty')).toBeVisible();
	await context.close();
});

test('shared: incoming share shows only the granted scopes, read-only', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/shared');
	await expect(page.getByTestId('never-shared')).toContainText('Notizen');
	await page.getByTestId('incoming-list').getByRole('button', { name: /Lena Beispiel/ }).click();
	const view = page.getByTestId('shared-view');
	await expect(view.getByTestId('shared-plan')).toBeVisible();
	await expect(view.getByTestId('shared-vacation')).toBeVisible();
	await expect(view.getByTestId('shared-actual')).toHaveCount(0);
	await expect(view.getByRole('button', { name: /Löschen|Bearbeiten|Speichern/ })).toHaveCount(0);
	await context.close();
});

test('phone: the calendar shows a week list and the day panel works', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await page.goto(`/calendar?date=${monday}`);
	await expect(page.getByTestId('month-grid')).toBeHidden();
	await expect(page.getByTestId('week-days').getByRole('button')).toHaveCount(7);
	await page.locator(`[data-date="${monday}"]:visible`).click();
	await expect(page.getByTestId('day-panel')).toContainText('Urlaub');
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
	expect(overflow).toBe(false);
	await context.close();
});

test('phone width: no horizontal page scroll on any planning page', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	for (const route of ['/vacation', '/calendar', '/absences', '/settings/sharing', '/shared']) {
		await page.goto(route);
		await page.waitForLoadState('networkidle');
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, route).toBeLessThanOrEqual(0);
	}
	await context.close();
});
