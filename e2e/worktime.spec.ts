import { expect, test, type Browser, type Download, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { apiCall as api, newActor as baseActor, registerViaInvite, type Actor } from './helpers';
import { MAIN_2026, MAIN_2027, XLSX_MIME, book, classify, expectedBalance, expectedSegments, mainWorkbook, row, sheetBalance, type ExpectedSegment } from './worktime-data';

// Package L19: worktime workbook import and export (ADR-0013, contract v0.10.1) against the real Swift backend.
// One serial story on a tenth backend instance (E2E_WORKTIME_PORT, own SQLite DB). Alice (bootstrap admin) imports a SYNTHETIC
// workbook through the wizard, exports it again in the "Arbeitszeit-Tabelle" format and checks the file with an independent
// xlsx reader (exceljs). Bob (invited later) receives the exported file: round trip into a second, fresh account.
test.describe.configure({ mode: 'serial' });

const BASE = `http://localhost:${Number(process.env.E2E_WORKTIME_PORT ?? Number(process.env.E2E_PORT ?? 18090) + 9)}`;
test.use({ baseURL: BASE });
const newActor = (browser: Browser) => baseActor(browser, [], BASE);

let alice: Actor;
let bob: Actor;
const state: { jobId?: string } = {};

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
});

const WINDOW_FROM = '2026-08-03';
const AS_OF = '2026-08-28';
const RANGE_ALL = 'from=2026-07-31T00:00:00Z&to=2027-01-31T00:00:00Z';

/** UTC instant -> Berlin local "YYYY-MM-DD HH:MM" */
function berlin(iso: string): { date: string; time: string } {
	const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
	const get = (type: string) => parts.find((p) => p.type === type)!.value;
	return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

async function segmentsOf(page: Page, range = RANGE_ALL, includeVoided = false) {
	const res = await api(page, 'GET', `/api/v1/time/segments?${range}${includeVoided ? '&includeVoided=true' : ''}`);
	expect(res.status).toBe(200);
	return res.body as any[];
}

function canonical(segments: any[]): ExpectedSegment[] {
	return segments
		.filter((s) => !s.voided)
		.map((s) => {
			const a = berlin(s.startedAt);
			const b = berlin(s.endedAt);
			expect(b.date).toBe(a.date);
			return { date: a.date, kind: s.kind, start: a.time, end: b.time, note: s.note ?? null } as ExpectedSegment;
		})
		.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
}
const sortSegments = (list: ExpectedSegment[]) => [...list].sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));

async function absencesOf(page: Page, from = '2026-07-01', to = '2027-02-28') {
	const res = await api(page, 'GET', `/api/v1/absences?from=${from}&to=${to}`);
	expect(res.status).toBe(200);
	return (res.body as any[]).filter((a) => a.status !== 'cancelled').sort((x, y) => x.startDate.localeCompare(y.startDate));
}

async function customDaysOf(page: Page, year = 2026) {
	const res = await api(page, 'GET', `/api/v1/calendar/holidays?year=${year}`);
	expect(res.status).toBe(200);
	return (res.body as any[]).filter((d) => d.source === 'custom');
}

/** Upload -> (banner) -> profile step. */
async function toProfileStep(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
	await page.goto('/import');
	// generous: the very first hydration of a freshly navigated page occasionally takes long on a busy machine
	await expect(page.getByTestId('step-heading')).toHaveText('Datei', { timeout: 20_000 });
	await page.getByTestId('import-file').setInputFiles(file);
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Blatt und Kopfzeile');
	await expect(page.getByTestId('profile-banner')).toContainText('Arbeitszeit-Tabelle erkannt');
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Arbeitszeit-Tabelle');
}

async function confirmAndCommit(page: Page, ignoreErrors = false) {
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Bestätigen');
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	if (ignoreErrors) await page.getByLabel(/Fehlerzeilen überspringen/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('step-heading')).toHaveText('Ergebnis');
}

