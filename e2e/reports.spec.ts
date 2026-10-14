import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { formatWeekText } from '../src/lib/reports/text.ts';
import { apiCall as api, apiDownload, exportCredentials, loginWithPasskey, newActor as baseActor, registerViaInvite, type Actor } from './helpers';

// Stage-4a (Berichtsheft: learning fields, entries, ISO weeks, text output, sources) against the real Swift backend (C15).
// One serial story on a fifth backend instance (E2E_REPORTS_PORT, own SQLite DB, default storage rules = database backend).
// Alice (bootstrap admin) owns the data, Bob (invited, member) is the "foreign account".
test.describe.configure({ mode: 'serial' });

const BASE = `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 4}`;
test.use({ baseURL: BASE });
const newActor = (browser: Browser, credentials: Parameters<typeof baseActor>[1] = []) => baseActor(browser, credentials, BASE);

// Fixed dates in 2026 (work model Mon-Fri 38:30 from 2026-01-05, Europe/Berlin). ISO week 38 = Mon 14.09. .. Sun 20.09.2026.
const YEAR = 2026;
const WEEK = 38;
const WEEK_URL = `/reports?year=${YEAR}&week=${WEEK}`;
const MONDAY = '2026-09-14';
const WEDNESDAY = '2026-09-16'; // the ADR example day: 08:07-12:00 + 13:00-16:02 -> raw 6:55, evaluated 7:15
const OTHER_WEEK = 40; // Mon 28.09. .. Sun 04.10.2026, used for API-only data
const OTHER_DATE = '2026-09-29';
const W53_DATE = '2027-01-01'; // Friday, belongs to ISO week 53 of 2026

let alice: Actor;
let bob: Actor;
const ids: Record<string, string> = {};

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
});

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

const weekApi = (page: Page, year = YEAR, week = WEEK) => api(page, 'GET', `/api/v1/reports/weeks/${year}/${week}`);
const textApi = async (page: Page, year = YEAR, week = WEEK) => {
	const res = await api(page, 'GET', `/api/v1/reports/weeks/${year}/${week}/text`);
	expect(res.status).toBe(200);
	return res.body as string;
};

// What the backend renders for ISO week 38/2026 after the entries of the story below (see ReportText.render in C15).
const EXPECTED_TEXT = [
	'Berichtsheft KW 38/2026 (14.09.2026 – 20.09.2026)',
	'',
	'Montag, 14.09.2026',
	'Netzwerke einrichten | 1:30 h | Subnetze / berechnet',
	'Betrieb | 2:30 h',
	'',
	'Mittwoch, 16.09.2026',
	'Betrieb | 1:15 h | finale Notiz',
	'',
	'Summe: 5:15 h',
	''
].join('\n');

