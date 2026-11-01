import { type Browser, type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin, newAuthenticatorContext } from './helpers';

// Profile page and guided setup (P1, ADR-0019) against the mock. Serial: the mock server keeps its state.
// Every spec registers its own account so the demo admin keeps its name and work model for the other specs.
test.describe.configure({ mode: 'serial' });

const shots = process.env.SCREENSHOT_DIR;

// The mock signs "unknown" passkeys in as the most recently used account, so the admin invites everybody up front.
const invitations: string[] = [];

async function newAccount(browser: Browser, handle: string, displayName: string, options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}) {
	const token = invitations.shift();
	if (!token) throw new Error('no invitation left');
	const { context, page } = await newAuthenticatorContext(browser, { viewport: options.viewport ?? { width: 1280, height: 900 }, colorScheme: options.colorScheme });
	await page.goto(`/invite/${token}`);
	await page.getByLabel('Kontoname').fill(handle);
	await page.getByLabel('Anzeigename').fill(displayName);
	await page.getByRole('button', { name: 'Passkey erstellen und Konto anlegen' }).click();
	await expect(page).toHaveURL(/\/setup\/recovery$/);
	await page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(page.getByRole('heading', { name: `Hallo, ${displayName}` })).toBeVisible();
	return { context, page };
}

const profileState = (page: Page) => page.evaluate(async () => (await (await fetch('/api/v1/me/profile')).json()).onboarding.state as string);

test('a new account is offered the setup, the demo admin is not; the settings navigation is grouped', async ({ browser }) => {
	const admin = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const csrf = (await (await admin.page.request.get('/api/v1/auth/session')).json()).csrfToken;
	for (let i = 0; i < 8; i++) {
		const invitation = await (await admin.page.request.post('/api/v1/admin/invitations', { data: { expiresInHours: 24 }, headers: { 'X-CSRF-Token': csrf } })).json();
		invitations.push(invitation.token);
	}
	await expect(admin.page.getByTestId('setup-banner')).toHaveCount(0);
	await admin.page.goto('/settings/profile');
	const nav = admin.page.getByTestId('settings-tabs');
	await expect(nav.getByRole('link', { name: 'Profil' })).toHaveAttribute('aria-current', 'page');
	for (const group of ['Profil & Sicherheit', 'Arbeitszeit & Urlaub', 'Orte & Automatik', 'Benachrichtigungen & Kalender', 'Daten & Export', 'Verwaltung (Admin)']) await expect(nav.getByRole('heading', { name: group })).toBeVisible();
	await admin.context.close();

	const { page, context } = await newAccount(browser, 'e2e-nina', 'Nina E2E');
	await expect(page.getByTestId('setup-banner')).toContainText('Richte dein Konto');
	await page.getByRole('link', { name: 'Einrichtung starten' }).click();
	await expect(page).toHaveURL(/\/onboarding$/);
	expect(await profileState(page)).toBe('pending');
	await context.close();
});

test('setup banner can be dismissed for good', async ({ browser }) => {
	const { page, context } = await newAccount(browser, 'e2e-dora', 'Dora E2E');
	await expect(page.getByTestId('setup-banner')).toBeVisible();
	await page.getByTestId('setup-dismiss').click();
	await expect(page.getByTestId('setup-banner')).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId('setup-banner')).toHaveCount(0);
	expect(await profileState(page)).toBe('skipped');
	await context.close();
});

test('profile: rename, e-mail change with code, wrong code, removal', async ({ browser }) => {
	const { page, context } = await newAccount(browser, 'e2e-paul', 'Paul E2E');
	await page.goto('/settings/profile');
	await expect(page.getByLabel('Kontoname')).toHaveAttribute('readonly', '');
	await page.getByLabel('Anzeigename').fill('Paul Neu');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('name-notice')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Anzeigename')).toHaveValue('Paul Neu');

	await page.getByTestId('email-edit').click();
	await page.getByLabel('Neue E-Mail-Adresse').fill('paul@example.test');
	await page.getByRole('button', { name: 'Code senden' }).click();
	const pending = page.getByTestId('email-pending');
	await expect(pending).toContainText('paul@example.test');
	await pending.getByLabel('Bestätigungscode').fill('000000');
	await pending.getByRole('button', { name: 'Bestätigen' }).click();
	await expect(page.getByTestId('email-error')).toBeVisible();
	await pending.getByLabel('Bestätigungscode').fill('123456');
	await pending.getByRole('button', { name: 'Bestätigen' }).click();
	await expect(page.getByTestId('email-current')).toContainText('paul@example.test');
	await expect(page.getByTestId('email-current')).toContainText('Bestätigt');
	await page.getByTestId('email-remove').click();
	await page.getByTestId('email-remove-confirm').click();
	await expect(page.getByTestId('email-none')).toBeVisible();
	await context.close();
});