test('Alice registers (bootstrap + virtual passkey), creates the 38:30 h model without rounding and the vacation settings', async ({ browser }) => {
	alice = await newActor(browser);
	await registerViaInvite(alice, new URL(process.env.E2E_WORKTIME_BOOTSTRAP_LINK!).pathname, 'alice.wt', 'Alice Worktime', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Worktime' })).toBeVisible({ timeout: 20_000 });
	const model = await api(alice.page, 'POST', '/api/v1/work-models', {
		validFrom: WINDOW_FROM,
		weeklyTargetSeconds: 138_600,
		workdays: [1, 2, 3, 4, 5],
		roundingEnabled: false,
		fixedBreaks: []
	});
	expect(model.status).toBe(201);
	const settings = await api(alice.page, 'PUT', '/api/v1/vacation/settings', { region: 'DE-ST', annualEntitlementHalfDays: 60 });
	expect(settings.status).toBe(200);
	const balance = await api(alice.page, 'GET', '/api/v1/vacation/balance?year=2026');
	expect(balance.body).toMatchObject({ bookedHalfDays: 0, entitlementHalfDays: 60 });
});

test('wizard: upload, banner, profile step with default rules, preview with counts, unmapped remarks, one-click rule, confirm, result', async () => {
	const { page } = alice;
	await toProfileStep(page, mainWorkbook(false));
	await expect(page.getByTestId('wt-rule')).toHaveCount(6);
	await expect(page.getByTestId('wt-pause-split')).toBeChecked();
	await page.getByTestId('wt-validate').click();
	await expect(page.getByTestId('worktime-preview')).toBeVisible();

	const expectedWork = expectedSegments(MAIN_2026.concat(MAIN_2027));
	const count = (action: string) => MAIN_2026.concat(MAIN_2027).filter((r) => classify(r.remark) === action).length;
	await expect(page.getByTestId('wt-count-segments')).toHaveText(String(expectedWork.length));
	await expect(page.getByTestId('wt-count-custom-days')).toHaveText('1'); // 12.8.
	await expect(page.getByTestId('wt-count-skipped-holidays')).toHaveText('2'); // 25.12. and 1.1.2027 are built-in (DE-ST)
	await expect(page.getByTestId('wt-date-system')).toContainText('1900');
	await expect(page.getByTestId('wt-range')).toContainText('03.08.2026');
	await expect(page.getByTestId('wt-range')).toContainText('04.01.2027');
	for (const action of ['vacation', 'sick', 'excused', 'school', 'work', 'holiday']) {
		await expect(page.getByTestId('wt-by-action').locator(`[data-action="${action}"]`)).toContainText(String(action === 'work' ? count('work') : count(action)));
	}
	const sheet = sheetBalance(MAIN_2026.concat(MAIN_2027));
	const hint = await page.getByTestId('wt-balance-value').textContent();
	expect(hint).toMatch(/[+-]\d+:\d{2}/);
	void sheet;
	// three distinct free texts are listed as unmapped
	await expect(page.getByTestId('wt-unmapped-item')).toHaveCount(3);
	await expect(page.getByTestId('wt-unmapped')).toContainText('Arzttermin');
	await page.getByRole('button', { name: 'Regel für „Arzttermin“ anlegen' }).click();
	await expect(page.getByTestId('import-notice')).toContainText('Regel angelegt');
	await expect(page.getByTestId('wt-unmapped-item')).toHaveCount(2);
	await expect(page.getByTestId('wt-count-segments')).toHaveText(String(expectedWork.length));
	await confirmAndCommit(page);
	await expect(page.getByTestId('result-created')).toHaveText(`${expectedWork.length} Einträge angelegt`);
	await expect(page.getByTestId('result-absences')).toContainText('5 Abwesenheiten angelegt');
	await expect(page.getByTestId('result-custom-days')).toContainText('1 eigene Feiertage angelegt');
});

test('REST: segments are minute-normalised with the pause gap, absences are merged across weekends, custom holiday only for the non-built-in date', async () => {
	const { page } = alice;
	const segments = await segmentsOf(page);
	expect(segments.every((s) => s.source === 'import')).toBe(true);
	const rows = MAIN_2026.concat(MAIN_2027);
	// the free-text row rule keeps its note; "Arzttermin" gets the same note as before
	expect(canonical(segments)).toEqual(sortSegments(expectedSegments(rows)));
	// pause gap present on 2026-08-07 (07:59:40-16:30:20 -> 08:00-12:00 + 12:30-16:30)
	const friday = canonical(segments).filter((s) => s.date === '2026-08-07');
	expect(friday.map((s) => `${s.start}-${s.end}`)).toEqual(['08:00-12:00', '12:30-16:30']);
	// no segments for credited days
	for (const date of ['2026-08-03', '2026-08-05', '2026-08-12', '2026-08-20', '2026-12-21']) expect(segments.some((s) => berlin(s.startedAt).date === date)).toBe(false);

	const absences = await absencesOf(page);
	expect(absences.map((a) => [a.kind, a.startDate, a.endDate, a.status])).toEqual([
		['vacation', '2026-08-03', '2026-08-04', 'taken'],
		['sick', '2026-08-05', '2026-08-06', 'taken'],
		['vacation', '2026-08-14', '2026-08-17', 'taken'], // Friday + Monday across the weekend
		['excused', '2026-08-20', '2026-08-20', 'taken'],
		['vacation', '2026-12-21', '2026-12-31', 'approved'] // across a weekend and the built-in holiday 25.12.
	]);
	expect(absences[1].note).toContain('Krank');
	expect(absences.every((a) => a.halfDayStart === false && a.halfDayEnd === false)).toBe(true);

	const custom = await customDaysOf(page);
	expect(custom.map((d) => [d.startDate, d.endDate, d.name])).toEqual([['2026-08-12', '2026-08-12', 'Feiertag']]);
	// built-in holidays were not duplicated as custom days
	expect((await customDaysOf(page, 2027)).length).toBe(0);
});

test('vacation: only vacation consumes days, excused does not; the time account equals the minute-normalised sheet sum', async () => {
	const { page } = alice;
	const balance = await api(page, 'GET', '/api/v1/vacation/balance?year=2026');
	// vacation: 3.-4.8. (2), 14.+17.8. (2), 21.-24.12. + 28.-31.12. (8) = 12 days = 24 half days; sick (2) and excused (1) not counted
	expect(balance.body).toMatchObject({ bookedHalfDays: 24, availableHalfDays: 36, entitlementHalfDays: 60 });

	const account = await api(page, 'GET', `/api/v1/time/account?asOf=${AS_OF}`);
	expect(account.status).toBe(200);
	const rows = MAIN_2026.concat(MAIN_2027);
	const expected = expectedBalance(rows, AS_OF);
	expect(account.body.balanceSeconds).toBe(expected);
	// the sheet's cached E column differs only by the 1-second noise of the synthetic workbook (and the 20 s rounded away)
	const sheet = sheetBalance(rows.filter((r) => r.date <= AS_OF));
	expect(Math.abs(account.body.balanceSeconds - sheet)).toBeLessThanOrEqual(150);
});

test('preview of the same workbook with the 1904 date system detects the system and yields the same data (idempotent re-import: 0 created)', async () => {
	const { page } = alice;
	await toProfileStep(page, mainWorkbook(true));
	await page.getByTestId('wt-validate').click();
	await expect(page.getByTestId('wt-date-system')).toContainText('1904');
	await expect(page.getByTestId('count-valid')).toHaveText('0');
	await expect(page.getByTestId('count-duplicates')).not.toHaveText('0');
	await confirmAndCommit(page);
	await expect(page.getByTestId('result-created')).toHaveText('0 Einträge angelegt');
	await expect(page.getByText('Wahrscheinlich war die Datei schon importiert.')).toBeVisible();
	// unchanged
	expect(canonical(await segmentsOf(page))).toEqual(sortSegments(expectedSegments(MAIN_2026.concat(MAIN_2027))));
	expect((await absencesOf(page)).length).toBe(5);
});


const SEP_ROLLBACK = book(
	{
		sheets: [
			{
				year: 2026,
				days: [
					row('2026-09-07', '8:00', '16:30'),
					row('2026-09-08', '8:00', '16:12', 'Urlaub'),
					row('2026-09-09', '8:00', '16:12', 'Feiertag'),
					row('2026-09-10', '8:00', '16:12', 'Krank'),
					row('2026-09-11', '8:00', '12:00')
				]
			}
		]
	},
	'rollback.xlsx'
);

/** Remembers the id of the import job created by the wizard. */
function trackJob(page: Page) {
	page.on('response', async (response) => {
		if (response.request().method() === 'POST' && /\/api\/v1\/imports$/.test(response.url())) state.jobId = (await response.json()).id;
	});
}

test('rollback through the wizard removes every item of the batch (segments, absences, custom holiday)', async () => {
	const { page } = alice;
	await toProfileStep(page, SEP_ROLLBACK);
	await page.getByTestId('wt-validate').click();
	await expect(page.getByTestId('wt-count-segments')).toHaveText('4'); // 7.9. split at 12:00, 11.9. split in the middle (pause does not fit around 12:00)
	await confirmAndCommit(page);
	await expect(page.getByTestId('result-created')).toHaveText('4 Einträge angelegt');
	await expect(page.getByTestId('result-absences')).toContainText('2 Abwesenheiten angelegt');
	await expect(page.getByTestId('result-custom-days')).toContainText('1 eigene Feiertage angelegt');
	const range = 'from=2026-09-06T00:00:00Z&to=2026-09-13T00:00:00Z';
	expect(canonical(await segmentsOf(page, range)).map((x) => `${x.date} ${x.start}-${x.end}`)).toEqual([
		'2026-09-07 08:00-12:00',
		'2026-09-07 12:30-16:30',
		'2026-09-11 08:00-09:45',
		'2026-09-11 10:15-12:00'
	]);
	expect(await absencesOf(page, '2026-09-01', '2026-09-30')).toHaveLength(2);
	expect(await customDaysOf(page)).toHaveLength(2);

	await page.getByTestId('rollback').click();
	await page.getByTestId('rollback-confirm').click();
	await expect(page.getByTestId('rolled-back')).toBeVisible();
	expect(await segmentsOf(page, range)).toHaveLength(0);
	expect((await segmentsOf(page, range, true)).every((s) => s.voided)).toBe(true);
	expect(await absencesOf(page, '2026-09-01', '2026-09-30')).toHaveLength(0);
	expect((await customDaysOf(page)).map((d) => d.startDate)).toEqual(['2026-08-12']);
	// the main import is untouched
	expect(await absencesOf(page)).toHaveLength(5);
});

const SEP_CONFLICT = book(
	{
		sheets: [
			{
				year: 2026,
				days: [
					row('2026-09-14', '8:00', '16:30'),
					row('2026-09-15', '8:00', '16:12', 'Urlaub'),
					row('2026-09-16', '8:00', '16:12', 'Feiertag (Brücke)'),
					row('2026-09-17', '8:00', '15:00'),
					row('2026-09-18', '8:00', '16:12', 'Krank')
				]
			}
		]
	},
	'konflikt.xlsx'
);

test('rollback conflict: edited segment, absence and deleted custom holiday are listed with their types; nothing is rolled back', async () => {
	const { page } = alice;
	trackJob(page);
	await toProfileStep(page, SEP_CONFLICT);
	await page.getByTestId('wt-validate').click();
	await confirmAndCommit(page);
	await expect(page.getByTestId('result-created')).toHaveText('4 Einträge angelegt');

	const segs = (await segmentsOf(page, 'from=2026-09-13T00:00:00Z&to=2026-09-20T00:00:00Z')).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
	expect(segs).toHaveLength(4);
	const edited = segs[0];
	const patch = await api(page, 'PATCH', `/api/v1/time/segments/${edited.id}`, { reason: 'Nachträglich korrigiert', note: 'geändert' }, { 'If-Match': String(edited.version) });
	expect(patch.status).toBe(200);
	const absences = await absencesOf(page, '2026-09-14', '2026-09-18');
	expect(absences).toHaveLength(2);
	const vac = absences.find((a) => a.kind === 'vacation')!;
	const put = await api(page, 'PUT', `/api/v1/absences/${vac.id}`, { kind: 'vacation', startDate: vac.startDate, endDate: vac.endDate, status: vac.status, note: 'geändert' }, { 'If-Match': String(vac.version) });
	expect(put.status).toBe(200);
	const custom = (await customDaysOf(page)).find((d) => d.startDate === '2026-09-16')!;
	expect(custom.name).toBe('Feiertag (Brücke)');
	expect((await api(page, 'DELETE', `/api/v1/calendar/custom-days/${custom.id}`)).status).toBe(204);

	await page.getByTestId('rollback').click();
	await page.getByTestId('rollback-confirm').click();
	await expect(page.getByTestId('import-error')).toContainText('kann nicht zurückgenommen werden');
	const list = page.getByTestId('rollback-conflicts');
	await expect(list).toContainText('Diese 3 Einträge wurden seit dem Import geändert.');
	await expect(list.locator('[data-conflict-type="segment"]')).toContainText(`Zeitabschnitt ${edited.id}`);
	await expect(list.locator('[data-conflict-type="absence"]')).toContainText(`Abwesenheit ${vac.id}`);
	await expect(list.locator('[data-conflict-type="custom_day"]')).toContainText(`Eigener Feiertag ${custom.id}`);
	await expect(page.getByTestId('rolled-back')).toHaveCount(0);

	// contract v0.10.1: the same answer on the wire carries typed conflictItems next to the UUID list
	const raw = await api(page, 'POST', `/api/v1/imports/${state.jobId}/rollback`);
	expect(raw.status).toBe(409);
	expect(raw.body.error?.code ?? raw.body.code).toBe('rollback_conflict');
	const items = raw.body.conflictItems ?? raw.body.error?.conflictItems;
	expect([...items.map((i: { type: string }) => i.type)].sort()).toEqual(['absence', 'custom_day', 'segment']);
	// nothing changed: the edited segment keeps its note
	const after = await segmentsOf(page, 'from=2026-09-13T00:00:00Z&to=2026-09-20T00:00:00Z');
	expect(after.find((s) => s.id === edited.id)?.note).toBe('geändert');
});

const SEP_PLANNING = book(
	{
		sheets: [
			{
				year: 2026,
				days: [
					row('2026-09-21', '8:00', '16:30'),
					row('2026-09-22', '8:00', '16:12', 'Urlaub'),
					row('2026-09-23', '8:00', '16:12', 'Krank'),
					row('2026-09-24', '8:00', '16:12', 'Feiertag'),
					row('2026-09-25', '8:00', '12:00')
				]
			}
		]
	},
	'planung.xlsx'
);

test('planning module off: absence and holiday rows fail with planning_disabled (German text), work rows still import', async () => {
	const { page } = alice;
	expect((await api(page, 'PUT', '/api/v1/me/modules', { modules: { planning: false } })).status).toBe(200);
	await toProfileStep(page, SEP_PLANNING);
	await page.getByTestId('wt-validate').click();
	await expect(page.getByTestId('count-errors')).toHaveText('3');
	const errors = page.getByTestId('error-table');
	await expect(errors).toContainText('Die Planung ist ausgeschaltet. Abwesenheiten und eigene Feiertage können nicht angelegt werden.');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await expect(page.getByTestId('commit')).toBeDisabled(); // errors must be skipped explicitly
	await page.getByLabel(/Fehlerzeilen überspringen/).check();
	await page.getByTestId('commit').click();
	await expect(page.getByTestId('step-heading')).toHaveText('Ergebnis');
	await expect(page.getByTestId('result-created')).toHaveText('4 Einträge angelegt'); // 21.9. and 25.9., each split by the pause
	await expect(page.getByTestId('result-absences')).toHaveCount(0);
	expect((await segmentsOf(page, 'from=2026-09-20T00:00:00Z&to=2026-09-27T00:00:00Z')).length).toBe(4);

	// back on: the same file now brings the absences and the holiday; the work rows are duplicates
	expect((await api(page, 'PUT', '/api/v1/me/modules', { modules: { planning: true } })).status).toBe(200);
	await toProfileStep(page, SEP_PLANNING);
	await page.getByTestId('wt-validate').click();
	await expect(page.getByTestId('count-errors')).toHaveText('0');
	await confirmAndCommit(page);
	await expect(page.getByTestId('result-absences')).toContainText('2 Abwesenheiten angelegt');
	await expect(page.getByTestId('result-custom-days')).toContainText('1 eigene Feiertage angelegt');
});

test('duplicate dates with conflicting data in two sheets give duplicate_date_conflict with a German text', async () => {
	const { page } = alice;
	// the boundary week 2026-W53 appears in both sheets; here the 2027 sheet carries a different time for 2026-12-28 (belongs to ISO year 2026)
	const conflicting = book({
		sheets: [
			{ year: 2026, days: [row('2026-12-28', '8:00', '16:30')] },
			{ year: 2027, days: [row('2026-12-28', '9:00', '17:30')], writeForeignWeeks: true }
		]
	});
	await toProfileStep(page, conflicting);
	await page.getByTestId('wt-validate').click();
	await expect(page.getByTestId('count-errors')).toHaveText('1');
	await expect(page.getByTestId('error-table')).toContainText('Dasselbe Datum steht in mehreren Blättern mit unterschiedlichen Zeiten oder Bemerkungen.');
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();
	await page.getByLabel(/Ich habe die Vorschau geprüft/).check();
	await expect(page.getByTestId('commit')).toBeDisabled();
});

test('note_too_long (holiday name over 80 characters) is an error row, pause_exceeds_day is only a warning', async () => {
	const { page } = alice;
	const long = book({
		sheets: [
			{
				year: 2026,
				days: [row('2026-10-05', '8:00', '8:20'), row('2026-10-06', '8:00', '16:12', `Feiertag ${'x'.repeat(90)}`), row('2026-10-07', '8:00', '16:12', 'Urlaub')]
			}
		]
	});
	await toProfileStep(page, long);
	await page.getByTestId('wt-validate').click();
	await expect(page.getByTestId('count-errors')).toHaveText('1');
	await expect(page.getByTestId('error-table')).toContainText('Die Notiz ist zu lang.');
	await expect(page.getByTestId('error-table').locator('[data-warning="true"]')).toContainText('Der Tag ist nicht länger als die Pause. Er wird als ein Abschnitt übernommen.');
	// nothing was committed
	expect(await segmentsOf(page, 'from=2026-10-04T00:00:00Z&to=2026-10-11T00:00:00Z')).toHaveLength(0);
});

test('generic wizard switch still works', async () => {
	const { page } = alice;
	await page.goto('/import');
	await page.getByTestId('import-file').setInputFiles(mainWorkbook(false));
	await page.getByRole('button', { name: 'Weiter' }).click();
	await page.getByTestId('profile-switch-generic').click();
	await expect(page.getByTestId('no-header')).toBeVisible();
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('step-heading')).toHaveText('Spalten');
	await page.getByRole('button', { name: 'Zurück' }).click();
	await page.getByTestId('profile-switch-worktime').click();
	await page.getByRole('button', { name: 'Weiter' }).click();
	await expect(page.getByTestId('worktime-step')).toBeVisible();
});


