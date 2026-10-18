import { expect, test } from '@playwright/test';
import { apiCall as api, newActor as baseActor, registerViaInvite, type Actor } from './helpers';

// Package V2-PWA: vacation planner against the real backend (GET /api/v1/vacation/suggestions, contract 0.22.0).
// Fixed period May 2027: Ascension Thu 06.05. (bridge day Fri 07.05.), Whit Monday 17.05. (bridge day Fri 14.05.).
test.describe.configure({ mode: 'serial' });

const BASE = process.env.E2E_VACATION_PLANNER_BASE_URL ?? `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 15}`;
test.use({ baseURL: BASE });

let alice: Actor;

test.afterAll(async () => {
	await alice?.context.close();
});

async function openPlanner(page: Actor['page']) {
	await page.goto('/vacation/planner');
	await page.getByLabel('Zeitraum von').fill('2027-05-01');
	await page.getByLabel('Zeitraum bis').fill('2027-05-31');
	await page.getByTestId('filter-apply').click();
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

test('setup: account with work model and 30 days of vacation', async ({ browser }) => {
	alice = await baseActor(browser, [], BASE);
	await registerViaInvite(alice, new URL(process.env.E2E_VACATION_PLANNER_BOOTSTRAP_LINK!).pathname, 'alice.vplan', 'Alice Urlaub', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Urlaub' })).toBeVisible();
	const { page } = alice;
	await page.goto('/settings/work-model');
	await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
	await page.getByLabel('Gültig ab').fill('2026-01-05');
	await page.getByLabel('Wochen-Soll').fill('38:30');
	await page.getByRole('button', { name: 'Version anlegen' }).click();
	await expect(page.getByText('Neue Version angelegt.')).toBeVisible();
	const saved = await api(page, 'PUT', '/api/v1/vacation/settings', { region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: {}, carryOverExpiry: null });
	expect(saved.status).toBe(200);
	// a school plan day on the Whit Monday bridge day and a sick absence on Thu 20.05. (window 20.-23.05.)
	expect((await api(page, 'PUT', '/api/v1/plan/days/2027-05-14', { mode: 'school' })).status).toBe(200);
	expect((await api(page, 'POST', '/api/v1/absences', { kind: 'sick', startDate: '2027-05-20', endDate: '2027-05-20', status: 'taken' })).status).toBe(201);
});

test('planner shows the budget and the Ascension bridge day from the real backend', async () => {
	const { page } = alice;
	await page.goto('/vacation');
	await page.getByTestId('open-planner').click();
	await expect(page).toHaveURL(/\/vacation\/planner$/);
	await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
	await openPlanner(page);
	await expect(page.getByTestId('budget-entitlement')).toHaveText('30 Tage');
	await expect(page.getByTestId('budget-remaining')).toHaveText('30 Tage');
	const bridge = page.locator('[data-testid="suggestion-card"]', { hasText: 'Christi Himmelfahrt' }).first();
	await expect(bridge).toBeVisible();
	await expect(bridge.getByTestId('suggestion-kind')).toHaveText('Brückentag');
	await expect(bridge.getByTestId('suggestion-summary')).toContainText('1 Urlaubstag → 4 Tage frei');
	await expect(bridge.getByTestId('suggestion-factor')).toContainText('Faktor 4');
	await expect(bridge.getByTestId('suggestion-vacation-dates')).toContainText('07.05.');
	await expect(bridge.getByTestId('suggestion-timeline').locator('li')).toHaveCount(4);
	await expect(bridge).toHaveAttribute('data-conflicts', 'no');
});

test('conflicts (school day, absence) are shown as warnings and a booking attempt reports the overlap', async () => {
	const { page } = alice;
	await openPlanner(page);
	const school = page.locator('[data-testid="suggestion-card"][data-conflicts="yes"]', { hasText: 'Pfingstmontag' }).first();
	await expect(school).toBeVisible();
	await expect(school.getByTestId('suggestion-conflicts')).toContainText('Berufsschultag');
	await expect(school.getByTestId('suggestion-range')).toContainText('14.05.');

	const card = page.locator('[data-testid="suggestion-card"][data-conflicts="yes"]', { hasText: '20.05.' }).first();
	await expect(card).toBeVisible();
	await expect(card.getByTestId('suggestion-conflicts')).toContainText('Abwesenheit eingetragen');
	await card.getByTestId('take-over').click();
	await expect(card.getByTestId('take-over-confirm-button')).toBeDisabled();
	await card.getByTestId('ack-conflicts').check();
	await card.getByTestId('take-over-confirm-button').click();
	await expect(card.getByTestId('take-over-error')).toBeVisible();
	// the overlap was refused, nothing was booked
	const absences = await api(page, 'GET', '/api/v1/absences?from=2027-05-01&to=2027-05-31');
	expect(absences.body.filter((a: { kind: string }) => a.kind === 'vacation')).toHaveLength(0);
});

test('taking the bridge day over books one planned vacation day and updates the budget', async () => {
	const { page } = alice;
	await openPlanner(page);
	const bridge = page.locator('[data-testid="suggestion-card"]', { hasText: 'Christi Himmelfahrt' }).first();
	await bridge.getByTestId('take-over').click();
	await expect(bridge.getByTestId('take-over-blocks')).toContainText('1 Urlaubstag');
	await bridge.getByTestId('take-over-confirm-button').click();
	await expect(page.getByTestId('planner-notice')).toContainText('Urlaub eingetragen');
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
	await expect(page.getByTestId('budget-planned')).toHaveText('1 Tag');
	await expect(page.getByTestId('budget-remaining')).toHaveText('29 Tage');
	const absences = await api(page, 'GET', '/api/v1/absences?from=2027-05-01&to=2027-05-31');
	const vacation = absences.body.filter((a: { kind: string }) => a.kind === 'vacation');
	expect(vacation).toHaveLength(1);
	expect(vacation[0]).toMatchObject({ startDate: '2027-05-07', endDate: '2027-05-07', status: 'planned' });
	// the same days are not suggested again
	await expect(page.locator('[data-testid="suggestion-card"]', { hasText: 'Christi Himmelfahrt' }).filter({ hasText: '1 Urlaubstag → 4' })).toHaveCount(0);
});
