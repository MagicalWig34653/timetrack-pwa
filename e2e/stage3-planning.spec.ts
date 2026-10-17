import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiCall as api, newActor as baseActor, registerViaInvite, type Actor } from './helpers';

// Stage-3a planning (vacation, absences, calendar, plan, sharing) against the real Swift backend.
// One serial story on a third backend instance with its own SQLite DB (global-setup, E2E_PLANNING_PORT).
// Alice (bootstrap admin) owns the data, Bob (invited by Alice) is the share recipient and the "foreign account".
test.describe.configure({ mode: 'serial' });

const BASE = `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 2}`;
test.use({ baseURL: BASE });
const newActor = (browser: Browser, credentials: Record<string, unknown>[] = []) => baseActor(browser, credentials, BASE);

// Fixed dates in 2026 (work model Mon-Fri from 2026-01-05, region DE-ST).
// Easter: Karfreitag 2026-04-03 and Ostermontag 2026-04-06 are DE-ST holidays on workdays.
const EASTER_FROM = '2026-03-30'; // Monday
const EASTER_TO = '2026-04-10'; // Friday two weeks later: 10 weekdays - 2 holidays = 8 days = 16 half days
const GOOD_FRIDAY = '2026-04-03';
const HALF_FROM = '2026-06-01'; // Monday: first day half
const HALF_MID = '2026-06-02';
const HALF_TO = '2026-06-03'; // Wednesday: last day half => 3 days - 2 halves = 2 days = 4 half days
const SICK_FROM = '2026-07-06'; // Monday
const SICK_TO = '2026-07-07';
const WORK_DAY = '2026-09-21'; // Monday with a real segment
const PLAN_DAY = '2026-09-22';
const RANGE = 'from=2026-03-01&to=2026-10-31';
const SECRET_NOTE = 'Geheime-Absenznotiz';
const SECRET_PLAN_NOTE = 'Geheime-Plannotiz';
const SECRET_SICK_NOTE = 'Geheime-Krankennotiz';
const SECRET_DOC = 'Bescheinigung-4711';

let alice: Actor;
let bob: Actor;
const ids: Record<string, string> = {};

const goToYear = async (page: Page, testId: string, year: number) => {
	for (let i = 0; i < 6 && (await page.getByTestId(testId).textContent())?.trim() !== String(year); i++) {
		const now = Number((await page.getByTestId(testId).textContent())?.trim());
		await page.getByRole('button', { name: now > year ? 'Vorjahr' : 'Folgejahr' }).click();
		await page.waitForTimeout(150);
	}
	await expect(page.getByTestId(testId)).toHaveText(String(year));
};

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
});