test('two fresh accounts register via invite', async ({ browser }) => {
	alice = await newActor(browser);
	await registerViaInvite(alice, new URL(process.env.E2E_REPORTS_BOOTSTRAP_LINK!).pathname, 'alice.rep', 'Alice Bericht', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Bericht' })).toBeVisible();
	const invite = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	expect(invite.status).toBe(201);
	bob = await newActor(browser);
	await registerViaInvite(bob, `/invite/${invite.body.token}`, 'bob.rep', 'Bob Bericht', 'Passkey');
	await bob.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(bob.page.getByRole('heading', { name: 'Hallo, Bob Bericht' })).toBeVisible();
});

test('work model 38:30 h and the ADR example day (08:07-12:00 + 13:00-16:02) give 7:15 evaluated', async () => {
	const { page } = alice;
	expect((await api(page, 'POST', '/api/v1/work-models', { validFrom: '2026-01-05', weeklyTargetSeconds: 138600, workdays: [1, 2, 3, 4, 5] })).status).toBe(201);
	// Berlin summer time: 08:07 local = 06:07Z
	for (const [start, end] of [
		['06:07:00Z', '10:00:00Z'],
		['11:00:00Z', '14:02:00Z']
	]) {
		const seg = await api(page, 'POST', '/api/v1/time/segments', { kind: 'work', startedAt: `${WEDNESDAY}T${start}`, endedAt: `${WEDNESDAY}T${end}` });
		expect(seg.status).toBe(201);
	}
	const day = await api(page, 'GET', `/api/v1/time/days/${WEDNESDAY}`);
	expect(day.body).toMatchObject({ rawWorkSeconds: 24900, evaluatedWorkSeconds: 26100 });
});

test('learning fields: create, duplicate (409 learning_field_exists, case-insensitive), edit, list order', async () => {
	const { page } = alice;
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

	// duplicate, ignoring case and surrounding blanks: the code is mapped to the PWA's own German text
	await page.getByTestId('learning-add').click();
	await page.getByTestId('learning-name').fill('  BETRIEB ');
	await page.getByTestId('learning-save').click();
	await expect(page.getByTestId('learning-form-error')).toHaveText('Ein Lernfeld mit diesem Namen gibt es schon.');
	await page.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(page.getByTestId('learning-field')).toHaveCount(2);

	const dup = await api(page, 'POST', '/api/v1/reports/learning-fields', { name: 'betrieb' });
	expect(dup.status).toBe(409);
	expect(dup.body.error.code).toBe('learning_field_exists');

	// edit: change the sort order only (the unchanged name is not a clash with itself)
	const list = await api(page, 'GET', '/api/v1/reports/learning-fields');
	expect(list.body.map((f: any) => f.name)).toEqual(['Netzwerke einrichten', 'Betrieb']); // the form proposes max(sortOrder) + 1: 0, 1
	ids.fieldNet = list.body.find((f: any) => f.name === 'Netzwerke einrichten').id;
	ids.fieldOps = list.body.find((f: any) => f.name === 'Betrieb').id;
	await page.getByRole('button', { name: 'Lernfeld „Betrieb“ bearbeiten' }).click();
	await page.getByTestId('learning-sort').fill('5');
	await page.getByTestId('learning-save').click();
	await expect(page.getByTestId('learning-notice')).toBeVisible();
	const after = await api(page, 'GET', '/api/v1/reports/learning-fields');
	expect(after.body.map((f: any) => [f.name, f.sortOrder])).toEqual([
		['Netzwerke einrichten', 0],
		['Betrieb', 5]
	]);
	// the combobox offers both fields
	await page.goto(WEEK_URL);
	await day(page, MONDAY).getByTestId('add-entry').click();
	const listId = await page.getByTestId('entry-field').getAttribute('list');
	await expect(page.locator(`datalist#${listId} option`)).toHaveCount(2);
	await page.getByRole('button', { name: 'Abbrechen' }).click();
});

test('add entries via the UI: h:mm and decimal "1,5"; totals per day, per learning field and for the week', async () => {
	const { page } = alice;
	await page.goto(WEEK_URL);
	await expect(page.getByTestId('week-heading')).toHaveText(`KW ${WEEK}/${YEAR}`);
	await expect(page.getByTestId('week-range')).toHaveText('14.09.2026 bis 20.09.2026');
	await expect(page.getByTestId('week-total')).toHaveText('0:00 h');

	await day(page, MONDAY).getByTestId('add-entry').click();
	await page.getByTestId('entry-duration').fill('1,5');
	await expect(page.getByTestId('entry-duration-parsed')).toContainText('Gelesen als 1:30 h');
	await page.getByRole('button', { name: 'Abbrechen' }).click();

	await addEntry(page, MONDAY, 'Netzwerke einrichten', '1,5', 'Subnetze\nberechnet');
	await addEntry(page, MONDAY, 'Betrieb', '2:30');
	await addEntry(page, WEDNESDAY, 'Betrieb', '0:30');
	await expect(day(page, MONDAY).getByTestId('entry')).toHaveCount(2);
	await expect(page.getByTestId('week-total')).toHaveText('4:30 h');
	await expect(page.getByTestId('by-field-row')).toHaveText([/Netzwerke einrichten\s*1:30 h/, /Betrieb\s*3:00 h/]);

	const week = await weekApi(page);
	expect(week.status).toBe(200);
	expect(week.body).toMatchObject({ year: YEAR, week: WEEK, startDate: MONDAY, endDate: '2026-09-20', status: 'draft', totalSeconds: 16200, sourceCount: 0 });
	expect(week.body.byLearningField).toEqual([
		{ learningField: 'Netzwerke einrichten', seconds: 5400 },
		{ learningField: 'Betrieb', seconds: 10800 }
	]);
	const first = week.body.entries.find((e: any) => e.notes.startsWith('Subnetze'));
	expect(first).toMatchObject({ date: MONDAY, learningFieldId: ids.fieldNet, learningField: 'Netzwerke einrichten', durationSeconds: 5400, notes: 'Subnetze\nberechnet', version: 1, draft: false });
	ids.entryNet = first.id;
	ids.entryWed = week.body.entries.find((e: any) => e.date === WEDNESDAY).id;
});

test('the tracked-work hint equals the ADR example day (7:15 h) and nothing is copied into entries', async () => {
	const { page } = alice;
	await page.goto(WEEK_URL);
	await expect(page.getByTestId('tracked-hint')).toContainText('Arbeitszeit laut Zeiterfassung: 7:15 h');
	expect((await weekApi(page)).body.trackedWorkSeconds).toBe(26100);
	await page.goto(`/reports?year=${YEAR}&week=${WEEK + 1}`);
	await expect(page.getByTestId('tracked-hint')).toContainText('Arbeitszeit laut Zeiterfassung: 0:00 h');
});

test('renaming a learning field keeps the name snapshot of existing entries', async () => {
	const { page } = alice;
	await page.goto('/settings/learning-fields');
	await page.getByRole('button', { name: 'Lernfeld „Netzwerke einrichten“ bearbeiten' }).click();
	await page.getByTestId('learning-name').fill('Netze');
	await page.getByTestId('learning-save').click();
	await expect(page.getByTestId('learning-list')).toContainText('4 · Netze');
	await page.goto(WEEK_URL);
	await expect(day(page, MONDAY).getByTestId('entry-learning-field').first()).toHaveText('Netzwerke einrichten');
	await expect(page.getByTestId('by-field-row').first()).toContainText('Netzwerke einrichten');
	const entry = (await weekApi(page)).body.entries.find((e: any) => e.id === ids.entryNet);
	expect(entry).toMatchObject({ learningFieldId: ids.fieldNet, learningField: 'Netzwerke einrichten', version: 1 });

	// editing only the notes keeps the snapshot (the form shows the snapshot name, which is no longer a field name)
	await day(page, MONDAY).getByRole('button', { name: 'Eintrag „Netzwerke einrichten“ bearbeiten' }).click();
	const form = day(page, MONDAY).getByTestId('entry-form');
	await form.getByTestId('entry-notes').fill('Subnetze\nberechnet');
	await form.getByTestId('entry-duration').fill('1,5');
	await form.getByTestId('entry-save').click();
	await expect(day(page, MONDAY).getByTestId('entry-form')).toHaveCount(0);
	await expect(day(page, MONDAY).getByTestId('entry-learning-field').first()).toHaveText('Netzwerke einrichten');
	const edited = (await weekApi(page)).body.entries.find((e: any) => e.id === ids.entryNet);
	expect(edited).toMatchObject({ learningField: 'Netzwerke einrichten', version: 2 });

	// an API entry that names the renamed field by id takes the current name
	const viaId = await api(page, 'POST', '/api/v1/reports/entries', { date: OTHER_DATE, learningFieldId: ids.fieldNet, durationSeconds: 600 });
	expect(viaId.status).toBe(201);
	expect(viaId.body.learningField).toBe('Netze');
	expect((await api(page, 'DELETE', `/api/v1/reports/entries/${viaId.body.id}`)).status).toBe(204);
});

test('edit with a conflict (412) from a second device: reload the current version, then keep my input', async ({ browser }) => {
	const first = alice;
	const second = await newActor(browser, await exportCredentials(alice));
	await loginWithPasskey(second.page);
	await first.page.goto(WEEK_URL);
	await second.page.goto(WEEK_URL);
	const open = (page: Page) => day(page, WEDNESDAY).getByRole('button', { name: 'Eintrag „Betrieb“ bearbeiten' });

	// round 1: the other device changes the duration, my save of the notes is refused and offers the current version
	await open(first.page).click();
	await open(second.page).click();
	const other = day(second.page, WEDNESDAY).getByTestId('entry-form');
	await other.getByTestId('entry-duration').fill('1:00');
	await other.getByTestId('entry-save').click();
	await expect(day(second.page, WEDNESDAY).getByTestId('entry-duration-shown')).toHaveText('1:00 h');

	const mine = day(first.page, WEDNESDAY).getByTestId('entry-form');
	await mine.getByTestId('entry-notes').fill('meine Notiz');
	await mine.getByTestId('entry-save').click();
	await expect(mine.getByTestId('entry-stale')).toContainText('Der Eintrag wurde zwischenzeitlich geändert.');
	await expect(mine.getByTestId('entry-stale-current')).toContainText('Betrieb, 1:00 h');
	expect((await weekApi(first.page)).body.entries.find((e: any) => e.id === ids.entryWed)).toMatchObject({ durationSeconds: 3600, notes: '', version: 2 });
	await mine.getByRole('button', { name: 'Aktuelle Fassung laden' }).click();
	await expect(mine.getByTestId('entry-duration')).toHaveValue('1:00');
	await expect(mine.getByTestId('entry-notes')).toHaveValue('');
	await mine.getByTestId('entry-notes').fill('meine Notiz');
	await mine.getByTestId('entry-save').click();
	await expect(day(first.page, WEDNESDAY).getByTestId('entry-notes-shown')).toHaveText('meine Notiz');
	await expect(day(first.page, WEDNESDAY).getByTestId('entry-duration-shown')).toHaveText('1:00 h');

	// round 2: "keep my input" saves on top of the newer version
	await second.page.reload();
	await open(first.page).click();
	await open(second.page).click();
	const other2 = day(second.page, WEDNESDAY).getByTestId('entry-form');
	await other2.getByTestId('entry-duration').fill('1:15');
	await other2.getByTestId('entry-save').click();
	await expect(day(second.page, WEDNESDAY).getByTestId('entry-duration-shown')).toHaveText('1:15 h');
	const mine2 = day(first.page, WEDNESDAY).getByTestId('entry-form');
	await mine2.getByTestId('entry-notes').fill('finale Notiz');
	await mine2.getByTestId('entry-save').click();
	await expect(mine2.getByTestId('entry-stale')).toBeVisible();
	await mine2.getByRole('button', { name: 'Meine Eingabe trotzdem speichern' }).click();
	await expect(day(first.page, WEDNESDAY).getByTestId('entry-form')).toHaveCount(0);
	await expect(day(first.page, WEDNESDAY).getByTestId('entry-notes-shown')).toHaveText('finale Notiz');
	// the other device wrote the 1:15, "keep" re-sends my input (1:00 from the form + notes) on the new version: the form held the old duration
	const wed = (await weekApi(first.page)).body.entries.find((e: any) => e.id === ids.entryWed);
	expect(wed).toMatchObject({ notes: 'finale Notiz', version: 5 });
	// reality check on what "keep mine" sends: my whole form, i.e. the duration I had loaded (1:00), not the other device's 1:15
	expect(wed.durationSeconds).toBe(3600);
	await second.context.close();

	// restore the story's expected duration through the UI
	await open(first.page).click();
	await day(first.page, WEDNESDAY).getByTestId('entry-duration').fill('1:15');
	await day(first.page, WEDNESDAY).getByTestId('entry-save').click();
	await expect(day(first.page, WEDNESDAY).getByTestId('entry-duration-shown')).toHaveText('1:15 h');
});

test('If-Match on the API: missing, malformed and stale values all give 412 stale_version; unknown id 404', async () => {
	const { page } = alice;
	const body = { date: WEDNESDAY, learningField: 'Betrieb', durationSeconds: 4500, notes: 'finale Notiz' };
	const missing = await api(page, 'PUT', `/api/v1/reports/entries/${ids.entryWed}`, body);
	expect(missing.status).toBe(412);
	expect(missing.body.error.code).toBe('stale_version');
	expect((await api(page, 'PUT', `/api/v1/reports/entries/${ids.entryWed}`, body, { 'If-Match': 'abc' })).status).toBe(412);
	expect((await api(page, 'PUT', `/api/v1/reports/entries/${ids.entryWed}`, body, { 'If-Match': '1' })).status).toBe(412);
	const current = (await weekApi(page)).body.entries.find((e: any) => e.id === ids.entryWed);
	const quoted = await api(page, 'PUT', `/api/v1/reports/entries/${ids.entryWed}`, body, { 'If-Match': `"${current.version}"` });
	expect(quoted.status).toBe(200);
	expect(quoted.body.version).toBe(current.version + 1);
	expect((await api(page, 'PUT', `/api/v1/reports/entries/${crypto.randomUUID()}`, body, { 'If-Match': '1' })).status).toBe(404);
});

test('validation: duration over 24 h, notes over 4000 characters, unknown field id, bad date', async () => {
	const { page } = alice;
	const post = (body: object) => api(page, 'POST', '/api/v1/reports/entries', { date: OTHER_DATE, learningField: 'X', ...body });
	expect((await post({ durationSeconds: 86401 })).status).toBe(400);
	expect((await post({ durationSeconds: -1 })).status).toBe(400);
	expect((await post({ notes: 'x'.repeat(4001) })).status).toBe(400);
	expect((await post({ date: '2026-02-30' })).status).toBe(400);
	expect((await post({ learningField: '   ' })).status).toBe(400);
	expect((await post({ learningFieldId: crypto.randomUUID() })).status).toBe(404);
	const ok = await post({ durationSeconds: 86400, notes: 'y'.repeat(4000) });
	expect(ok.status).toBe(201);
	expect((await api(page, 'DELETE', `/api/v1/reports/entries/${ok.body.id}`)).status).toBe(204);
	// UI: values the form refuses
	await page.goto(WEEK_URL);
	await day(page, MONDAY).getByTestId('add-entry').click();
	await page.getByTestId('entry-field').fill('X');
	await page.getByTestId('entry-duration').fill('25');
	await expect(page.getByTestId('entry-duration-parsed')).not.toHaveText('');
	await page.getByTestId('entry-save').click();
	await expect(day(page, MONDAY).getByTestId('entry-form')).toBeVisible();
	await page.getByRole('button', { name: 'Abbrechen' }).click();
});

test('delete an entry asks for confirmation and removes it (API 404 afterwards)', async () => {
	const { page } = alice;
	await page.goto(WEEK_URL);
	await addEntry(page, MONDAY, 'Löschtest', '0:10');
	await expect(day(page, MONDAY).getByTestId('entry')).toHaveCount(3);
	await day(page, MONDAY).getByRole('button', { name: 'Eintrag „Löschtest“ löschen' }).click();
	await expect(page.getByTestId('entry-delete-confirm')).toContainText('wirklich löschen');
	await page.getByTestId('entry-delete-confirm').getByRole('button', { name: 'Abbrechen' }).click();
	await expect(day(page, MONDAY).getByTestId('entry')).toHaveCount(3);
	const doomed = (await weekApi(page)).body.entries.find((e: any) => e.learningField === 'Löschtest').id;
	await day(page, MONDAY).getByRole('button', { name: 'Eintrag „Löschtest“ löschen' }).click();
	await page.getByTestId('entry-delete-yes').click();
	await expect(day(page, MONDAY).getByTestId('entry')).toHaveCount(2);
	expect((await api(page, 'DELETE', `/api/v1/reports/entries/${doomed}`)).status).toBe(404);
	await expect(page.getByTestId('week-total')).toHaveText('5:15 h');
	await expect(page.getByTestId('by-field-row')).toHaveText([/Netzwerke einrichten\s*1:30 h/, /Betrieb\s*3:45 h/]);
});

test('ISO week navigation: 2026 has a week 53, 2027 only 52 (hint), year boundaries', async () => {
	const { page } = alice;
	await page.goto(WEEK_URL);
	await page.getByTestId('week-next').click();
	await expect(page.getByTestId('week-heading')).toHaveText('KW 39/2026');
	await expect(page).toHaveURL(/year=2026&week=39/);
	await page.getByTestId('week-prev').click();
	await expect(page.getByTestId('week-total')).toHaveText('5:15 h');

	// an entry on Friday 01.01.2027 lives in KW 53/2026
	const w53 = await api(page, 'POST', '/api/v1/reports/entries', { date: W53_DATE, learningField: 'Neujahr', durationSeconds: 1800, notes: 'KW 53' });
	expect(w53.status).toBe(201);
	await page.getByTestId('week-year').fill('2026');
	await page.getByTestId('week-number').fill('53');
	await page.getByTestId('week-number').press('Enter');
	await expect(page.getByTestId('week-heading')).toHaveText('KW 53/2026');
	await expect(page.getByTestId('week-range')).toHaveText('28.12.2026 bis 03.01.2027');
	await expect(day(page, W53_DATE).getByTestId('entry')).toHaveCount(1);
	await expect(page.getByTestId('week-total')).toHaveText('0:30 h');
	expect((await weekApi(page, 2026, 53)).body).toMatchObject({ startDate: '2026-12-28', endDate: '2027-01-03', totalSeconds: 1800 });

	await page.getByTestId('week-next').click();
	await expect(page.getByTestId('week-heading')).toHaveText('KW 1/2027');
	await expect(page.getByTestId('week-range')).toHaveText('04.01.2027 bis 10.01.2027');
	await expect(page.getByTestId('week-total')).toHaveText('0:00 h');
	await page.getByTestId('week-prev').click();
	await expect(page.getByTestId('week-heading')).toHaveText('KW 53/2026');

	// KW 53/2027 does not exist: the PWA says so before asking, the backend answers 400 bad_request
	await page.getByTestId('week-year').fill('2027');
	await page.getByTestId('week-number').fill('53');
	await page.getByTestId('week-number').press('Enter');
	await expect(page.getByTestId('week-nav-error')).toHaveText('Dieses Jahr hat nur 52 Kalenderwochen.');
	await expect(page.getByTestId('week-heading')).toHaveText('KW 53/2026');
	const bad = await weekApi(page, 2027, 53);
	expect(bad.status).toBe(400);
	expect(bad.body.error.code).toBe('bad_request');
	expect((await api(page, 'GET', '/api/v1/reports/weeks/2027/53/text')).status).toBe(400);
	expect((await weekApi(page, 2026, 0)).status).toBe(400);
	expect((await weekApi(page, 2026, 54)).status).toBe(400);

	// a deep link to a week that does not exist falls back to the current week instead of breaking
	await page.goto('/reports?year=2027&week=53');
	await expect(page.getByTestId('week-heading')).toHaveText(/^KW \d+\/\d{4}$/);
	await expect(page.getByTestId('week-heading')).not.toHaveText('KW 53/2027');
	expect((await api(page, 'DELETE', `/api/v1/reports/entries/${w53.body.id}`)).status).toBe(204);
});

test('week status toggles, persists, and does not lock editing', async () => {
	const { page } = alice;
	await page.goto(WEEK_URL);
	await expect(page.getByTestId('status-draft')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('status-done').click();
	await expect(page.getByTestId('week-status-badge')).toHaveText('Erledigt');
	expect((await weekApi(page)).body.status).toBe('done');
	await page.reload();
	await expect(page.getByTestId('status-done')).toHaveAttribute('aria-pressed', 'true');
	// editing is still possible in a finished week
	await addEntry(page, MONDAY, 'Zusatz', '0:05');
	await expect(page.getByTestId('status-done')).toHaveAttribute('aria-pressed', 'true');
	await day(page, MONDAY).getByRole('button', { name: 'Eintrag „Zusatz“ löschen' }).click();
	await page.getByTestId('entry-delete-yes').click();
	await expect(day(page, MONDAY).getByTestId('entry')).toHaveCount(2);
	await page.getByTestId('status-draft').click();
	await expect(page.getByTestId('week-status-badge')).toHaveText('Entwurf');
	expect((await api(page, 'PUT', `/api/v1/reports/weeks/${YEAR}/${WEEK}`, { status: 'archived' })).status).toBe(400);
	expect((await weekApi(page)).body.status).toBe('draft');
});

test('copy as text: the clipboard equals GET /text and the backend format (umlaut dash, Summe, no trailing bar, notes on one line)', async () => {
	const { page, context } = alice;
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
	const server = await textApi(page);
	expect(server).toBe(EXPECTED_TEXT);
	expect(server.endsWith('\n')).toBe(true);
	expect(server).not.toContain('Wochensumme');

	await page.goto(WEEK_URL);
	await page.getByTestId('copy-text').click();
	await expect(page.getByTestId('toast')).toHaveText('In die Zwischenablage kopiert');
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	expect(clip).toBe(server);

	// the text endpoint is plain text and never cached
	const headers = await page.evaluate(async (p) => {
		const r = await fetch(p, { credentials: 'include' });
		return { type: r.headers.get('content-type'), cache: r.headers.get('cache-control') };
	}, `/api/v1/reports/weeks/${YEAR}/${WEEK}/text`);
	expect(headers.type).toContain('text/plain');
	expect(headers.cache).toBe('no-store');

	// the PWA's TypeScript port (used by the mock and the golden unit tests) produces the same string from the same data
	const entries = (await weekApi(page)).body.entries;
	expect(entries).toHaveLength(3);
	expect(formatWeekText({ year: YEAR, week: WEEK }, entries)).toBe(server);
});

test('preview dialog shows the same text and copies again; an empty week disables copying', async () => {
	const { page } = alice;
	await page.goto(WEEK_URL);
	await page.getByTestId('copy-preview').click();
	const dialog = page.getByTestId('text-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('text-preview')).toHaveValue(EXPECTED_TEXT);
	await dialog.getByRole('button', { name: 'Schließen' }).click();
	await expect(dialog).toBeHidden();

	await page.goto(`/reports?year=${YEAR}&week=${WEEK + 3}`);
	await expect(page.getByTestId('week-total')).toHaveText('0:00 h');
	await expect(page.getByTestId('copy-text')).toBeDisabled();
	expect(await textApi(page, YEAR, WEEK + 3)).toBe('Berichtsheft KW 41/2026 (05.10.2026 – 11.10.2026)\n\nSumme: 0:00 h\n');
});

test('sources: note and file upload (database backend), download returns the bytes, removal keeps no orphan file', async () => {
	const { page } = alice;
	await page.goto(WEEK_URL);
	const sources = page.getByTestId('sources');
	await sources.getByTestId('source-note').fill('Stichpunkte: Router konfiguriert');
	await sources.getByTestId('source-day').selectOption(WEDNESDAY);
	await sources.getByTestId('source-note-add').click();
	await expect(sources.getByTestId('source')).toHaveCount(1);
	await expect(sources.getByTestId('source').first()).toContainText('Stichpunkte: Router konfiguriert');

	// whole-week file source
	const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n%Ünïcode\n'), randomBytes(2048)]);
	await sources.getByTestId('source-day').selectOption('');
	await sources.getByTestId('source-file').setInputFiles({ name: 'skript.pdf', mimeType: 'application/pdf', buffer: bytes });
	await expect(sources.getByTestId('source-picked')).toContainText('skript.pdf');
	await sources.getByTestId('source-upload').click();
	await expect(sources.getByTestId('source')).toHaveCount(2);
	await expect(page.getByTestId('sources-error')).toHaveCount(0);

	const list = await api(page, 'GET', `/api/v1/reports/sources?year=${YEAR}&week=${WEEK}`);
	expect(list.status).toBe(200);
	expect(list.body).toHaveLength(2);
	const noteSource = list.body.find((s: any) => s.note);
	const fileSource = list.body.find((s: any) => s.fileId);
	expect(noteSource).toMatchObject({ year: YEAR, week: WEEK, date: WEDNESDAY, note: 'Stichpunkte: Router konfiguriert' });
	expect(noteSource.fileId ?? null).toBeNull(); // the backend omits null fields
	expect(fileSource).toMatchObject({ file: { name: 'skript.pdf', size: bytes.length } });
	expect([fileSource.date ?? null, fileSource.note ?? null]).toEqual([null, null]);
	ids.sourceNote = noteSource.id;
	ids.sourceFile = fileSource.id;
	ids.file = fileSource.fileId;
	expect((await weekApi(page)).body.sourceCount).toBe(2);

	// download through the UI (browser download) and through the API: both equal the upload
	const [download] = await Promise.all([page.waitForEvent('download'), sources.getByRole('button', { name: 'Datei „skript.pdf“ herunterladen' }).click()]);
	expect(download.suggestedFilename()).toBe('skript.pdf');
	const fs = await import('node:fs');
	expect(fs.readFileSync((await download.path())!).equals(bytes)).toBe(true);
	const dl = await apiDownload(page, `/api/v1/files/${ids.file}`);
	expect(dl.status).toBe(200);
	expect(dl.body.equals(bytes)).toBe(true);

	// the file is a regular stored file in the database backend
	const meta = await api(page, 'GET', `/api/v1/files/${ids.file}`);
	if (meta.status === 200) expect(meta.body.backend ?? 'db').toBe('db');

	// client side type check
	await sources.getByTestId('source-file').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
	await expect(sources.getByTestId('sources-error')).toContainText('Dieser Dateityp ist nicht erlaubt');

	// persists across reload
	await page.reload();
	await expect(page.getByTestId('sources').getByTestId('source')).toHaveCount(2);

	// removal: the backend keeps the file on DELETE /sources/{id}; the PWA deletes it once afterwards (no orphan, no double delete)
	await page.getByTestId('sources').getByRole('button', { name: 'Quelle „skript.pdf“ entfernen' }).click();
	await expect(page.getByTestId('sources').getByTestId('source')).toHaveCount(1);
	expect((await apiDownload(page, `/api/v1/files/${ids.file}`)).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/files/${ids.file}`)).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/reports/sources/${ids.sourceFile}`)).status).toBe(404);
	expect((await weekApi(page)).body.sourceCount).toBe(1);
});

test('sources API: a file deleted elsewhere leaves a source without file; consistency rules; the note source is removable', async () => {
	const { page } = alice;
	const up = await page.evaluate(async () => {
		const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
		const form = new FormData();
		form.append('file', new Blob(['Notizen aus der Schule'], { type: 'text/plain' }), 'schule.txt');
		const r = await fetch('/api/v1/files', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': session.csrfToken }, body: form });
		return { status: r.status, body: await r.json() };
	});
	expect(up.status).toBe(201);
	const src = await api(page, 'POST', '/api/v1/reports/sources', { year: YEAR, week: WEEK, fileId: up.body.id });
	expect(src.status).toBe(201);
	expect((await api(page, 'DELETE', `/api/v1/files/${up.body.id}`)).status).toBe(204);
	const list = await api(page, 'GET', `/api/v1/reports/sources?year=${YEAR}&week=${WEEK}`);
	const orphan = list.body.find((s: any) => s.id === src.body.id);
	expect(orphan.fileId).toBe(up.body.id);
	expect(orphan.file ?? null).toBeNull();
	await page.goto(WEEK_URL);
	await expect(page.getByTestId('sources')).toContainText('Datei nicht mehr vorhanden');
	await page.getByTestId('source').filter({ hasText: 'Datei nicht mehr vorhanden' }).getByRole('button', { name: /entfernen$/ }).click();
	await expect(page.getByTestId('sources').getByTestId('source')).toHaveCount(1);

	// date outside the week, empty note without file, unknown file
	expect((await api(page, 'POST', '/api/v1/reports/sources', { year: YEAR, week: WEEK, date: '2026-09-21', note: 'x' })).status).toBe(400);
	expect((await api(page, 'POST', '/api/v1/reports/sources', { year: YEAR, week: WEEK, note: '   ' })).status).toBe(400);
	expect((await api(page, 'POST', '/api/v1/reports/sources', { year: YEAR, week: WEEK, fileId: crypto.randomUUID() })).status).toBe(404);
	expect((await api(page, 'POST', '/api/v1/reports/sources', { year: 2027, week: 53, note: 'x' })).status).toBe(400);
	expect((await api(page, 'GET', '/api/v1/reports/sources')).status).toBe(400);
});

test('deleting a learning field keeps the entries with their name snapshot (field reference cleared)', async () => {
	const { page } = alice;
	const mk = await api(page, 'POST', '/api/v1/reports/learning-fields', { name: 'Wegwerf' });
	expect(mk.status).toBe(201);
	const entry = await api(page, 'POST', '/api/v1/reports/entries', { date: OTHER_DATE, learningFieldId: mk.body.id, durationSeconds: 900, notes: 'bleibt' });
	expect(entry.status).toBe(201);
	await page.goto('/settings/learning-fields');
	await page.getByRole('button', { name: 'Lernfeld „Wegwerf“ löschen' }).click();
	await expect(page.getByTestId('learning-delete-confirm')).toContainText('Bestehende Einträge behalten den Namen');
	await page.getByTestId('learning-delete-yes').click();
	await expect(page.getByTestId('learning-list')).not.toContainText('Wegwerf');
	const week = (await weekApi(page, YEAR, OTHER_WEEK)).body;
	expect(week.entries).toHaveLength(1);
	expect(week.entries[0]).toMatchObject({ id: entry.body.id, learningField: 'Wegwerf', notes: 'bleibt' });
	expect(week.entries[0].learningFieldId ?? null).toBeNull(); // cleared (the backend omits null fields)
	await page.goto(`/reports?year=${YEAR}&week=${OTHER_WEEK}`);
	await expect(day(page, OTHER_DATE).getByTestId('entry-learning-field')).toHaveText('Wegwerf');
	// the name is free again
	expect((await api(page, 'POST', '/api/v1/reports/learning-fields', { name: 'wegwerf' })).status).toBe(201);
	ids.entryOther = entry.body.id;
});

test('account separation: Bob cannot read or change Alice\'s report data by direct IDs (404) and sees an empty week', async () => {
	const { page } = bob;
	await page.goto('/');
	const body = { date: WEDNESDAY, learningField: 'Betrieb', durationSeconds: 60 };
	expect((await api(page, 'PUT', `/api/v1/reports/entries/${ids.entryWed}`, body, { 'If-Match': '1' })).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/reports/entries/${ids.entryWed}`)).status).toBe(404);
	expect((await api(page, 'PUT', `/api/v1/reports/learning-fields/${ids.fieldNet}`, { name: 'Gekapert' })).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/reports/learning-fields/${ids.fieldNet}`)).status).toBe(404);
	expect((await api(page, 'DELETE', `/api/v1/reports/sources/${ids.sourceNote}`)).status).toBe(404);
	expect((await api(page, 'POST', '/api/v1/reports/entries', { date: WEDNESDAY, learningFieldId: ids.fieldNet, durationSeconds: 60 })).status).toBe(404);
	expect((await api(page, 'POST', '/api/v1/reports/sources', { year: YEAR, week: WEEK, fileId: ids.file })).status).toBe(404);
	expect((await apiDownload(page, `/api/v1/files/${ids.file}`)).status).toBe(404);

	const week = await weekApi(page);
	expect(week.body).toMatchObject({ entries: [], totalSeconds: 0, byLearningField: [], trackedWorkSeconds: 0, sourceCount: 0, status: 'draft' });
	expect(await textApi(page)).toBe('Berichtsheft KW 38/2026 (14.09.2026 – 20.09.2026)\n\nSumme: 0:00 h\n');
	expect((await api(page, 'GET', `/api/v1/reports/sources?year=${YEAR}&week=${WEEK}`)).body).toEqual([]);
	expect((await api(page, 'GET', '/api/v1/reports/learning-fields')).body).toEqual([]);
	// Bob's own status does not touch Alice's week
	expect((await api(page, 'PUT', `/api/v1/reports/weeks/${YEAR}/${WEEK}`, { status: 'done' })).status).toBe(200);
	expect((await weekApi(alice.page)).body.status).toBe('draft');
	await page.goto(WEEK_URL);
	await expect(page.getByTestId('week-total')).toHaveText('0:00 h');
	await expect(page.locator('body')).not.toContainText('Subnetze');
	await page.goto('/settings/learning-fields');
	await expect(page.getByTestId('learning-field')).toHaveCount(0);

	// Alice's data is intact
	const mine = (await weekApi(alice.page)).body;
	expect(mine.totalSeconds).toBe(18900);
	expect(await textApi(alice.page)).toBe(EXPECTED_TEXT);
});