// ---------------------------------------------------------------------------------------------------- export

interface ExportOptions {
	times?: 'evaluated' | 'actual';
	pause?: number;
	start?: string;
	dateSystem?: '1900' | '1904';
}

/** Export page, format "Arbeitszeit-Tabelle", the given options; returns the downloaded file. */
async function exportWorktime(page: Page, from: string, to: string, options: ExportOptions = {}): Promise<{ download: Download; bytes: Buffer }> {
	await page.goto('/export');
	await expect(page.getByRole('heading', { name: 'Export', exact: true })).toBeVisible();
	await page.getByLabel('Von').fill(from);
	await page.getByLabel('Bis').fill(to);
	await page.getByRole('radio', { name: /Arbeitszeit-Tabelle/ }).check();
	await expect(page.getByTestId('export-worktime')).toBeVisible();
	if (options.times === 'actual') await page.getByRole('radio', { name: /^Tatsächlich/ }).check();
	if (options.pause !== undefined) {
		await page.locator('#wt-pause-source').selectOption('override');
		await page.locator('#wt-pause-minutes').fill(String(options.pause));
	}
	if (options.start) await page.locator('#wt-start').fill(options.start);
	if (options.dateSystem) await page.locator('#wt-date-system').selectOption(options.dateSystem);
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportieren' }).click()]);
	const bytes = fs.readFileSync((await download.path())!);
	if (process.env.E2E_DUMP_DIR) fs.writeFileSync(`${process.env.E2E_DUMP_DIR}/${options.times ?? 'evaluated'}-${options.dateSystem ?? '1900'}-${from}.xlsx`, bytes);
	return { download, bytes };
}