test('two fresh accounts register via invite', async ({ browser }) => {
	alice = await newActor(browser);
	await registerViaInvite(alice, new URL(process.env.E2E_PLANNING_BOOTSTRAP_LINK!).pathname, 'alice.plan', 'Alice Plan', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Plan' })).toBeVisible();
	const invite = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	expect(invite.status).toBe(201);
	bob = await newActor(browser);
	await registerViaInvite(bob, `/invite/${invite.body.token}`, 'bob.plan', 'Bob Plan', 'Passkey');
	await bob.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(bob.page.getByRole('heading', { name: 'Hallo, Bob Plan' })).toBeVisible();
});

test('work model: 38:30 h Mon-Fri', async () => {
	const { page } = alice;
	await page.goto('/settings/work-model');
	await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
	await page.getByLabel('Gültig ab').fill('2026-01-05');
	await page.getByLabel('Wochen-Soll').fill('38:30');
	await page.getByRole('button', { name: 'Version anlegen' }).click();
	await expect(page.getByText('Neue Version angelegt.')).toBeVisible();
	const res = await api(page, 'GET', '/api/v1/work-models');
	expect(res.body[0]).toMatchObject({ weeklyTargetSeconds: 138600, workdays: [1, 2, 3, 4, 5] });
});

test('vacation settings: defaults are only suggested, explicit save stores 30 days / DE-ST', async () => {
	const { page } = alice;
	const before = await api(page, 'GET', '/api/v1/vacation/settings');
	expect(before.status).toBe(200);
	expect(before.body).toMatchObject({ configured: false, region: 'DE-ST', annualEntitlementHalfDays: 60 });

	await page.goto('/vacation');
	await goToYear(page, 'vacation-year', 2026);
	await expect(page.getByTestId('vacation-cta')).toBeVisible();
	await expect(page.getByTestId('settings-suggestion')).toBeVisible();
	// Balance of an unconfigured account is computed from the suggestion, nothing is stored yet.
	expect((await api(page, 'GET', '/api/v1/vacation/settings')).body.configured).toBe(false);

	await expect(page.getByLabel('Jahresanspruch (Tage)')).toHaveValue('30');
	await page.getByLabel('Verfall des Übertrags (optional)').fill('31.03.');
	await page.getByLabel('Übertrag für 2026 (Tage)').fill('0');
	await page.getByRole('form', { name: 'Einstellungen' }).getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible();
	const after = await api(page, 'GET', '/api/v1/vacation/settings');
	expect(after.body).toMatchObject({ configured: true, region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverExpiry: '03-31' });
	await page.reload();
	await expect(page.getByTestId('vacation-cta')).toHaveCount(0);
	await goToYear(page, 'vacation-year', 2026);
	await expect(page.getByTestId('balance-available')).toHaveText('30 Tage');
	// M1: the stored numbers are visible in the summary card at the top, the settings are one click away and pre-filled
	await expect(page.getByTestId('vacation-balance')).toContainText('Dein Urlaubskonto 2026');
	await expect(page.getByTestId('balance-entitlement')).toHaveText('30 Tage');
	await page.getByTestId('vacation-edit-settings').click();
	await expect(page.getByLabel('Jahresanspruch (Tage)')).toHaveValue('30');
});

test('snapshot "Resturlaub zum Stichtag" replaces the entitlement instead of adding to it', async () => {
	const { page } = alice;
	await page.goto('/vacation');
	await goToYear(page, 'vacation-year', 2026);
	await expect(page.getByTestId('balance-entitlement')).toHaveText('30 Tage');
	const form = page.getByRole('form', { name: 'Resturlaub zum Stichtag' });
	await form.getByLabel('Stichtag').fill('2026-01-01');
	await form.getByLabel('Resturlaub (Tage)').fill('20');
	await form.getByRole('button', { name: 'Stichtagsbestand speichern' }).click();
	await expect(page.getByText('Stichtagsbestand gespeichert.')).toBeVisible();

	await expect(page.getByTestId('balance-snapshot')).toHaveText('20 Tage');
	await expect(page.getByTestId('vacation-tiles')).toContainText('durch den Stichtagsbestand ersetzt');
	await expect(page.getByTestId('balance-available')).toHaveText('20 Tage'); // not 50
	const bal = await api(page, 'GET', '/api/v1/vacation/balance?year=2026');
	expect(bal.body).toMatchObject({ snapshotDate: '2026-01-01', snapshotRemainingHalfDays: 40, entitlementHalfDays: 0, carryOverHalfDays: 0, availableHalfDays: 40 });

	// duplicate snapshot date -> 409
	const dup = await api(page, 'POST', '/api/v1/vacation/snapshots', { date: '2026-01-01', remainingHalfDays: 10 });
	expect(dup.status).toBe(409);
	await expect(page.getByTestId('vacation-entries')).toContainText('Stichtag');
});

test('vacation correction and entries: add and delete', async () => {
	const { page } = alice;
	await page.goto('/vacation');
	await goToYear(page, 'vacation-year', 2026);
	const form = page.getByRole('form', { name: 'Korrektur eintragen' });
	await form.getByLabel('Datum').fill('2026-02-02');
	await form.getByLabel('Tage (+ oder −)').fill('-0,5');
	await form.getByLabel('Grund').fill('Probe');
	await form.getByRole('button', { name: 'Korrektur speichern' }).click();
	await expect(page.getByText('Korrektur gespeichert.')).toBeVisible();
	await expect(page.getByTestId('balance-available')).toHaveText('19,5 Tage');
	const entries = page.getByTestId('vacation-entry');
	await expect(entries).toHaveCount(2);
	await entries.filter({ hasText: 'Korrektur' }).getByRole('button', { name: 'Löschen' }).click();
	await entries.filter({ hasText: 'Korrektur' }).getByRole('button', { name: 'Jetzt löschen' }).click();
	await expect(page.getByText('Eintrag gelöscht.')).toBeVisible();
	await expect(entries).toHaveCount(1);
	await expect(page.getByTestId('balance-available')).toHaveText('20 Tage');
});

test('vacation across Easter: holidays and weekends are not counted; planned -> approved -> taken', async () => {
	const { page } = alice;
	await page.goto('/absences');
	await goToYear(page, 'absences-year', 2026);
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	const form = page.getByTestId('absence-form');
	await form.getByLabel('Von', { exact: true }).fill(EASTER_FROM);
	await form.getByLabel('Bis', { exact: true }).fill(EASTER_TO);
	await form.getByLabel('Notiz (optional)').fill(SECRET_NOTE);
	await form.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Abwesenheit gespeichert.')).toBeVisible();
	const row = page.getByTestId('absence-row').filter({ hasText: '30.03.' });
	await expect(row.getByTestId('absence-status')).toHaveText('Geplant');
	await expect(row.getByTestId('absence-counted')).toContainText('Zählt: 8 Tage');

	let list = await api(page, 'GET', `/api/v1/absences?from=${EASTER_FROM}&to=${EASTER_TO}`);
	expect(list.body).toHaveLength(1);
	expect(list.body[0]).toMatchObject({ kind: 'vacation', status: 'planned', countedHalfDays: 16 });
	ids.easter = list.body[0].id;

	// planned: not deducted, shown as preview
	let bal = (await api(page, 'GET', '/api/v1/vacation/balance?year=2026')).body;
	expect(bal).toMatchObject({ bookedHalfDays: 0, plannedHalfDays: 16, availableHalfDays: 40, availableAfterPlannedHalfDays: 24 });
	await page.goto('/vacation');
	await goToYear(page, 'vacation-year', 2026);
	await expect(page.getByTestId('balance-available')).toHaveText('20 Tage');
	await expect(page.getByTestId('balance-after-planned')).toHaveText('12 Tage');
	await expect(page.getByTestId('balance-planned')).toHaveText('8 Tage');

	// planned -> approved through the UI (If-Match)
	for (const [status, label] of [
		['approved', 'Genehmigt'],
		['taken', 'Genommen']
	] as const) {
		await page.goto('/absences');
		await goToYear(page, 'absences-year', 2026);
		const r = page.getByTestId('absence-row').filter({ hasText: '30.03.' });
		await r.getByRole('button', { name: 'Bearbeiten' }).click();
		await page.getByTestId('absence-form').getByLabel('Status', { exact: true }).selectOption(status);
		await page.getByTestId('absence-form').getByRole('button', { name: 'Speichern' }).click();
		await expect(page.getByTestId('absence-row').filter({ hasText: '30.03.' }).getByTestId('absence-status')).toHaveText(label);
		bal = (await api(page, 'GET', '/api/v1/vacation/balance?year=2026')).body;
		// booked once; approved -> taken does not deduct again
		expect(bal).toMatchObject({ bookedHalfDays: 16, plannedHalfDays: 0, availableHalfDays: 24, availableAfterPlannedHalfDays: 24 });
	}
	await page.goto('/vacation');
	await goToYear(page, 'vacation-year', 2026);
	await expect(page.getByTestId('balance-available')).toHaveText('12 Tage');
	await expect(page.getByTestId('balance-booked')).toHaveText('8 Tage');
	await expect(page.getByTestId('balance-planned')).toHaveText('0 Tage');
});

test('day view on Good Friday: holiday wins over vacation (target 0, markSource holiday)', async () => {
	const { page } = alice;
	const day = (await api(page, 'GET', `/api/v1/time/days/${GOOD_FRIDAY}`)).body;
	expect(day).toMatchObject({ mark: 'holiday', markSource: 'holiday', targetSeconds: 0 });
	await page.goto(`/time/${GOOD_FRIDAY}`);
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await expect(page.getByTestId('day-mark-source')).toHaveAttribute('data-source', 'holiday');
	await expect(page.getByTestId('day-mark-source')).toContainText('Feiertag');
	// an ordinary vacation day inside the same absence
	const tue = (await api(page, 'GET', '/api/v1/time/days/2026-03-31')).body;
	expect(tue).toMatchObject({ mark: 'vacation', markSource: 'absence', targetSeconds: 0 });
	await page.goto('/time/2026-03-31');
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await expect(page.getByTestId('day-mark-source')).toHaveAttribute('data-source', 'absence');
});

test('half-day start and end halve the target; overlap is rejected in German', async () => {
	const { page } = alice;
	await page.goto('/absences');
	await goToYear(page, 'absences-year', 2026);
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	const form = page.getByTestId('absence-form');
	await form.getByLabel('Von', { exact: true }).fill(HALF_FROM);
	await form.getByLabel('Bis', { exact: true }).fill(HALF_TO);
	await form.getByLabel('Erster Tag nur halber Tag').check();
	await form.getByLabel('Letzter Tag nur halber Tag').check();
	await form.getByLabel('Status', { exact: true }).selectOption('approved');
	await form.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Abwesenheit gespeichert.')).toBeVisible();
	const row = page.getByTestId('absence-row').filter({ hasText: '01.06.' });
	await expect(row.getByTestId('absence-counted')).toContainText('Zählt: 2 Tage');
	const list = await api(page, 'GET', `/api/v1/absences?from=${HALF_FROM}&to=${HALF_TO}`);
	expect(list.body[0]).toMatchObject({ halfDayStart: true, halfDayEnd: true, status: 'approved', countedHalfDays: 4 });
	ids.half = list.body[0].id;

	const first = (await api(page, 'GET', `/api/v1/time/days/${HALF_FROM}`)).body;
	const mid = (await api(page, 'GET', `/api/v1/time/days/${HALF_MID}`)).body;
	const last = (await api(page, 'GET', `/api/v1/time/days/${HALF_TO}`)).body;
	expect(first).toMatchObject({ mark: 'vacation', markSource: 'absence', targetSeconds: 13860, targetOverrideSeconds: 13860 });
	expect(mid).toMatchObject({ mark: 'vacation', markSource: 'absence', targetSeconds: 0 });
	expect(last).toMatchObject({ mark: 'vacation', markSource: 'absence', targetSeconds: 13860 });
	await page.goto(`/time/${HALF_FROM}`);
	await expect(page.getByTestId('day-target')).toHaveText('3:51');
	await expect(page.getByTestId('day-target-note')).toContainText('halbiert');
	await page.goto(`/time/${HALF_MID}`);
	await expect(page.getByTestId('day-target')).toHaveText('0:00');

	// overlap: UI shows the German text, the API answers 409 with a German message
	await page.goto('/absences');
	await goToYear(page, 'absences-year', 2026);
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	const f2 = page.getByTestId('absence-form');
	await f2.getByLabel('Von', { exact: true }).fill(HALF_TO);
	await f2.getByLabel('Bis', { exact: true }).fill('2026-06-04');
	await f2.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('absence-error')).toContainText('bereits eine andere Abwesenheit');
	const dup = await api(page, 'POST', '/api/v1/absences', { kind: 'sick', startDate: HALF_TO, endDate: '2026-06-04', status: 'approved' });
	expect(dup.status).toBe(409);
	expect(dup.body.error.code).toBe('absence_overlap');
	expect(JSON.stringify(dup.body)).toContain('überschneidet');
});

