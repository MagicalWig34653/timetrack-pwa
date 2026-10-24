import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Notification center and settings against the mock (package L16). Tests in this file share its isolated state.
test.describe.configure({ mode: 'serial' });

/** Calls a mock-only hook (POST /api/v1/mock/<name>) from inside the page, with the session's CSRF token. */
async function hook(page: Page, name: 'notify' | 'push', body: unknown) {
	return page.evaluate(
		async ({ name, body }) => {
			const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
			const res = await fetch(`/api/v1/mock/${name}`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
				body: JSON.stringify(body)
			});
			return res.json();
		},
		{ name, body }
	);
}

test('bell shows the unread count, the center lists items and navigates to the real link targets', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await expect(page.getByTestId('bell-badge')).toHaveCount(0);
	await hook(page, 'notify', { kind: 'report_gap' });
	await hook(page, 'notify', { kind: 'document_submission', ageMinutes: 30 });
	await hook(page, 'notify', { kind: 'running_timer', ageMinutes: 90 });
	// the bell polls on focus/visibility; a navigation refreshes it deterministically
	await page.goto('/notifications');
	await expect(page.getByTestId('bell-badge')).toHaveText('3');
	await expect(page.getByTestId('bell')).toHaveAccessibleName('Hinweise, 3 ungelesen');

	const list = page.getByTestId('notification-list');
	const items = list.getByRole('listitem');
	await expect(items).toHaveCount(3);
	await expect(items.first()).toContainText('Berichtsheft-Erinnerung');
	await expect(items.first()).toContainText('gerade eben');
	await expect(items.nth(1)).toContainText('vor 30 Min.');
	await expect(items.first()).toHaveAttribute('data-unread', 'true');

	await items.first().getByRole('button').first().click();
	await expect(page).toHaveURL(/\/reports$/);
	await expect(page.getByTestId('bell-badge')).toHaveText('2');

	await page.goto('/notifications');
	await expect(items.first()).toHaveAttribute('data-unread', 'false');
	await items.nth(1).getByRole('button').first().click();
	await expect(page).toHaveURL(/\/absences$/);
	await context.close();
});

test('mark all read, delete, unread filter and load more', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	// Three items from the previous test remain in this file's mock state.
	await hook(page, 'notify', { kind: 'pending_suggestions', count: 25, ageMinutes: 1000 });
	await page.goto('/notifications');
	const items = page.getByTestId('notification-list').getByRole('listitem');
	await expect(items).toHaveCount(20);
	await page.getByRole('button', { name: 'Weitere laden' }).click();
	await expect(items).toHaveCount(28);
	await expect(page.getByRole('button', { name: 'Weitere laden' })).toHaveCount(0);

	await items.first().getByRole('button', { name: /^Löschen:/ }).click();
	await expect(items).toHaveCount(27);

	await page.getByRole('button', { name: 'Alle als gelesen' }).click();
	await expect(page.getByTestId('bell-badge')).toHaveCount(0);
	await expect(items.first()).toHaveAttribute('data-unread', 'false');
	await page.getByLabel('Nur ungelesene').check();
	await expect(page.getByTestId('notifications-empty')).toHaveText('Keine ungelesenen Hinweise.');
	await context.close();
});

test('settings: change, validate and persist categories, threshold and quiet hours', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/notifications');
	const timer = page.locator('[data-kind="running_timer"]');
	const gap = page.locator('[data-kind="report_gap"]');
	await expect(timer.getByLabel('Erinnern nach (Minuten)')).toHaveValue('600');

	await timer.getByLabel('Erinnern nach (Minuten)').fill('20');
	await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
	await expect(page.getByText('Bitte gib eine ganze Zahl von 30 bis 1440 an.')).toBeVisible();

	await timer.getByLabel('Erinnern nach (Minuten)').fill('120');
	await timer.getByLabel('Push').uncheck();
	await gap.getByLabel('In der App').uncheck();
	await gap.getByLabel('Wochentag').selectOption('4');
	await gap.getByLabel('Uhrzeit').fill('16:30');
	await page.getByLabel('Ruhezeiten verwenden').uncheck();
	await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
	await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible();

	await page.reload();
	await expect(timer.getByLabel('Erinnern nach (Minuten)')).toHaveValue('120');
	await expect(timer.getByLabel('Push')).not.toBeChecked();
	await expect(timer.getByLabel('In der App')).toBeChecked();
	await expect(gap.getByLabel('In der App')).not.toBeChecked();
	await expect(gap.getByLabel('Wochentag')).toHaveValue('4');
	await expect(gap.getByLabel('Uhrzeit')).toHaveValue('16:30');
	await expect(page.getByLabel('Ruhezeiten verwenden')).not.toBeChecked();
	await context.close();
});

test('settings: push unavailable on the server is explained and the rest still works', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await hook(page, 'push', { available: false });
	await page.goto('/settings/notifications');
	await expect(page.getByTestId('push-state')).toContainText('Push ist auf diesem Server nicht eingerichtet.');
	await expect(page.getByRole('button', { name: 'Push auf diesem Gerät aktivieren' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Einstellungen speichern' })).toBeEnabled();
	await hook(page, 'push', { available: true });
	await context.close();
});

test('settings: blocked permission explains that tracking and in-app hints keep working', async ({ browser, baseURL }) => {
	const { page, context } = await loginAsAdmin(browser);
	await context.grantPermissions([], { origin: baseURL });
	await page.addInitScript(() => {
		Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
	});
	await page.goto('/settings/notifications');
	await expect(page.getByTestId('push-state')).toContainText('Zeiterfassung und Hinweise in der App funktionieren trotzdem');
	await expect(page.getByTestId('install-card')).toBeVisible();
	await context.close();
});

// Manual layout review: SCREENSHOT_DIR=... npm run test:e2e:mock -- notifications.spec.ts
const dir = process.env.SCREENSHOT_DIR;
for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`screenshots ${name} ${scheme}`, async ({ browser }) => {
			test.skip(!dir, 'set SCREENSHOT_DIR to capture screenshots');
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await hook(page, 'notify', { kind: 'running_timer', ageMinutes: 5 });
			await hook(page, 'notify', { kind: 'report_gap', ageMinutes: 200, read: true });
			await hook(page, 'notify', { kind: 'document_submission', ageMinutes: 3000 });
			await page.goto('/notifications');
			await page.getByTestId('notification-list').waitFor();
			await page.screenshot({ path: `${dir}/notifications-${name}-${scheme}.png`, fullPage: true });
			await page.goto('/settings/notifications');
			await page.getByTestId('push-card').waitFor();
			await page.screenshot({ path: `${dir}/notification-settings-${name}-${scheme}.png`, fullPage: true });
			await context.close();
		});
	}
}