// ---- independent reading with exceljs (formula + cached result, number formats, date system) ----

type Value = ExcelJS.CellValue;
interface Cell {
	value: Value;
	numFmt?: string;
}
interface ReadSheet {
	name: string;
	date1904: boolean;
	rowCount: number;
	widths: number[];
	frozenRows: number;
	cell: (ref: string) => Cell;
	/** number of a numeric cell or the cached result of a formula (dates converted back to serial day fractions) */
	num: (ref: string) => number | null;
	formula: (ref: string) => string | null;
	text: (ref: string) => string | null;
}

async function readWorkbook(bytes: Buffer): Promise<{ date1904: boolean; sheets: ReadSheet[] }> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(bytes as unknown as ArrayBuffer);
	const date1904 = Boolean((wb.properties as { date1904?: boolean }).date1904);
	const sheets = wb.worksheets.map((ws): ReadSheet => {
		const cell = (ref: string): Cell => {
			const c = ws.getCell(ref);
			return { value: c.value, numFmt: c.numFmt };
		};
		const scalar = (v: Value): number | string | null => {
			if (v && typeof v === 'object' && 'result' in v) return scalar((v as { result: Value }).result);
			if (v instanceof Date) return v.getTime() / 86_400_000 + 25_569 - (date1904 ? 1462 : 0);
			if (v === undefined || v === null) return null;
			return v as number | string;
		};
		return {
			name: ws.name,
			date1904,
			rowCount: ws.rowCount,
			widths: ws.columns.map((c) => c.width ?? 0),
			frozenRows: (ws.views[0] as { ySplit?: number } | undefined)?.ySplit ?? 0,
			cell,
			num: (ref) => {
				const v = scalar(cell(ref).value);
				return typeof v === 'number' ? v : null;
			},
			formula: (ref) => {
				const v = cell(ref).value;
				return v && typeof v === 'object' && 'formula' in v ? ((v as { formula: string }).formula ?? null) : null;
			},
			text: (ref) => {
				const v = scalar(cell(ref).value);
				return typeof v === 'string' ? v : null;
			}
		};
	});
	return { date1904, sheets };
}

