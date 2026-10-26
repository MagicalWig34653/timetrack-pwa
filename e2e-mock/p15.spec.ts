import { expect, test } from './test';
import { loginAsAdmin, seededWorkDays } from './helpers';

test.describe.configure({ mode: 'serial' });

test('legal profile selection saves a dated work model version', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/work-model');
	await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
	await page.getByLabel('Rechtsprofil').selectOption('jarbschg-minor-de');
	await expect(page.getByText('Informative Hinweise, keine Rechtsberatung.', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Version anlegen' }).click();
	await expect(page.getByText('Neue Version angelegt.')).toBeVisible();
	await expect(page.getByTestId('model-summary-legal').first()).toContainText('Jugendliche');
	await context.close();
});

test('account adjustment history supports confirmed deletion', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/account-time');
	await expect(page.getByTestId('adjustment-row')).toHaveCount(1);
	await page.getByLabel('Korrektur (h:mm)').fill('1:30');
	await page.getByLabel('Grund').last().fill('Testkorrektur');
	await page.getByRole('button', { name: 'Korrektur speichern' }).click();
	await expect(page.getByTestId('adjustment-row')).toHaveCount(2);
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByTestId('adjustment-row').filter({ hasText: 'Testkorrektur' }).getByRole('button', { name: 'Löschen' }).click();
	await expect(page.getByTestId('adjustment-row')).toHaveCount(1);
	await context.close();
});

test('review banner filters days and a segment can be marked reviewed', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	const day = seededWorkDays()[0];
	const segmentId = await page.evaluate(async (date) => {
		const response = await fetch(`/api/v1/time/days/${date}`);
		const result = await response.json();
		return result.segments[0].id as string;
	}, day);
	await page.evaluate(async (id) => {
		await fetch('/api/v1/mock/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segmentId: id }) });
	}, segmentId);
	await page.goto(`/time?week=${day}`); // redirects to the week page
	await expect(page).toHaveURL(/\/week\?week=\d{4}-W\d{2}/);
	await expect(page.getByTestId('review-banner')).toBeVisible();
	await page.getByTestId('review-toggle').click();
	await expect(page.getByTestId('week-days').getByRole('listitem')).toHaveCount(1);
	await page.goto(`/time/${day}`);
	await page.getByTestId('segment-row').filter({ hasText: 'Zu prüfen' }).getByRole('button', { name: 'Als geprüft markieren' }).click();
	await expect(page.getByText('Eintrag als geprüft markiert.')).toBeVisible();
	await expect(page.getByTestId('segment-row').filter({ hasText: 'Zu prüfen' })).toHaveCount(0);
	await context.close();
});