test('sick absence with document fields; effect on day view and on the time account', async () => {
	const { page } = alice;
	const accBefore = (await api(page, 'GET', '/api/v1/time/account')).body;
	await page.goto('/absences');
	await goToYear(page, 'absences-year', 2026);
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	const form = page.getByTestId('absence-form');
	await form.getByLabel('Art', { exact: true }).selectOption('sick');
	await form.getByLabel('Von', { exact: true }).fill(SICK_FROM);
	await form.getByLabel('Bis', { exact: true }).fill(SICK_TO);
	await form.getByLabel('Status', { exact: true }).selectOption('approved');
	await form.getByLabel('Notiz (optional)').fill(SECRET_SICK_NOTE);
	await form.getByLabel('Stand der Unterlagen').selectOption('submitted');
	await form.getByLabel('Eingereicht am').fill('2026-07-08');
	await form.getByLabel('Bescheinigung gilt ab').fill(SICK_FROM);
	await form.getByLabel('Bescheinigung gilt bis').fill(SICK_TO);
	await form.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Abwesenheit gespeichert.')).toBeVisible();
	const row = page.getByTestId('absence-row').filter({ hasText: '06.07.' });
	await expect(row.getByTestId('absence-counted')).toContainText('Verbraucht keinen Urlaub');
	await expect(row).toContainText('Unterlagen: Eingereicht');

	const list = await api(page, 'GET', `/api/v1/absences?from=${SICK_FROM}&to=${SICK_TO}`);
	expect(list.body[0]).toMatchObject({
		kind: 'sick',
		countedHalfDays: 0,
		documentStatus: 'submitted',
		documentSubmittedOn: '2026-07-08',
		documentReferenceStart: SICK_FROM,
		documentReferenceEnd: SICK_TO,
		note: SECRET_SICK_NOTE
	});
	ids.sick = list.body[0].id;
	// sick leave does not touch the vacation balance
	expect((await api(page, 'GET', '/api/v1/vacation/balance?year=2026')).body).toMatchObject({ bookedHalfDays: 20, availableHalfDays: 20 }); // Easter 16 + half-day absence 4

	const day = (await api(page, 'GET', `/api/v1/time/days/${SICK_FROM}`)).body;
	expect(day).toMatchObject({ mark: 'sick', markSource: 'absence', targetSeconds: 0, deltaSeconds: 0 });
	await page.goto(`/time/${SICK_FROM}`);
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await expect(page.getByTestId('day-delta')).toHaveText('0:00');
	await expect(page.getByTestId('day-mark-source')).toHaveAttribute('data-source', 'absence');

	// the two sick days no longer count as missing target time: balance rises by exactly 2 x 7:42, never falls
	const accAfter = (await api(page, 'GET', '/api/v1/time/account')).body;
	expect(accAfter.balanceSeconds - accBefore.balanceSeconds).toBe(2 * 27720);
});

test('stale absence edit (412): the UI offers the current version', async () => {
	const { page } = alice;
	await page.goto('/absences');
	await goToYear(page, 'absences-year', 2026);
	const row = page.getByTestId('absence-row').filter({ hasText: '06.07.' });
	await row.getByRole('button', { name: 'Bearbeiten' }).click();
	const current = (await api(page, 'GET', `/api/v1/absences/${ids.sick}`)).body;
	// another client changes the note first
	const { id, version, countedHalfDays, ...input } = current;
	void id;
	void countedHalfDays;
	const other = await api(page, 'PUT', `/api/v1/absences/${ids.sick}`, { ...input, note: 'Von anderem Gerät' }, { 'If-Match': String(version) });
	expect(other.status).toBe(200);
	expect(other.body.version).toBe(version + 1);
	await page.getByTestId('absence-form').getByLabel('Notiz (optional)').fill('Meine Änderung');
	await page.getByTestId('absence-form').getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('absence-stale')).toBeVisible();
	await page.getByRole('button', { name: 'Aktuelle Fassung laden' }).click();
	await expect(page.getByTestId('absence-form').getByLabel('Notiz (optional)')).toHaveValue('Von anderem Gerät');
	await page.getByTestId('absence-form').getByRole('button', { name: 'Abbrechen' }).click();
});

