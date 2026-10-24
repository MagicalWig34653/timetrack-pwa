import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// File name sorts last on purpose: the spec adds a version far in the future, which would collide with import specs that create
// older versions on the same shared mock server.
// Work model editing (package M1) and the vacation summary against the in-repo mock API, serially on one server.
test.describe.configure({ mode: 'serial' });

test('work model: the new-version form starts pre-filled and every version shows its key values', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/work-model');
	const first = page.getByTestId('model-list').getByRole('listitem').first();
	// earlier specs on this shared server may have added versions: compare with whatever the newest version shows
	const weekly = (await first.getByTestId('model-summary-weekly').locator('dd').first().textContent())!.replace(' h', '').trim();
	expect(weekly).toMatch(/^\d+:\d{2}$/);
	await expect(first.getByTestId('model-summary-workdays')).toContainText('Mo–Fr');
	await expect(first.getByTestId('model-summary-rounding')).toContainText('15 Minuten');
	await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
	await expect(page.getByLabel('Wochen-Soll')).toHaveValue(weekly);
	await expect(page.getByLabel('Rundung zugunsten der Arbeitszeit')).toBeChecked();
	await expect(page.getByLabel('Mo', { exact: true })).toBeChecked();
	await context.close();
});

test('work model: correct a version with warning, preview and confirmation; change from a date; overlap is explained', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/settings/work-model');
	await page.getByTestId('model-list').getByRole('listitem').first().getByRole('button', { name: 'Bearbeiten' }).click();
	// safe mode is the default and shows no correction warning
	await expect(page.getByTestId('mode-new')).toBeChecked();
	await expect(page.getByTestId('correction-panel')).toHaveCount(0);

	await page.getByTestId('mode-correct').check();
	await expect(page.getByTestId('correction-warning')).toContainText('Achtung: Wenn du diese Version änderst, werden die Zeiten aller Tage von');
	await expect(page.getByTestId('correct-submit')).toBeDisabled();
	await page.getByLabel('Wochen-Soll').fill('30:00');
	await expect(page.getByTestId('preview-line')).toContainText('Zeitkonto heute: vorher');
	await expect(page.getByTestId('preview-line')).toContainText('betroffen:');
	await expect(page.getByTestId('correct-submit')).toBeDisabled();
	await page.getByLabel('Ich habe verstanden, dass sich Auswertungen ändern').check();
	await expect(page.getByTestId('correct-submit')).toBeEnabled();
	await page.getByTestId('correct-submit').click();
	await expect(page.getByTestId('toast')).toHaveText('Version korrigiert. Die betroffenen Tage wurden neu ausgewertet.');
	const card = page.getByTestId('model-list').getByRole('listitem').first();
	await expect(card.getByTestId('model-summary-weekly')).toContainText('30:00 h');

	// "Ab einem Datum ändern" creates a new version and ends the running one the day before
	const from = '2099-01-01'; // later than any version other specs of this shared server created
	const countBefore = await page.getByTestId('model-list').getByRole('listitem').count();
	await card.getByRole('button', { name: 'Bearbeiten' }).click();
	await page.getByLabel('Gültig ab').fill(from);
	await page.getByLabel('Wochen-Soll').fill('38:30');
	await page.getByRole('button', { name: 'Version anlegen' }).click();
	await expect(page.getByTestId('toast')).toHaveText('Neue Version angelegt.');
	await expect(page.getByTestId('model-list').getByRole('listitem')).toHaveCount(countBefore + 1);

	// correcting the older version so that it runs into the newer one is explained in plain German
	const older = page.getByTestId('model-list').getByRole('listitem').nth(1);
	await older.getByRole('button', { name: 'Bearbeiten' }).click();
	await page.getByTestId('mode-correct').check();
	await expect(page.getByTestId('preview-line')).toBeVisible();
	await page.getByLabel('Gültig bis').fill('');
	await expect(page.getByTestId('preview-error')).toContainText('überschneidet sich mit einer Nachbarversion');
	await expect(page.getByTestId('correct-submit')).toBeDisabled();
	await context.close();
});