const DAY = 86_400;
const isoOfSerial = (serial: number, date1904: boolean) => new Date(Math.round((serial + (date1904 ? 1462 : 0) - 25_569) * 86_400_000)).toISOString().slice(0, 10);
const secondsOf = (fraction: number | null) => (fraction === null ? null : Math.round(fraction * DAY));
const clock = (fraction: number | null) => (fraction === null ? null : hhmm(Math.round(fraction * 1440)));
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

interface DayRow {
	sheet: string;
	row: number;
	date: string;
	start: string | null;
	end: string | null;
	d: number | null; // seconds
	e: number | null;
	dFormula: boolean;
	eFormula: boolean;
	remark: string | null;
}

/** Row numbers of the week headers (every ninth row from row 6 as long as it holds a KW label). */
function blockHeads(sheet: ReadSheet): number[] {
	const heads: number[] = [];
	for (let r = 6; sheet.text(`A${r}`)?.startsWith('KW'); r += 9) heads.push(r);
	return heads;
}

/** All day rows of all sheets (7 per week block); asserts the block structure on the way. */
function dayRows(sheets: ReadSheet[], date1904: boolean): DayRow[] {
	const out: DayRow[] = [];
	for (const sheet of sheets) {
		for (const head of blockHeads(sheet)) {
			expect(sheet.text(`A${head}`), `${sheet.name} A${head}`).toMatch(/^KW\d{2}( - \d{4})?$/);
			expect([sheet.text(`B${head}`), sheet.text(`C${head}`), sheet.text(`D${head}`), sheet.text(`E${head}`), sheet.text(`F${head}`)]).toEqual(['Beginn', 'Ende', 'Stunden', 'Differenz', 'Bemerkung']);
			for (let i = 1; i <= 7; i++) {
				const r = head + i;
				const serial = sheet.num(`A${r}`);
				expect(serial, `${sheet.name} A${r}`).not.toBeNull();
				out.push({
					sheet: sheet.name,
					row: r,
					date: isoOfSerial(serial!, date1904),
					start: clock(sheet.num(`B${r}`)),
					end: clock(sheet.num(`C${r}`)),
					d: secondsOf(sheet.num(`D${r}`)),
					e: secondsOf(sheet.num(`E${r}`)),
					dFormula: sheet.formula(`D${r}`) !== null,
					eFormula: sheet.formula(`E${r}`) !== null,
					remark: sheet.text(`F${r}`)
				});
			}
			// blank ninth row
			expect(sheet.cell(`A${head + 8}`).value ?? null).toBeNull();
		}
	}
	return out;
}