test('time account does not go negative from vacation/holiday days', async () => {
	const { page } = alice;
	const days = (await api(page, 'GET', '/api/v1/time/days?from=2026-03-30&to=2026-04-10')).body;
	expect(days).toHaveLength(12);
	for (const d of days) expect(d.deltaSeconds, d.date).toBe(0);
});

test('custom holiday and school holiday', async () => {
	const { page } = alice;
	await page.goto('/calendar?date=2026-05-15');
	const cell = page.getByTestId('month-grid').locator('[data-date="2026-05-15"]');
	await cell.click();
	await page.getByRole('button', { name: 'Eigener Tag' }).click();
	const form = page.getByTestId('custom-day-form');
	await form.getByLabel('Art').selectOption('holiday');
	await form.getByLabel('Bezeichnung').fill('Brückentag');
	await form.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Eigener Tag gespeichert.')).toBeVisible();
	await expect(cell.locator('[data-chip="holiday"]')).toContainText('Brückentag');

	await cell.click();
	await page.getByRole('button', { name: 'Eigener Tag' }).click();
	const f2 = page.getByTestId('custom-day-form');
	await f2.getByLabel('Art').selectOption('school_holiday');
	await f2.getByLabel('Bezeichnung').fill('Sommerferien');
	await f2.getByLabel('Von', { exact: true }).fill('2026-05-18');
	await f2.getByLabel('Bis', { exact: true }).fill('2026-05-22');
	await f2.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Eigener Tag gespeichert.')).toBeVisible();
	await expect(page.getByTestId('month-grid').locator('[data-date="2026-05-20"] [data-chip="school-holiday"]')).toContainText('Sommerferien');

	const holidays = (await api(page, 'GET', '/api/v1/calendar/holidays?year=2026')).body;
	const custom = holidays.filter((h: any) => h.source === 'custom');
	expect(custom.map((h: any) => h.name).sort()).toEqual(['Brückentag', 'Sommerferien']);
	expect(holidays.some((h: any) => h.name === 'Karfreitag' && h.startDate === GOOD_FRIDAY && h.source === 'builtin')).toBe(true);
	expect(holidays.some((h: any) => h.startDate === '2026-10-31' && /Reformation/.test(h.name))).toBe(true);
	ids.bridge = custom.find((h: any) => h.name === 'Brückentag').id;
	ids.school = custom.find((h: any) => h.name === 'Sommerferien').id;

	// the custom holiday on a workday: target 0, markSource holiday
	expect((await api(page, 'GET', '/api/v1/time/days/2026-05-15')).body).toMatchObject({ mark: 'holiday', markSource: 'holiday', targetSeconds: 0 });

	// delete the school holiday again through the UI
	await page.getByTestId('month-grid').locator('[data-date="2026-05-20"]').click();
	await page.getByRole('button', { name: 'Eintrag löschen' }).click();
	await expect(page.getByText('Eigener Tag gelöscht.')).toBeVisible();
	await expect(page.getByTestId('month-grid').locator('[data-chip="school-holiday"]')).toHaveCount(0);
});

test('plan entries: set, change, remove (calendar UI) and a place reference', async () => {
	const { page } = alice;
	const place = await api(page, 'POST', '/api/v1/places', { name: 'Büro', kind: 'office', automationMode: 'off' });
	expect(place.status).toBe(201);
	ids.place = place.body.id;

	await page.goto(`/calendar?date=${PLAN_DAY}`);
	const cell = page.getByTestId('month-grid').locator(`[data-date="${PLAN_DAY}"]`);
	await cell.click();
	await page.getByRole('button', { name: 'Planung festlegen' }).click();
	const form = page.getByTestId('plan-form');
	await form.getByLabel('Arbeitsform').selectOption('home');
	await form.getByLabel('Notiz (optional)').fill(SECRET_PLAN_NOTE);
	await form.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Planung gespeichert.')).toBeVisible();
	await expect(cell.locator('[data-chip="plan"]')).toHaveText('Homeoffice');
	await expect(page.getByTestId('panel-plan')).toContainText(SECRET_PLAN_NOTE);

	await page.getByRole('button', { name: 'Planung ändern' }).click();
	await page.getByTestId('plan-form').getByLabel('Arbeitsform').selectOption('office');
	await page.getByTestId('plan-form').getByLabel('Ort (optional)').selectOption(ids.place);
	await page.getByTestId('plan-form').getByRole('button', { name: 'Speichern' }).click();
	await expect(cell.locator('[data-chip="plan"]')).toHaveText('Büro');
	let plan = (await api(page, 'GET', `/api/v1/plan/days?from=${PLAN_DAY}&to=${PLAN_DAY}`)).body;
	expect(plan).toEqual([expect.objectContaining({ date: PLAN_DAY, mode: 'office', placeId: ids.place })]);

	await page.getByRole('button', { name: 'Planung ändern' }).click();
	await page.getByRole('button', { name: 'Planung entfernen' }).click();
	await expect(cell.locator('[data-chip="plan"]')).toHaveCount(0);
	plan = (await api(page, 'GET', `/api/v1/plan/days?from=${PLAN_DAY}&to=${PLAN_DAY}`)).body;
	expect(plan).toEqual([]);
	// idempotent delete
	expect((await api(page, 'DELETE', `/api/v1/plan/days/${PLAN_DAY}`)).status).toBe(204);

	// entries used later for sharing: a plan with a note on the worked day and one on the plan day
	expect((await api(page, 'PUT', `/api/v1/plan/days/${PLAN_DAY}`, { mode: 'home', note: SECRET_PLAN_NOTE, placeId: ids.place })).status).toBe(200);
	expect((await api(page, 'PUT', `/api/v1/plan/days/${WORK_DAY}`, { mode: 'office', note: SECRET_PLAN_NOTE })).status).toBe(200);
	const seg = await api(page, 'POST', '/api/v1/time/segments', { kind: 'work', startedAt: `${WORK_DAY}T06:00:00Z`, endedAt: `${WORK_DAY}T14:00:00Z`, placeId: ids.place, note: 'Geheime-Segmentnotiz' });
	expect(seg.status).toBe(201);
});