test('vacation: a call to action replaces an empty account, the filled summary shows the stored numbers', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	let configured = false;
	await page.route('**/api/v1/vacation/settings', async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({ json: { configured, region: 'DE-ST', annualEntitlementHalfDays: configured ? 56 : 60, carryOverByYear: {}, carryOverExpiry: null } });
		} else {
			configured = true;
			await route.fulfill({ json: { configured: true, region: 'DE-ST', annualEntitlementHalfDays: 56, carryOverByYear: {}, carryOverExpiry: null } });
		}
	});
	await page.route('**/api/v1/vacation/balance**', async (route) => {
		const year = Number(new URL(route.request().url()).searchParams.get('year'));
		const days = configured ? 56 : 0;
		await route.fulfill({ json: { year, entitlementHalfDays: days, carryOverHalfDays: 0, adjustmentHalfDays: 0, bookedHalfDays: 0, plannedHalfDays: 0, availableHalfDays: days, availableAfterPlannedHalfDays: days } });
	});
	await page.goto('/vacation');
	await expect(page.getByTestId('vacation-cta')).toContainText('noch nicht hinterlegt');
	await expect(page.getByTestId('vacation-balance')).toHaveCount(0);
	await page.getByTestId('vacation-cta-action').click();
	await expect(page.getByLabel('Jahresanspruch (Tage)')).toBeFocused();
	await page.getByLabel('Jahresanspruch (Tage)').fill('28');
	await page.getByRole('form', { name: 'Einstellungen' }).getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('vacation-balance')).toBeVisible();
	await expect(page.getByTestId('vacation-cta')).toHaveCount(0);
	await expect(page.getByTestId('balance-entitlement')).toHaveText('28 Tage');
	await expect(page.getByTestId('balance-available')).toHaveText('28 Tage');
	await page.getByTestId('vacation-edit-settings').click();
	await expect(page.getByLabel('Jahresanspruch (Tage)')).toHaveValue('28');
	await context.close();
});

// Layout review (desktop and phone, light and dark); only with SCREENSHOT_DIR set.
const dir = process.env.SCREENSHOT_DIR;
test.describe('work model screenshots', () => {
	test.skip(!dir, 'set SCREENSHOT_DIR to capture');
	for (const [name, viewport, colorScheme] of [
		['desktop-light', { width: 1280, height: 1000 }, 'light'],
		['desktop-dark', { width: 1280, height: 1000 }, 'dark'],
		['phone-light', { width: 390, height: 844 }, 'light']
	] as const) {
		test(`work model and vacation ${name}`, async ({ browser }) => {
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme });
			await page.goto('/settings/work-model');
			await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
			await expect(page.getByLabel('Wochen-Soll')).toHaveValue('38:30');
			await page.screenshot({ path: `${dir}/m1-${name}-model-new.png`, fullPage: true });
			await page.getByRole('button', { name: 'Abbrechen' }).click();
			await page.getByTestId('model-list').getByRole('listitem').first().getByRole('button', { name: 'Bearbeiten' }).click();
			await page.getByTestId('mode-correct').check();
			await page.getByLabel('Wochen-Soll').fill('30:00');
			await expect(page.getByTestId('preview-line')).toContainText('betroffen');
			await page.getByLabel('Ich habe verstanden, dass sich Auswertungen ändern').check();
			await page.screenshot({ path: `${dir}/m1-${name}-model-correct.png`, fullPage: true });

			let configured = false;
			await page.route('**/api/v1/vacation/settings', (route) =>
				route.request().method() === 'GET' ? route.fulfill({ json: { configured, region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: { '2026': 5 }, carryOverExpiry: '03-31' } }) : route.continue()
			);
			await page.route('**/api/v1/vacation/balance**', (route) => {
				const year = Number(new URL(route.request().url()).searchParams.get('year'));
				return route.fulfill({ json: configured ? { year, entitlementHalfDays: 60, carryOverHalfDays: 5, adjustmentHalfDays: -1, bookedHalfDays: 16, plannedHalfDays: 5, availableHalfDays: 48, availableAfterPlannedHalfDays: 43 } : { year, entitlementHalfDays: 0, carryOverHalfDays: 0, adjustmentHalfDays: 0, bookedHalfDays: 0, plannedHalfDays: 0, availableHalfDays: 0, availableAfterPlannedHalfDays: 0 } });
			});
			await page.goto('/vacation');
			await expect(page.getByTestId('vacation-cta')).toBeVisible();
			await page.screenshot({ path: `${dir}/m1-${name}-vacation-cta.png`, fullPage: true });
			configured = true;
			await page.goto('/vacation');
			await expect(page.getByTestId('vacation-balance')).toBeVisible();
			await page.screenshot({ path: `${dir}/m1-${name}-vacation-filled.png`, fullPage: true });
			await context.close();
		});
	}
});
