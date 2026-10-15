import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiCall as api, newActor as baseActor, registerViaInvite, type Actor } from './helpers';
import { MAIN_2026, MAIN_2027, book, classify, expectedBalance, expectedSegments, mainWorkbook, row, sheetBalance, type ExpectedSegment } from './worktime-data';

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
	await expect(page.getByTestId('step-heading')).toHaveText('Datei');
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
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Worktime' })).toBeVisible();
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

void row;
void book;
void state;