test('calendar shows holiday and absence chips for the Easter vacation', async () => {
	const { page } = alice;
	await page.goto(`/calendar?date=${EASTER_FROM}`);
	await expect(page.getByTestId('month-grid').locator(`[data-date="${GOOD_FRIDAY}"]`).locator('[data-chip="holiday"]')).toContainText('Karfreitag');
	await expect(page.getByTestId('month-grid').locator('[data-date="2026-03-31"]').locator('[data-chip="absence"]')).toContainText('Urlaub');
});

test('sharing: nothing is shared by default, scopes are enabled separately', async () => {
	const { page } = alice;
	// unknown handle 404, self 400
	const unknown = await api(page, 'POST', '/api/v1/shares', { recipientHandle: 'nobody.here', scopes: { plan: true } });
	expect(unknown.status).toBe(404);
	const self = await api(page, 'POST', '/api/v1/shares', { recipientHandle: 'alice.plan', scopes: { plan: true } });
	expect(self.status).toBe(400);

	// UI: the same two errors in German
	await page.goto('/settings/sharing');
	await expect(page.getByTestId('shares-empty')).toBeVisible();
	await page.getByLabel('Kontoname der Person').fill('nobody.here');
	await page.locator('#new-scope-plan').check();
	await page.getByRole('button', { name: 'Freigabe anlegen' }).click();
	await expect(page.getByTestId('share-error')).toContainText('nicht gefunden');
	await page.getByLabel('Kontoname der Person').fill('alice.plan');
	await page.getByRole('button', { name: 'Freigabe anlegen' }).click();
	await expect(page.getByText('Du kannst nichts an dein eigenes Konto freigeben.')).toBeVisible(); // client-side check; the server 400 is asserted above

	// create with all scopes false = nothing shared
	const created = await api(page, 'POST', '/api/v1/shares', { recipientHandle: 'Bob.Plan ', scopes: {} });
	expect(created.status).toBe(201);
	expect(created.body.recipientHandle).toBe('bob.plan');
	ids.share = created.body.id;
	const dup = await api(page, 'POST', '/api/v1/shares', { recipientHandle: 'bob.plan', scopes: { plan: true } });
	expect(dup.status).toBe(409);
	expect(dup.body.error.code).toBe('share_exists');
	// ... and in the UI
	await page.goto('/settings/sharing');
	await page.getByLabel('Kontoname der Person').fill('bob.plan');
	await page.locator('#new-scope-plan').check();
	await page.getByRole('button', { name: 'Freigabe anlegen' }).click();
	await expect(page.getByTestId('share-error')).toContainText('bereits eine Freigabe');

	// Bob sees the share, but nothing is exposed yet
	const incoming = await api(bob.page, 'GET', '/api/v1/shares/incoming');
	expect(incoming.body).toEqual([expect.objectContaining({ id: ids.share, ownerDisplayName: 'Alice Plan', scopes: expect.any(Object) })]);
	const view0 = await api(bob.page, 'GET', `/api/v1/shares/incoming/${ids.share}/view?${RANGE}`);
	expect(view0.status).toBe(200);
	expect(view0.body).toEqual({});
});

test('sharing: enabling plan, actual and vacation one by one shows only those fields', async () => {
	const { page } = alice;
	await page.goto('/settings/sharing');
	const row = page.getByTestId('share-row').filter({ hasText: 'bob.plan' });
	const view = async () => (await api(bob.page, 'GET', `/api/v1/shares/incoming/${ids.share}/view?${RANGE}`)).body;

	await row.getByLabel('Planung bob.plan').check();
	await expect.poll(async () => Object.keys(await view())).toEqual(['plan']);
	let v = await view();
	expect(v.plan).toEqual(
		expect.arrayContaining([
			{ date: PLAN_DAY, mode: 'home' },
			{ date: WORK_DAY, mode: 'office' }
		])
	);

	await row.getByLabel('Tatsächliche Zeiten bob.plan').check();
	await expect.poll(async () => Object.keys(await view()).sort()).toEqual(['actual', 'plan']);
	v = await view();
	expect(v.actual).toHaveLength(1);
	expect(v.actual[0]).toMatchObject({ date: WORK_DAY });
	expect(v.actual[0].evaluatedWorkSeconds).toBeGreaterThan(0);

	await row.getByLabel('Urlaub bob.plan').check();
	await expect.poll(async () => Object.keys(await view()).sort()).toEqual(['actual', 'plan', 'vacation']);
	v = await view();
	// approved/taken vacation only; sick leave and half-day flags/status are not exposed
	expect(v.vacation).toEqual(
		expect.arrayContaining([
			{ startDate: EASTER_FROM, endDate: EASTER_TO },
			{ startDate: HALF_FROM, endDate: HALF_TO }
		])
	);
	expect(v.vacation.some((x: any) => x.startDate === SICK_FROM)).toBe(false);

	// Strict field whitelist: no notes, places, sick leave, documents, segment data.
	for (const p of v.plan) expect(Object.keys(p).sort()).toEqual(['date', 'mode']);
	for (const a of v.actual) expect(Object.keys(a).every((k) => ['date', 'evaluatedStart', 'evaluatedEnd', 'evaluatedWorkSeconds'].includes(k))).toBe(true);
	for (const x of v.vacation) expect(Object.keys(x).sort()).toEqual(['endDate', 'startDate']);
	const raw = JSON.stringify(v);
	for (const key of ['note', 'place', 'sick', 'document', 'status', 'kind', 'segment']) expect(raw.toLowerCase(), key).not.toContain(key);
	for (const secret of [SECRET_NOTE, SECRET_PLAN_NOTE, SECRET_SICK_NOTE, SECRET_DOC, 'Geheime-Segmentnotiz', ids.place]) expect(raw).not.toContain(secret);

	// disabling one scope removes exactly that key
	await row.getByLabel('Tatsächliche Zeiten bob.plan').uncheck();
	await expect.poll(async () => Object.keys(await view()).sort()).toEqual(['plan', 'vacation']);
});

