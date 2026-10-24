import { expect, test } from './test';
import { loginAsAdmin, seededWorkDays } from './helpers';

const [dayA, dayB] = seededWorkDays();
const german = (date: string) => date.split('-').reverse().join('.');

// Runs the new time tracking pages against the in-repo mock API (`npm run dev:mock`), serially on one server.
test.describe.configure({ mode: 'serial' });

test('dashboard: start and stop the timer, one running segment, timeline appears', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await expect(page.getByRole('heading', { name: 'Zeiterfassung' })).toBeVisible();
	const start = page.getByRole('button', { name: 'Start' });
	await start.dblclick(); // double click must not produce a second booking
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await expect(page.getByTestId('elapsed')).toBeVisible();
	await expect(page.getByTestId('timeline')).toBeVisible();
	await expect(page.getByTestId('segment-row')).toHaveCount(1);
	await page.getByRole('button', { name: 'Stopp' }).click();
	await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
	await context.close();
});

test('week list and day detail: correction with reason, void, day preferences', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Zeit' }).click();
	await expect(page.getByTestId('week-list')).toBeVisible();
	await page.goto(`/time/${dayA}`);
	await expect(page.getByRole('heading', { name: new RegExp(german(dayA).replace(/\./g, '\\.')) })).toBeVisible();
	const rows = page.getByTestId('segment-row');
	await expect(rows).toHaveCount(2);
	await expect(page.getByTestId('gap-row')).toContainText(/Pause \d+:\d{2}/);

	await rows.first().getByRole('button', { name: 'Korrigieren' }).click();
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByText('Bitte gib einen Grund an.')).toBeVisible();
	await page.getByLabel(/^Grund/).fill('Beginn korrigiert');
	await page.getByLabel('Beginn').fill(`${dayA}T08:00`);
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByText('Eintrag korrigiert.')).toBeVisible();
	await expect(page.getByText('1 Korrektur(en)')).toBeVisible();

	await page.getByLabel('Markierung').selectOption('vacation');
	await page.getByRole('button', { name: 'Speichern' }).last().click();
	await expect(page.getByText('Tageseinstellungen gespeichert.')).toBeVisible();
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await context.close();
});

test('stale version conflict is resolved in the UI', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto(`/time/${dayB}`);
	const row = page.getByTestId('segment-row').first();
	await row.getByRole('button', { name: 'Korrigieren' }).click();
	// a second tab changes the same segment first
	const other = await context.newPage();
	await other.goto(`/time/${dayB}`);
	await other.getByTestId('segment-row').first().getByRole('button', { name: 'Korrigieren' }).click();
	await other.getByLabel('Notiz (optional)').fill('anderes Gerät');
	await other.getByLabel(/^Grund/).fill('Notiz ergänzt');
	await other.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(other.getByText('Eintrag korrigiert.')).toBeVisible();
	await other.close();

	await page.getByLabel(/^Grund/).fill('Eigene Änderung');
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByTestId('stale-conflict')).toContainText('zwischenzeitlich geändert');
	await page.getByRole('button', { name: 'Auf neue Version anwenden' }).click();
	await expect(page.getByText('Eintrag korrigiert.')).toBeVisible();
	await context.close();
});

test('settings: new work model version, place, account time, device token', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);

	await page.goto('/settings/work-model');
	await expect(page.getByTestId('history-note')).toContainText('nie verändert');
	await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
	await page.getByLabel('Gültig ab').fill('2027-01-01');
	await page.getByLabel('Wochen-Soll').fill('40:00');
	await page.getByRole('button', { name: 'Version anlegen' }).click();
	await expect(page.getByText('Neue Version angelegt.')).toBeVisible();
	await expect(page.getByTestId('model-list')).toContainText('40:00');

	await page.goto('/settings/places');
	await page.getByRole('button', { name: 'Neuer Ort' }).click();
	await page.getByLabel('Name').fill('Kunde Nord');
	await page.getByLabel('Automatik').selectOption('direct');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Ort angelegt.')).toBeVisible();
	await expect(page.getByTestId('place-list')).toContainText('Kunde Nord');

	await page.goto('/settings/account-time');
	await page.getByLabel('Korrektur (h:mm)').fill('1:30');
	await page.getByLabel('Grund').last().fill('Zeitausgleich');
	await page.getByRole('button', { name: 'Korrektur speichern' }).click();
	await expect(page.getByText('Korrektur gespeichert.')).toBeVisible();
	await expect(page.getByTestId('account-corrections')).toHaveText('+1:30');

	await page.goto('/settings/devices');
	await page.getByLabel('Name').fill('iPhone');
	await page.getByRole('button', { name: 'Token erzeugen' }).click();
	await expect(page.getByTestId('token-value')).toContainText('ttd_');
	await expect(page.getByTestId('shortcut-sample')).toContainText('/api/v1/automation/events');
	await page.getByRole('button', { name: 'Ich habe es gespeichert' }).click();
	await expect(page.getByTestId('token-list')).not.toContainText('ttd_');
	await context.close();
});

test('suggestions inbox: accept the open suggestion', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/suggestions');
	await expect(page.getByTestId('suggestion-list')).toBeVisible();
	await page.getByRole('button', { name: 'Annehmen' }).click();
	// An open-ended segment would overlap the timer booked earlier today, so give the suggestion a short end (+10 min).
	const start = await page.getByLabel('Beginn').inputValue();
	const end = new Date(Date.parse(start + ':00Z') + 10 * 60_000).toISOString().slice(0, 16);
	await page.getByLabel('Ende').fill(end);
	await page.getByRole('button', { name: 'Übernehmen' }).click();
	await expect(page.getByText('Vorschlag übernommen.')).toBeVisible();
	await expect(page.getByTestId('suggestions-empty')).toBeVisible();
	await context.close();
});

test('phone width: no horizontal page scroll on any time page', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	for (const route of ['/', '/time', `/time/${dayA}`, '/settings/work-model', '/settings/places', '/settings/account-time', '/settings/devices', '/suggestions']) {
		await page.goto(route);
		await page.waitForLoadState('networkidle');
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, route).toBeLessThanOrEqual(0);
	}
	await context.close();
});