test('onboarding: prefilled suggestions, all steps, nothing saved before the end, then not offered again', async ({ browser }) => {
	const { page, context } = await newAccount(browser, 'e2e-rita', 'Rita E2E');
	const before = await page.evaluate(async () => (await (await fetch('/api/v1/work-models')).json()).length as number);
	await page.goto('/onboarding');
	await expect(page.getByTestId('suggestion-note')).toBeVisible();
	await expect(page.getByLabel('Wochenstunden')).toHaveValue('38:30');
	await expect(page.getByTestId('daily-target')).toContainText('7:42');
	await page.getByLabel('Wochenstunden').fill('40:00');
	await expect(page.getByTestId('daily-target')).toContainText('8:00');
	await page.getByTestId('onboarding-next').click();
	await expect(page.getByTestId('step-breaks')).toBeVisible();
	await page.getByRole('button', { name: 'Pausenfenster hinzufügen' }).click();
	await page.getByTestId('onboarding-next').click();
	await expect(page.getByTestId('step-school')).toBeVisible();
	await page.getByTestId('onboarding-next').click();
	await expect(page.getByLabel('Urlaubstage pro Jahr')).toHaveValue('30');
	await expect(page.getByLabel('Bundesland')).toHaveValue('DE-ST');
	await page.getByTestId('onboarding-next').click();
	await page.getByTestId('ob-module-reports').uncheck();
	await page.getByTestId('onboarding-next').click();
	await expect(page.getByTestId('sum-model')).toContainText('8:00');
	await expect(page.getByTestId('sum-breaks')).toContainText('12:00–12:30');
	await expect(page.getByTestId('sum-modules')).toContainText('Berichtsheft');
	expect(await page.evaluate(async () => (await (await fetch('/api/v1/work-models')).json()).length as number)).toBe(before);
	await page.getByTestId('onboarding-finish').click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('setup-banner')).toHaveCount(0);
	expect(await profileState(page)).toBe('completed');
	expect(await page.evaluate(async () => (await (await fetch('/api/v1/work-models')).json()).length as number)).toBe(before + 1);
	// the module switch took effect
	await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Berichtsheft' })).toHaveCount(0);
	// repeating from the settings shows the current values
	await page.goto('/settings/profile');
	await page.getByTestId('setup-repeat').click();
	await expect(page.getByTestId('repeat-note')).toBeVisible();
	await expect(page.getByLabel('Wochenstunden')).toHaveValue('40:00');
	await context.close();
});

test('onboarding: "Einrichtung später" and skipping steps store only the flag', async ({ browser }) => {
	const { page, context } = await newAccount(browser, 'e2e-sven', 'Sven E2E');
	await page.goto('/onboarding');
	await page.getByTestId('onboarding-skip').click();
	await expect(page.getByTestId('step-vacation')).toBeVisible();
	await page.getByTestId('onboarding-later').click();
	await expect(page).toHaveURL(/\/$/);
	expect(await profileState(page)).toBe('skipped');
	expect(await page.evaluate(async () => (await (await fetch('/api/v1/work-models')).json()).length as number)).toBe(0);
	await expect(page.getByTestId('setup-banner')).toHaveCount(0);
	await context.close();
});

for (const [name, viewport, scheme] of [['desktop', { width: 1280, height: 900 }, 'light'], ['desktop', { width: 1280, height: 900 }, 'dark'], ['phone', { width: 390, height: 844 }, 'light']] as const) {
	test(`screenshots profile and onboarding ${name} ${scheme}`, async ({ browser }) => {
		test.skip(!shots, 'set SCREENSHOT_DIR');
		const handle = `shot-${name}-${scheme}`;
		const { page, context } = await newAccount(browser, handle, 'Mia Muster', { viewport, colorScheme: scheme });
		await page.goto('/settings/profile');
		await expect(page.getByTestId('email-panel')).toBeVisible();
		await page.screenshot({ path: `${shots}/profile-${name}-${scheme}.png`, fullPage: true });
		if (name === 'phone') {
			await page.getByTestId('settings-nav-toggle').click();
			await page.screenshot({ path: `${shots}/settings-nav-${name}-${scheme}.png` });
		}
		await page.goto('/');
		await expect(page.getByTestId('setup-banner')).toBeVisible();
		await page.screenshot({ path: `${shots}/dashboard-banner-${name}-${scheme}.png` });
		await page.goto('/onboarding');
		const steps = ['model', 'breaks', 'school', 'vacation', 'modules', 'summary'];
		for (const step of steps) {
			await expect(page.getByTestId(`step-${step}`)).toBeVisible();
			if (step === 'breaks') await page.getByRole('button', { name: 'Pausenfenster hinzufügen' }).click();
			await page.screenshot({ path: `${shots}/onboarding-${step}-${name}-${scheme}.png`, fullPage: true });
			if (step !== 'summary') await page.getByTestId('onboarding-next').click();
		}
		await context.close();
	});
}