test('sharing: recipient UI shows the shared data read-only', async () => {
	const { page } = bob;
	await page.goto('/shared');
	await expect(page.getByTestId('incoming-list')).toContainText('Alice Plan');
	await page.getByTestId('incoming-list').getByRole('button', { name: /Alice Plan/ }).click();
	await page.getByLabel('Von', { exact: true }).fill('2026-03-01');
	await page.getByLabel('Bis', { exact: true }).fill('2026-10-31');
	await page.getByRole('button', { name: 'Anzeigen' }).click();
	await expect(page.getByTestId('shared-plan')).toContainText('Homeoffice');
	await expect(page.getByTestId('shared-vacation')).toContainText('30.03.2026');
	await expect(page.getByTestId('shared-view')).not.toContainText(SECRET_PLAN_NOTE);
	await expect(page.getByTestId('shared-view')).not.toContainText('Krank');
	await expect(page.getByTestId('shared-view').getByRole('button', { name: /Speichern|Löschen|Bearbeiten/ })).toHaveCount(0);
});

test('account separation: foreign IDs are 404 for absences, plan, vacation entries, custom days and shares', async () => {
	const b = bob.page;
	const a = alice.page;
	const entries = (await api(a, 'GET', '/api/v1/vacation/entries?year=2026')).body;
	const snapshotId = entries.snapshots[0].id;
	const input = { kind: 'vacation', startDate: EASTER_FROM, endDate: EASTER_TO, status: 'approved' };

	expect((await api(b, 'GET', `/api/v1/absences/${ids.easter}`)).status).toBe(404);
	expect((await api(b, 'PUT', `/api/v1/absences/${ids.easter}`, input, { 'If-Match': '1' })).status).toBe(404);
	expect((await api(b, 'DELETE', `/api/v1/absences/${ids.sick}`)).status).toBe(404);
	expect((await api(b, 'DELETE', `/api/v1/vacation/entries/${snapshotId}`)).status).toBe(404);
	expect((await api(b, 'DELETE', `/api/v1/calendar/custom-days/${ids.bridge}`)).status).toBe(404);
	expect((await api(b, 'PUT', `/api/v1/plan/days/${PLAN_DAY}`, { mode: 'office', placeId: ids.place })).status).toBe(404);
	expect((await api(b, 'PATCH', `/api/v1/shares/${ids.share}`, { scopes: { plan: true } })).status).toBe(404);
	expect((await api(b, 'DELETE', `/api/v1/shares/${ids.share}`)).status).toBe(404);
	// Alice cannot read her own outgoing share as recipient
	expect((await api(a, 'GET', `/api/v1/shares/incoming/${ids.share}/view?${RANGE}`)).status).toBe(404);

	// Bob's own lists do not contain Alice's data
	expect((await api(b, 'GET', `/api/v1/absences?${RANGE}`)).body).toEqual([]);
	expect((await api(b, 'GET', `/api/v1/plan/days?${RANGE}`)).body).toEqual([]);
	expect((await api(b, 'GET', '/api/v1/shares')).body).toEqual([]);
	expect((await api(b, 'GET', '/api/v1/vacation/entries?year=2026')).body).toEqual({ snapshots: [], adjustments: [] });
	expect((await api(b, 'GET', '/api/v1/calendar/holidays?year=2026')).body.filter((h: any) => h.source === 'custom')).toEqual([]);

	// Alice's data is untouched
	expect((await api(a, 'GET', `/api/v1/absences/${ids.easter}`)).status).toBe(200);
});

test('revoking a share takes effect immediately for the recipient', async () => {
	const { page } = alice;
	await page.goto('/settings/sharing');
	const row = page.getByTestId('share-row').filter({ hasText: 'bob.plan' });
	await row.getByRole('button', { name: 'Widerrufen bob.plan' }).click();
	await page.getByRole('button', { name: 'Jetzt widerrufen bob.plan' }).click();
	await expect(page.getByText('Freigabe für bob.plan widerrufen. Sie wirkt sofort.')).toBeVisible();
	await expect(page.getByTestId('shares-empty')).toBeVisible();

	expect((await api(bob.page, 'GET', `/api/v1/shares/incoming/${ids.share}/view?${RANGE}`)).status).toBe(404);
	expect((await api(bob.page, 'GET', '/api/v1/shares/incoming')).body).toEqual([]);
	await bob.page.goto('/shared');
	await expect(bob.page.getByTestId('incoming-empty')).toBeVisible();
	// the old id stays dead, a new share gets a new id
	expect((await api(page, 'PATCH', `/api/v1/shares/${ids.share}`, { scopes: { plan: true } })).status).toBe(404);
});

test('entries can be deleted: absences from the list, plan day, custom day', async () => {
	const { page } = alice;
	page.once('dialog', (d) => void d.accept());
	await page.goto('/absences');
	await goToYear(page, 'absences-year', 2026);
	const rows = page.getByTestId('absence-row');
	const before = await rows.count();
	await rows.filter({ hasText: '06.07.' }).getByRole('button', { name: 'Löschen' }).click();
	await expect(page.getByTestId('absence-row')).toHaveCount(before - 1);
	expect((await api(page, 'GET', `/api/v1/absences/${ids.sick}`)).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/absences/${ids.half}`)).status).toBe(204);
	expect((await api(page, 'DELETE', `/api/v1/calendar/custom-days/${ids.bridge}`)).status).toBe(204);
	expect((await api(page, 'DELETE', `/api/v1/plan/days/${PLAN_DAY}`)).status).toBe(204);
	// the day returns to a normal workday: target 7:42 again
	expect((await api(page, 'GET', `/api/v1/time/days/${SICK_FROM}`)).body).toMatchObject({ mark: 'none', markSource: 'none', targetSeconds: 27720 });
});

// M1: pre-filled new-version form and correcting a version with preview and confirmation (real backend, contract v0.16.0).
// Kept last: the correction changes alice's balance, which the earlier steps do not look at.
test('work model: pre-filled form, correction with preview changes the balance as announced, overlap is explained', async () => {
	const { page } = alice;
	const clock = (seconds: number) => {
		const sign = seconds < 0 ? '-' : seconds > 0 ? '+' : '';
		const minutes = Math.floor(Math.abs(seconds) / 60);
		return `${sign}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
	};
	await page.goto('/settings/work-model');
	await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
	await expect(page.getByLabel('Wochen-Soll')).toHaveValue('38:30');
	await expect(page.getByLabel('Mo', { exact: true })).toBeChecked();
	await page.getByRole('button', { name: 'Abbrechen' }).click();

	const before = (await api(page, 'GET', '/api/v1/time/account')).body.balanceSeconds as number;
	await page.getByTestId('edit-model-2026-01-05').click();
	await page.getByTestId('mode-correct').check();
	await page.getByLabel('Wochen-Soll').fill('30:00');
	const line = page.getByTestId('preview-line');
	await expect(line).toContainText(`vorher ${clock(before)}`);
	await expect(page.getByTestId('correct-submit')).toBeDisabled();
	const text = (await line.textContent()) ?? '';
	await page.getByLabel('Ich habe verstanden, dass sich Auswertungen ändern').check();
	await page.getByTestId('correct-submit').click();
	await expect(page.getByTestId('toast')).toContainText('Version korrigiert');
	const after = (await api(page, 'GET', '/api/v1/time/account')).body.balanceSeconds as number;
	expect(after).toBeGreaterThan(before);
	expect(text).toContain(`nachher ${clock(after)}`);
	const models = (await api(page, 'GET', '/api/v1/work-models')).body;
	expect(models[0]).toMatchObject({ weeklyTargetSeconds: 108000, version: 2 });
	await expect(page.getByTestId('model-summary-weekly').first()).toContainText('30:00 h');

	// a second version makes the first one a closed neighbour: running it into the successor is rejected in plain German
	const created = await api(page, 'POST', '/api/v1/work-models', { validFrom: '2026-12-01', weeklyTargetSeconds: 108000, workdays: [1, 2, 3, 4, 5] });
	expect(created.status).toBe(201);
	await page.goto('/settings/work-model');
	await page.getByTestId('edit-model-2026-01-05').click();
	await page.getByTestId('mode-correct').check();
	await expect(page.getByTestId('preview-line')).toBeVisible();
	await page.getByLabel('Gültig bis').fill('');
	await expect(page.getByTestId('preview-error')).toContainText('überschneidet sich mit einer Nachbarversion');
	await expect(page.getByTestId('correct-submit')).toBeDisabled();
	expect((await api(page, 'GET', '/api/v1/work-models')).body[0].validTo).toBe('2026-11-30');
});