/** Row layout, formulas with cached numbers and the arithmetic between them for every sheet. */
function assertWorkbookStructure(book: { date1904: boolean; sheets: ReadSheet[] }, expected: { names: string[]; weekly: number; pause: number; date1904: boolean }) {
	expect(book.date1904).toBe(expected.date1904);
	expect(book.sheets.map((s) => s.name)).toEqual(expected.names);
	let carry = 0;
	for (const sheet of book.sheets) {
		const at = (ref: string) => `${sheet.name}!${ref}`;
		expect(sheet.text('A1'), at('A1')).toBe('Wochenarbeitszeit');
		expect(sheet.text('D1')).toBe('Tägl. Arbeitszeit');
		expect(sheet.text('G1')).toBe('Pause');
		expect(sheet.text('A2')).toBe('Summe');
		expect(secondsOf(sheet.num('B1'))).toBe(expected.weekly);
		expect(sheet.formula('B1')).toBeNull(); // typed constant
		expect(sheet.formula('E1')).toBe('B1/5');
		expect(secondsOf(sheet.num('E1'))).toBe(Math.round(expected.weekly / 5));
		expect(secondsOf(sheet.num('H1'))).toBe(expected.pause * 60);
		const rows = dayRows([sheet], book.date1904);
		// consecutive days, Monday first
		for (const [i, r] of rows.entries()) {
			if (i > 0) expect(r.date).toBe(new Date(Date.parse(rows[i - 1].date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10));
			if (i % 7 === 0) expect(new Date(r.date + 'T00:00:00Z').getUTCDay()).toBe(1);
		}
		// per row: D and E arithmetic (cached results of the formulas are what Excel shows before recalculation)
		const e1 = sheet.num('E1')!;
		const h1 = sheet.num('H1')!;
		let sumE = 0;
		for (const r of rows) {
			const D = sheet.num(`D${r.row}`);
			const E = sheet.num(`E${r.row}`);
			const B = sheet.num(`B${r.row}`);
			const C = sheet.num(`C${r.row}`);
			if (B !== null && C !== null && r.dFormula) {
				expect(sheet.formula(`D${r.row}`)).toBe(`C${r.row}-B${r.row}-$H$1`);
				expect(Math.abs(D! - (C - B - h1)) * DAY).toBeLessThan(0.5);
			}
			if (D !== null && r.eFormula) {
				expect(sheet.formula(`E${r.row}`)).toBe(`D${r.row}-$E$1`);
				expect(Math.abs(E! - (D - e1)) * DAY).toBeLessThan(0.5);
			}
			if (r.dFormula) expect(B !== null && C !== null, `D formula only with B and C (${at(`D${r.row}`)})`).toBe(true);
			if (E !== null) sumE += E;
			// number formats
			expect(sheet.cell(`A${r.row}`).numFmt).toMatch(/dddd.*mmmm.*dd.*yyyy/);
			if (B !== null) expect(sheet.cell(`B${r.row}`).numFmt).toBe('h:mm;@');
			if (C !== null) expect(sheet.cell(`C${r.row}`).numFmt).toBe('h:mm;@');
			if (D !== null) expect(sheet.cell(`D${r.row}`).numFmt).toBe('[h]:mm');
			if (E !== null) expect(sheet.cell(`E${r.row}`).numFmt).toBe('[hh]:mm;@');
		}
		// weekly sums: G = SUM(D Mon..Fri) * 24 with cached decimal hours
		for (const head of blockHeads(sheet)) {
			const week = rows.filter((r) => r.row > head && r.row <= head + 5);
			expect(sheet.formula(`G${head}`)).toBe(`SUM(D${head + 1}:D${head + 5})*24`);
			const hours = week.reduce((n, r) => n + (r.d ?? 0), 0) / 3600;
			expect(Math.abs(sheet.num(`G${head}`)! - hours)).toBeLessThan(0.01);
			expect(sheet.cell(`G${head}`).numFmt).toBe('0.0');
		}
		// B2 = SUM(E...) (+ previous sheet), cached
		const sum = secondsOf(sumE)! ;
		const chain = carry;
		const lastDayRow = blockHeads(sheet).at(-1)! + 7;
		const f = sheet.formula('B2')!;
		if (sheet === book.sheets[0]) expect(f).toBe(`SUM(E7:E${lastDayRow})`);
		else expect(f).toBe(`SUM(E7:E${lastDayRow})+'${Number(sheet.name) - 1}'!B2`);
		expect(Math.abs(secondsOf(sheet.num('B2'))! - (sum + chain))).toBeLessThanOrEqual(2);
		carry = secondsOf(sheet.num('B2'))!;
		// header formats, widths, freeze panes
		expect(sheet.cell('B1').numFmt).toBe('[h]:mm');
		expect(sheet.cell('E1').numFmt).toBe('[h]:mm');
		expect(sheet.cell('H1').numFmt).toBe('[h]:mm');
		expect(sheet.cell('B2').numFmt).toBe('[hh]:mm;@');
		expect(sheet.widths.slice(0, 8)).toEqual([30, 15, 15, 15, 9.3, 75, 9.1, 15]);
		expect(sheet.frozenRows).toBe(6);
	}
}

test('export default (bewertet, 1900): file name; structure, formulas with cached values and arithmetic read by exceljs', async () => {
	const { download, bytes } = await exportWorktime(alice.page, WINDOW_FROM, '2026-09-25', { pause: 30 });
	expect(download.suggestedFilename()).toBe('zeitnachweis_2026-08-03_2026-09-25_tabelle.xlsx');
	expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
	const book = await readWorkbook(bytes);
	assertWorkbookStructure(book, { names: ['2026'], weekly: 138_600, pause: 30, date1904: false });
	const rows = dayRows(book.sheets, false);
	const byDate = new Map(rows.map((r) => [r.date, r]));
	// the first block starts in the week of 2026-08-03 and the sheet runs to the week of 31 December (Sunday 2027-01-03)
	expect(rows[0].date).toBe('2026-08-03');
	expect(rows.at(-1)!.date).toBe('2027-01-03');
	expect(byDate.get('2026-08-03')).toMatchObject({ remark: 'Urlaub' });
});

const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const datesBetween = (from: string, to: string) => {
	const out: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
	return out;
};

/** Day evaluations of the app for a range (the endpoint allows 93 days per call). */
async function daysOf(page: Page, from: string, to: string): Promise<Map<string, any>> {
	const out = new Map<string, any>();
	for (let start = from; start <= to; start = addDays(start, 90)) {
		const end = addDays(start, 89) < to ? addDays(start, 89) : to;
		const res = await api(page, 'GET', `/api/v1/time/days?from=${start}&to=${end}`);
		expect(res.status).toBe(200);
		for (const day of res.body as any[]) out.set(day.date, day);
	}
	return out;
}

const KIND_LABEL: Record<string, string> = { vacation: 'Urlaub', sick: 'Krank', excused: 'Freigestellt', holiday: 'Feiertag', school: 'Berufsschule' };

test('export content equals the app: every day row (B/C/D/E) matches the day evaluation, credited days carry standard times and kind labels, B2 equals the time account', async () => {
	const { page } = alice;
	const from = WINDOW_FROM;
	const to = '2026-09-25';
	const { bytes } = await exportWorktime(page, from, to, { pause: 30 });
	const book = await readWorkbook(bytes);
	const rows = dayRows(book.sheets, false).filter((r) => r.date >= from && r.date <= to);
	expect(rows).toHaveLength(datesBetween(from, to).length);
	const days = await daysOf(page, from, to);
	let credited = 0;
	let worked = 0;
	for (const r of rows) {
		const day = days.get(r.date)!;
		// the cached difference column is the app's daily delta; days without entries and without target stay empty
		expect(r.e ?? 0, `E ${r.date}`).toBe(day.deltaSeconds);
		const weekday = new Date(r.date + 'T00:00:00Z').getUTCDay() % 6 !== 0;
		const creditDay = weekday && (day.markSource === 'holiday' || day.markSource === 'absence');
		if (creditDay && !day.segments?.length) {
			// vacation / sick / excused / holiday: standard times 08:00 + target + pause, D by formula, difference 0, label in the remark
			credited++;
			expect(r.start, r.date).toBe('08:00');
			expect(r.end, r.date).toBe('15:42'.replace('15:42', hhmm(8 * 60 + 7 * 60 + 42 + 30)));
			expect(r.dFormula && r.eFormula, r.date).toBe(true);
			expect(r.e).toBe(0);
			expect(r.remark ?? '', r.date).toMatch(/^(Urlaub|Krank|Freigestellt|Feiertag)/);
		} else if (day.segments?.length) {
			worked++;
			const segs = (day.segments as any[]).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
			if (segs.some((s) => s.kind === 'school')) {
				expect(r.remark ?? '', r.date).toMatch(/^Berufsschule/);
				expect(r.start).toBe('08:00');
				expect(r.end).toBe('16:12');
			} else {
				expect(r.start, r.date).toBe(berlin(segs[0].startedAt).time);
				expect(r.end, r.date).toBe(berlin(segs.at(-1).endedAt).time);
				expect(r.d, r.date).toBe(day.evaluatedWorkSeconds);
			}
		} else {
			expect(r.start ?? r.end ?? r.d, r.date).toBeNull();
		}
	}
	expect(credited).toBeGreaterThanOrEqual(10);
	expect(worked).toBeGreaterThanOrEqual(15);
	// specific rows: kind labels per day (vacation Aug 3 and 17, sick, excused, school, holiday)
	const label = new Map(rows.map((r) => [r.date, r.remark ?? '']));
	expect(label.get('2026-08-03')).toMatch(/^Urlaub/);
	expect(label.get('2026-08-17')).toMatch(/^Urlaub/);
	expect(label.get('2026-08-06')).toMatch(/^Krank/);
	expect(label.get('2026-08-20')).toMatch(/^Freigestellt/);
	expect(label.get('2026-08-10')).toMatch(/^Berufsschule/);
	expect(label.get('2026-08-12')).toMatch(/^Feiertag/);
	expect(label.get('2026-08-13')).toContain('Arzttermin');
	// a Saturday inside an absence carries the label but no times and no difference
	expect(label.get('2026-08-15')).toMatch(/^Urlaub/);
	expect(rows.find((r) => r.date === '2026-08-15')).toMatchObject({ start: null, end: null, d: null, e: null });
	expect(label.get('2026-08-22') ?? '').toBe(''); // a plain weekend stays empty
	void KIND_LABEL;

	// B2 is the account balance of the same range
	const sheet = book.sheets[0];
	const account = await api(page, 'GET', `/api/v1/time/account?asOf=${to}`);
	expect(account.status).toBe(200);
	expect(Math.abs(secondsOf(sheet.num('B2'))! - account.body.balanceSeconds)).toBeLessThanOrEqual(2);
});

test('export options: standard start and own pause change the credited times and H1; "Pause abweichend" marks days whose gap differs', async () => {
	const { page } = alice;
	const { bytes } = await exportWorktime(page, WINDOW_FROM, '2026-08-14', { pause: 45, start: '07:30' });
	const book = await readWorkbook(bytes);
	assertWorkbookStructure(book, { names: ['2026'], weekly: 138_600, pause: 45, date1904: false });
	const rows = dayRows(book.sheets, false);
	const vacation = rows.find((r) => r.date === '2026-08-03')!;
	expect([vacation.start, vacation.end]).toEqual(['07:30', hhmm(7 * 60 + 30 + 7 * 60 + 42 + 45)]);
	// 07:59:40-16:30:20 -> 08:00-16:30 with a 30 minute gap: the sheet pause is 45, so D is a value and the remark says so
	const friday = rows.find((r) => r.date === '2026-08-07')!;
	expect(friday.dFormula).toBe(false);
	expect(friday.d).toBe(8 * 3600);
	expect(friday.remark).toContain('Pause abweichend');
	// the default pause (automatic) is the sum of the model's fixed breaks: none -> 0:00
	const auto = await readWorkbook((await exportWorktime(page, WINDOW_FROM, '2026-08-07')).bytes);
	expect(secondsOf(auto.sheets[0].num('H1'))).toBe(0);
});

test('export 1904 across two years: two sheets, boundary week in both (data only in the ISO-year sheet), B2 chain over the sheets, date system flag', async () => {
	const { page } = alice;
	const { bytes } = await exportWorktime(page, WINDOW_FROM, '2027-01-31', { pause: 30, dateSystem: '1904' });
	const book = await readWorkbook(bytes);
	assertWorkbookStructure(book, { names: ['2026', '2027'], weekly: 138_600, pause: 30, date1904: true });
	const [s2026, s2027] = book.sheets;
	const heads2026 = blockHeads(s2026);
	const heads2027 = blockHeads(s2027);
	expect(s2026.text(`A${heads2026.at(-1)}`)).toBe('KW53');
	expect(s2027.text(`A${heads2027[0]}`)).toBe('KW53 - 2026');
	expect(s2027.text('A' + heads2027[1])).toBe('KW01');
	// the foreign boundary week in the 2027 sheet only shows the dates
	for (let r = heads2027[0] + 1; r <= heads2027[0] + 7; r++) {
		expect(s2027.num(`A${r}`)).not.toBeNull();
		for (const col of ['B', 'C', 'D', 'E', 'F']) expect(s2027.cell(`${col}${r}`).value ?? null, `2027 ${col}${r}`).toBeNull();
	}
	const rows2026 = dayRows([s2026], true);
	const rows2027 = dayRows([s2027], true);
	const byDate = new Map(rows2026.map((r) => [r.date, r]));
	expect(byDate.get('2026-12-28')).toMatchObject({ start: '08:00', end: '16:12', remark: expect.stringMatching(/^Urlaub/) });
	expect(byDate.get('2026-12-25')).toMatchObject({ remark: expect.stringMatching(/^Feiertag/) });
	expect(byDate.get('2027-01-01')).toMatchObject({ remark: expect.stringMatching(/^Feiertag/) });
	expect(rows2027.find((r) => r.date === '2027-01-04')).toMatchObject({ start: '08:00', end: '16:30' });
	// chain: B2(2027) = SUM of the 2027 sheet's E + B2(2026)
	const sum2027 = rows2027.reduce((n, r) => n + (r.e ?? 0), 0);
	expect(Math.abs(secondsOf(s2027.num('B2'))! - (sum2027 + secondsOf(s2026.num('B2'))!))).toBeLessThanOrEqual(2);
	expect(s2027.formula('B2')).toContain("'2026'!B2");
});

test('round trip: Bob (fresh account, same model) imports Alice\'s exported file with the default rules; the canonical data is identical', async ({ browser }) => {
	const { page } = alice;
	const invite = await api(page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	expect(invite.status).toBe(201);
	bob = await newActor(browser);
	await registerViaInvite(bob, `/invite/${invite.body.token}`, 'bob.wt', 'Bob Worktime', 'Passkey');
	await bob.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(bob.page.getByRole('heading', { name: 'Hallo, Bob Worktime' })).toBeVisible();
	expect((await api(bob.page, 'POST', '/api/v1/work-models', { validFrom: WINDOW_FROM, weeklyTargetSeconds: 138_600, workdays: [1, 2, 3, 4, 5], roundingEnabled: false, fixedBreaks: [] })).status).toBe(201);
	expect((await api(bob.page, 'PUT', '/api/v1/vacation/settings', { region: 'DE-ST', annualEntitlementHalfDays: 60 })).status).toBe(200);

	const RANGE_FROM = WINDOW_FROM;
	const RANGE_TO = '2027-01-31';
	const exported = await exportWorktime(page, RANGE_FROM, RANGE_TO, { pause: 30 });
	await toProfileStep(bob.page, { name: 'export.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: exported.bytes });
	await bob.page.getByTestId('wt-validate').click();
	await expect(bob.page.getByTestId('count-errors')).toHaveText('0');
	await expect(bob.page.getByTestId('wt-date-system')).toContainText('1900');
	await confirmAndCommit(bob.page);

	const strip = (list: ExpectedSegment[]) => list.map(({ note, ...rest }) => rest);
	const aliceSegs = canonical(await segmentsOf(page));
	const bobSegs = canonical(await segmentsOf(bob.page));
	expect(strip(bobSegs)).toEqual(strip(aliceSegs));
	expect(bobSegs.length).toBeGreaterThan(30);
	// notes of free-text days survive (work notes are exported as remarks)
	for (const [date, text] of [
		['2026-08-13', 'Arzttermin'],
		['2026-08-21', 'Kundentermin'],
		['2026-08-26', 'Homeoffice']
	]) {
		expect(bobSegs.filter((s) => s.date === date).every((s) => s.note === text)).toBe(true);
	}
	const abs = (list: any[]) => list.map((a) => [a.kind, a.startDate, a.endDate, a.status, a.halfDayStart, a.halfDayEnd]);
	expect(abs(await absencesOf(bob.page))).toEqual(abs(await absencesOf(page)));
	const customs = async (p: Page) => [...(await customDaysOf(p, 2026)), ...(await customDaysOf(p, 2027))].map((d) => [d.startDate, d.endDate, d.name]);
	expect(await customs(bob.page)).toEqual(await customs(page));
	expect((await api(bob.page, 'GET', '/api/v1/vacation/balance?year=2026')).body).toMatchObject({ bookedHalfDays: (await api(page, 'GET', '/api/v1/vacation/balance?year=2026')).body.bookedHalfDays });
	const asOf = '2026-09-25';
	expect((await api(bob.page, 'GET', `/api/v1/time/account?asOf=${asOf}`)).body.balanceSeconds).toBe((await api(page, 'GET', `/api/v1/time/account?asOf=${asOf}`)).body.balanceSeconds);

	// Bob's own export has the same day rows (times, differences, kind labels) as Alice's
	const again = await readWorkbook((await exportWorktime(bob.page, RANGE_FROM, RANGE_TO, { pause: 30 })).bytes);
	const first = await readWorkbook(exported.bytes);
	const compact = (b: { sheets: ReadSheet[] }) => dayRows(b.sheets, false).map((r) => [r.sheet, r.date, r.start, r.end, r.d, r.e, (r.remark ?? '').split(/[;\n]/)[0]]);
	expect(compact(again)).toEqual(compact(first));
	// importing the same file again into Bob's account is idempotent
	await toProfileStep(bob.page, { name: 'export.xlsx', mimeType: XLSX_MIME, buffer: exported.bytes });
	await bob.page.getByTestId('wt-validate').click();
	await expect(bob.page.getByTestId('count-valid')).toHaveText('0');
	await confirmAndCommit(bob.page);
	await expect(bob.page.getByTestId('result-created')).toHaveText('0 Einträge angelegt');
});

test('the 1904 export of the round-trip range is read back as 1904 and is idempotent in Bob\'s account', async () => {
	const exported = await exportWorktime(alice.page, WINDOW_FROM, '2027-01-31', { pause: 30, dateSystem: '1904' });
	await toProfileStep(bob.page, { name: 'export-1904.xlsx', mimeType: XLSX_MIME, buffer: exported.bytes });
	await bob.page.getByTestId('wt-validate').click();
	await expect(bob.page.getByTestId('wt-date-system')).toContainText('1904');
	await expect(bob.page.getByTestId('count-valid')).toHaveText('0');
	await confirmAndCommit(bob.page);
	await expect(bob.page.getByTestId('result-created')).toHaveText('0 Einträge angelegt');
});

test('rounding model: "bewertet" exports the rounded start/end, "tatsächlich" the raw ones, arithmetic stays consistent', async () => {
	const { page } = alice;
	const model = await api(page, 'POST', '/api/v1/work-models', {
		validFrom: '2026-09-28',
		weeklyTargetSeconds: 138_600,
		workdays: [1, 2, 3, 4, 5],
		roundingEnabled: true,
		roundingMinutes: 15,
		fixedBreaks: []
	});
	expect(model.status).toBe(201);
	// Wednesday 2026-09-30, Berlin summer time: 08:07-16:02 local
	const seg = await api(page, 'POST', '/api/v1/time/segments', { kind: 'work', startedAt: '2026-09-30T06:07:00Z', endedAt: '2026-09-30T14:02:00Z' });
	expect(seg.status).toBe(201);
	const day = (await api(page, 'GET', '/api/v1/time/days/2026-09-30')).body;
	expect(day).toMatchObject({ rawWorkSeconds: 28_500, evaluatedWorkSeconds: 29_700 });

	for (const times of ['evaluated', 'actual'] as const) {
		const { bytes } = await exportWorktime(page, '2026-09-28', '2026-10-02', { times });
		const book = await readWorkbook(bytes);
		assertWorkbookStructure(book, { names: ['2026'], weekly: 138_600, pause: 0, date1904: false });
		const wed = dayRows(book.sheets, false).find((r) => r.date === '2026-09-30')!;
		// the app's evaluation (D, E) is the same in both modes; only the printed start/end differ
		expect(wed.d).toBe(29_700);
		expect(wed.e).toBe(29_700 - 27_720);
		if (times === 'evaluated') expect([wed.start, wed.end, wed.dFormula]).toEqual(['08:00', '16:15', true]);
		else expect([wed.start, wed.end]).toEqual(['08:07', '16:02']);
		// B2 still equals the account of the range for both modes
		const sheet = book.sheets[0];
		const account = await api(page, 'GET', '/api/v1/time/account?asOf=2026-10-02');
		const fromV1 = (await api(page, 'GET', '/api/v1/time/account?asOf=2026-09-27')).body.balanceSeconds;
		expect(Math.abs(secondsOf(sheet.num('B2'))! - (account.body.balanceSeconds - fromV1))).toBeLessThanOrEqual(2);
	}
});

void MAIN_2027;