test('report data is never part of a share: a view with all scopes enabled contains no report fields or texts', async () => {
	const a = alice.page;
	const created = await api(a, 'POST', '/api/v1/shares', { recipientHandle: 'bob.rep', scopes: { plan: true, actual: true, vacation: true } });
	expect(created.status).toBe(201);
	const range = 'from=2026-09-01&to=2026-10-31';
	const view = await api(bob.page, 'GET', `/api/v1/shares/incoming/${created.body.id}/view?${range}`);
	expect(view.status).toBe(200);
	const raw = JSON.stringify(view.body);
	for (const needle of ['finale Notiz', 'Subnetze', 'Netzwerke einrichten', 'Stichpunkte', 'skript', 'Wegwerf', 'bleibt', 'learningField', 'reportEntr', 'sourceCount']) expect(raw).not.toContain(needle);
	expect(Object.keys(view.body)).not.toEqual(expect.arrayContaining(['reports', 'report', 'entries', 'sources']));
	// and the shared UI neither
	await bob.page.goto('/shared');
	await expect(bob.page.locator('body')).not.toContainText('finale Notiz');
	await expect(bob.page.locator('body')).not.toContainText('Berichtsheft KW');
	expect((await api(a, 'DELETE', `/api/v1/shares/${created.body.id}`)).status).toBe(204);
});