// ---- K1: week planning and week overview against the real backend (contract v0.17.0) ----
// 2026-W47 = 16.-22.11.2026, inside the first work model version (30:00 h/week after the correction above = 6:00 per day).
const K1_WEEK = '2026-W47';
const K1_MONDAY = '2026-11-16';

test('K1 API: week plan with times, blocked day, validation in German, all or nothing, isolation, shares', async () => {
	const { page } = alice;
	const absence = await api(page, 'POST', '/api/v1/absences', { kind: 'vacation', startDate: '2026-11-18', endDate: '2026-11-18', status: 'approved' });
	expect(absence.status).toBe(201);
	const day = (date: string, extra: Record<string, unknown> = {}) => ({ date, mode: 'office', plannedStart: '08:00', plannedEnd: '14:30', plannedBreakMinutes: 30, ...extra });
	const saved = await api(page, 'PUT', `/api/v1/plan/weeks/${K1_WEEK}`, { replace: true, days: [day('2026-11-16'), day('2026-11-17', { note: 'Geheime-K1-Notiz' }), day('2026-11-18'), day('2026-11-19', { mode: 'home' }), day('2026-11-20', { mode: 'off' })] });
	expect(saved.status).toBe(200);
	expect(saved.body.days).toHaveLength(7);
	expect(saved.body.days[2]).toMatchObject({ blockedBy: 'vacation', targetSeconds: 0, plannedSeconds: 0 });
	expect(saved.body.days[2].plan.plannedSeconds).toBe(6 * 3600);
	expect(saved.body.days[0]).toMatchObject({ blockedBy: null, targetSeconds: 21600, plannedSeconds: 21600 });
	expect(saved.body.totals).toEqual({ targetSeconds: 4 * 21600, plannedSeconds: 3 * 21600, differenceSeconds: -21600 });
	// German validation message, nothing stored for an invalid week
	const bad = await api(page, 'PUT', `/api/v1/plan/weeks/${K1_WEEK}`, { replace: true, days: [day('2026-11-16'), day('2026-11-17', { plannedEnd: '07:00' })] });
	expect(bad.status).toBe(400);
	expect(bad.body.error).toMatchObject({ code: 'plan_time_invalid' });
	expect(bad.body.error.message).toContain('Uhrzeit');
	expect((await api(page, 'GET', `/api/v1/plan/weeks/${K1_WEEK}`)).body.days.filter((d: any) => d.plan).length).toBe(5);
	expect((await api(page, 'GET', '/api/v1/plan/weeks/2026-W99')).body.error.code).toBe('invalid_week');
	// old single-day clients still work
	expect((await api(page, 'PUT', '/api/v1/plan/days/2026-11-21', { mode: 'home' })).body).toMatchObject({ mode: 'home', plannedStart: null, plannedSeconds: null });
	await api(page, 'DELETE', '/api/v1/plan/days/2026-11-21');
	// the other account sees nothing of it and cannot delete it
	expect((await api(bob.page, 'GET', `/api/v1/plan/weeks/${K1_WEEK}`)).body.days.every((d: any) => d.plan === null)).toBe(true);
	await api(bob.page, 'PUT', `/api/v1/plan/weeks/${K1_WEEK}`, { replace: true, days: [] });
	expect((await api(page, 'GET', `/api/v1/plan/days?from=${K1_MONDAY}&to=2026-11-22`)).body).toHaveLength(5);
	// shares: planned times belong to the plan scope, notes never
	const shares = (await api(page, 'GET', '/api/v1/shares')).body as { id: string; scopes: { plan: boolean } }[];
	const incoming = (await api(bob.page, 'GET', '/api/v1/shares/incoming')).body as { id: string; scopes: { plan: boolean } }[];
	if (incoming.length === 0) {
		expect((await api(page, 'POST', '/api/v1/shares', { recipientHandle: 'bob.plan', scopes: { plan: true } })).status).toBe(201);
	} else if (!incoming[0].scopes.plan) {
		await api(page, 'PATCH', `/api/v1/shares/${shares[0].id}`, { scopes: { plan: true } });
	}
	const share = (await api(bob.page, 'GET', '/api/v1/shares/incoming')).body[0];
	const view = await api(bob.page, 'GET', `/api/v1/shares/incoming/${share.id}/view?from=${K1_MONDAY}&to=2026-11-22`);
	expect(view.body.plan[0]).toMatchObject({ date: K1_MONDAY, plannedStart: '08:00', plannedEnd: '14:30', plannedSeconds: 21600 });
	expect(JSON.stringify(view.body)).not.toContain('Geheime-K1-Notiz');
});

test('K1 API: time week equals the sum of the day evaluations and the account balances (past week)', async () => {
	const { page } = alice;
	// 2026-W34 = 17.-23.08.2026 lies in the past on every run date; 6:00 target per workday
	const segment = (startedAt: string, endedAt: string) => api(page, 'POST', '/api/v1/time/segments', { kind: 'work', startedAt, endedAt });
	expect((await segment('2026-08-17T06:00:00Z', '2026-08-17T10:00:00Z')).status).toBe(201);
	expect((await segment('2026-08-17T10:30:00Z', '2026-08-17T14:10:00Z')).status).toBe(201);
	expect((await segment('2026-08-18T07:00:00Z', '2026-08-18T13:30:00Z')).status).toBe(201);
	expect((await api(page, 'PUT', '/api/v1/plan/days/2026-08-21', { mode: 'home', plannedStart: '08:00', plannedEnd: '12:00' })).status).toBe(200);
	const week = (await api(page, 'GET', '/api/v1/time/weeks/2026-W34')).body;
	const days = (await api(page, 'GET', '/api/v1/time/days?from=2026-08-17&to=2026-08-23')).body as any[];
	const sum = (key: string) => days.reduce((total, d) => total + d[key], 0);
	expect(week.summary).toMatchObject({ workSeconds: sum('evaluatedWorkSeconds'), targetSeconds: sum('targetSeconds'), balanceSeconds: sum('deltaSeconds'), creditSeconds: sum('creditSeconds'), vacationDays: 0, workDays: 2 });
	expect(week.days.map((d: any) => d.mark)).toEqual(['work', 'work', 'work', 'work', 'work', 'off', 'off']);
	expect(week.days.map((d: any) => d.balanceSeconds)).toEqual(days.map((d) => d.deltaSeconds));
	expect(week.days[0]).toMatchObject({ segmentsCount: 2, breakSeconds: 30 * 60 });
	expect(week.summary.plannedSeconds).toBe(4 * 3600);
	expect(week.days[4]).toMatchObject({ planMode: 'home', plannedSeconds: 4 * 3600 });
	expect((await api(page, 'GET', '/api/v1/time/account?asOf=2026-08-16')).body.balanceSeconds).toBe(week.summary.accountBalanceBeforeSeconds);
	expect((await api(page, 'GET', '/api/v1/time/account?asOf=2026-08-23')).body.balanceSeconds).toBe(week.summary.accountBalanceAfterSeconds);
	expect(week.summary.accountBalanceAfterSeconds - week.summary.accountBalanceBeforeSeconds).toBe(week.summary.balanceSeconds);
	await api(page, 'DELETE', '/api/v1/plan/days/2026-08-21');
	// the other account sees none of this week
	const foreign = (await api(bob.page, 'GET', '/api/v1/time/weeks/2026-W34')).body;
	expect(foreign.summary.workSeconds).toBe(0);
});

test('K1 UI: overview numbers match the API, the planner saves a week, blocked day is disabled', async () => {
	const { page } = alice;
	const week = (await api(page, 'GET', `/api/v1/time/weeks/${K1_WEEK}`)).body;
	const clock = (seconds: number) => `${seconds < 0 ? '-' : ''}${Math.floor(Math.abs(seconds) / 3600)}:${String(Math.floor((Math.abs(seconds) % 3600) / 60)).padStart(2, '0')}`;
	await page.goto(`/week?week=${K1_WEEK}`);
	await expect(page.getByTestId('week-overview')).toBeVisible();
	await expect(page.getByTestId('week-actual')).toHaveText(clock(week.summary.workSeconds + week.summary.creditSeconds));
	await expect(page.getByTestId('week-target')).toHaveText(clock(week.summary.targetSeconds));
	await expect(page.getByTestId('week-account')).toContainText(`${week.summary.accountBalanceAfterSeconds > 0 ? '+' : ''}${clock(week.summary.accountBalanceAfterSeconds)}`);
	await expect(page.getByTestId('week-day-2026-11-18')).toHaveAttribute('data-mark', 'vacation');
	await expect(page.getByTestId('week-day-2026-11-16').getByTestId('bar-planned')).toBeVisible();
	await expect(page.getByTestId('week-day-2026-11-16')).toHaveAttribute('aria-label', /geplant 6:00 Stunden/);
	await expect(page.getByTestId('week-plan-card')).toContainText('Geplant 18:00');

	await page.getByTestId('tab-plan').click();
	await expect(page.getByTestId('week-planner')).toBeVisible();
	await expect(page.locator('#plan-mode-2026-11-18')).toBeDisabled();
	await expect(page.getByTestId('plan-blocked-2026-11-18')).toContainText('Urlaub eingetragen.');
	await page.getByTestId('plan-clear').click();
	await page.locator('#plan-mode-2026-11-16').selectOption('customer');
	await page.locator('#plan-start-2026-11-16').fill('09:00');
	await page.locator('#plan-end-2026-11-16').fill('15:30');
	await page.locator('#plan-break-2026-11-16').fill('30');
	await expect(page.getByTestId('plan-hours-2026-11-16')).toHaveText('6:00');
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('toast')).toHaveText('Woche gespeichert.');
	const stored = (await api(page, 'GET', `/api/v1/plan/weeks/${K1_WEEK}`)).body;
	expect(stored.days[0].plan).toMatchObject({ mode: 'customer', plannedStart: '09:00', plannedEnd: '15:30', plannedBreakMinutes: 30, plannedSeconds: 21600 });
	expect(stored.days[2].plan.mode).toBe('office'); // the plan of the blocked day survives a replacing save
	expect(stored.days.filter((d: any) => d.plan).length).toBe(2);
	await page.reload();
	await expect(page.locator('#plan-mode-2026-11-16')).toHaveValue('customer');
});

test('K1 UI: today line on Heute and planned times in the calendar detail', async () => {
	const { page } = alice;
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
	expect((await api(page, 'PUT', `/api/v1/plan/days/${today}`, { mode: 'home', plannedStart: '07:30', plannedEnd: '16:00', plannedBreakMinutes: 45 })).status).toBe(200);
	await page.goto('/');
	await expect(page.getByTestId('today-plan')).toHaveText('Heute geplant: 07:30–16:00 Homeoffice');
	await page.goto(`/calendar?date=${today}`);
	await page.locator(`[data-date="${today}"]:visible`).click();
	await expect(page.getByTestId('panel-plan-times')).toHaveText('Geplant 07:30–16:00, 45 Min. Pause');
	await api(page, 'DELETE', `/api/v1/plan/days/${today}`);
});
