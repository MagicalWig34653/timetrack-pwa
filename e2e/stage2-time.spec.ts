import { expect, test, type Page } from '@playwright/test';
import { exportCredentials, loginWithPasskey, newActor as baseActor, registerViaInvite, type Actor } from './helpers';
import type { Browser } from '@playwright/test';

// Stage-2 time tracking against the real Swift backend. One serial story on a fresh SQLite DB with its own accounts.
// Runs against its own backend instance/database (global-setup, E2E_TIME_BASE_URL); Bob is invited by Alice (admin).
test.describe.configure({ mode: 'serial' });

const BASE = `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 1}`;
test.use({ baseURL: BASE });
const newActor = (browser: Browser, credentials: Record<string, unknown>[] = []) => baseActor(browser, credentials, BASE);
const german = (date: string) => date.split('-').reverse().join('.');

/** Same-origin API call with session cookie + CSRF, optional extra headers (If-Match). */
async function api(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	return page.evaluate(
		async ({ method, path, body, headers }) => {
			const h: Record<string, string> = { Accept: 'application/json', ...headers };
			if (method !== 'GET') {
				const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
				h['X-CSRF-Token'] = session.csrfToken;
				if (body !== undefined) h['Content-Type'] = 'application/json';
			}
			const res = await fetch(path, { method, credentials: 'include', headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
			const text = await res.text();
			let parsed: any = null;
			try {
				parsed = text ? JSON.parse(text) : null;
			} catch {
				parsed = text;
			}
			return { status: res.status, body: parsed };
		},
		{ method, path, body, headers }
	);
}

/** Date `daysAgo` days before today (UTC calendar date; the machine clock decides). */
function pastDate(daysAgo: number): string {
	return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

// Fixed dates for the ADR example (Wednesday, long past the model start), derived days for automation.
const EXAMPLE_DAY = '2026-09-16';
const CORRECTION_DAY = '2026-09-17';
const VOID_DAY = '2026-09-18';
const MARK_DAY = '2026-09-14';
const AUTO_DAY = pastDate(5);
const SUGGEST_DAY = pastDate(4);
const REJECT_DAY = pastDate(3);

let alice: Actor;
let bob: Actor;
let aliceCredentials: Record<string, unknown>[] = [];
const ids: Record<string, string> = {};
let deviceToken = '';

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
});

test('two fresh accounts register via invite', async ({ browser }) => {
	alice = await newActor(browser);
	await registerViaInvite(alice, new URL(process.env.E2E_TIME_BOOTSTRAP_LINK!).pathname, 'alice.time', 'Alice Zeit', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Zeit' })).toBeVisible();
	aliceCredentials = await exportCredentials(alice);

	const invite = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	expect(invite.status).toBe(201);
	bob = await newActor(browser);
	await registerViaInvite(bob, `/invite/${invite.body.token}`, 'bob.time', 'Bob Zeit', 'Passkey');
	await bob.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(bob.page.getByRole('heading', { name: 'Hallo, Bob Zeit' })).toBeVisible();
});

test('work model: 38:30 h Mon-Fri, rounding on, fixed break', async () => {
	const { page } = alice;
	await page.goto('/settings/work-model');
	await expect(page.getByText('Noch kein Arbeitsmodell angelegt')).toBeVisible();
	await page.getByRole('button', { name: 'Neue Version anlegen' }).click();
	await page.getByLabel('Gültig ab').fill('2026-01-05');
	await page.getByLabel('Wochen-Soll').fill('38:30');
	await expect(page.getByText('Ergibt 7:42 pro Arbeitstag.')).toBeVisible();
	await expect(page.getByLabel('Rundung zugunsten der Arbeitszeit')).toBeChecked();
	await page.getByRole('button', { name: 'Feste Pause hinzufügen' }).click();
	await page.getByLabel('Pause von').fill('12:00');
	await page.getByLabel('Pause bis').fill('12:30');
	await page.getByRole('button', { name: 'Version anlegen' }).click();
	await expect(page.getByText('Neue Version angelegt.')).toBeVisible();
	const list = page.getByTestId('model-list');
	await expect(list).toContainText('38:30');
	await expect(list).toContainText('7:42');
	await expect(list).toContainText('Mo, Di, Mi, Do, Fr');

	const res = await api(page, 'GET', '/api/v1/work-models');
	expect(res.status).toBe(200);
	expect(res.body).toHaveLength(1);
	expect(res.body[0]).toMatchObject({ weeklyTargetSeconds: 138600, workdays: [1, 2, 3, 4, 5], roundingEnabled: true, roundingMinutes: 15 });
	expect(res.body[0].fixedBreaks).toEqual([{ start: '12:00', end: '12:30' }]);
});

test('places with automation modes', async () => {
	const { page } = alice;
	await page.goto('/settings/places');
	for (const [name, mode, key] of [
		['Büro', 'direct', 'office'],
		['Berufsschule', 'suggest', 'school'],
		['Zuhause', 'off', 'home']
	] as const) {
		await page.getByRole('button', { name: 'Neuer Ort' }).click();
		await page.getByLabel('Name', { exact: true }).fill(name);
		await page.getByLabel('Automatik').selectOption(mode);
		await page.getByRole('button', { name: 'Speichern' }).click();
		await expect(page.getByText('Ort angelegt.')).toBeVisible();
		await expect(page.getByTestId('place-list')).toContainText(name);
		void key;
	}
	const res = await api(page, 'GET', '/api/v1/places');
	expect(res.status).toBe(200);
	const byName = Object.fromEntries(res.body.map((p: any) => [p.name, p]));
	expect(byName['Büro'].automationMode).toBe('direct');
	expect(byName['Berufsschule'].automationMode).toBe('suggest');
	expect(byName['Zuhause'].automationMode).toBe('off');
	expect(byName['Büro'].confirmAfterSeconds).toBe(300);
	ids.office = byName['Büro'].id;
	ids.school = byName['Berufsschule'].id;
	ids.home = byName['Zuhause'].id;
	// The place id is shown for Shortcuts.
	await expect(page.getByTestId('place-list')).toContainText(ids.office);
});

test('timer: double click start is idempotent, stop ends the running segment', async () => {
	const { page } = alice;
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Zeiterfassung' })).toBeVisible();
	await page.getByRole('button', { name: 'Start' }).dblclick();
	await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible();
	await expect(page.getByTestId('elapsed')).toBeVisible();
	await expect(page.getByTestId('segment-row')).toHaveCount(1);
	const today = await api(page, 'GET', '/api/v1/time/timer');
	expect(today.body).toMatchObject({ endedAt: null, source: 'timer' });
	const running = await api(page, 'GET', `/api/v1/time/segments?from=${pastDate(1)}T00:00:00Z&to=${pastDate(-2)}T00:00:00Z`);
	expect(running.body.filter((s: any) => s.endedAt === null && !s.voided)).toHaveLength(1);
	await page.waitForTimeout(1200);
	await page.getByRole('button', { name: 'Stopp' }).click();
	await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
	const after = await api(page, 'GET', `/api/v1/time/segments?from=${pastDate(1)}T00:00:00Z&to=${pastDate(-2)}T00:00:00Z`);
	expect(after.body.filter((s: any) => !s.voided)).toHaveLength(1);
	expect(after.body[0].endedAt).not.toBeNull();
	// Remove the timer segment so later account/day assertions only see the scripted data.
	const del = await api(page, 'DELETE', `/api/v1/time/segments/${after.body[0].id}?reason=${encodeURIComponent('Test-Timer')}`);
	expect(del.status).toBeLessThan(300);
});

async function addSegment(page: Page, start: string, end: string) {
	await page.getByRole('button', { name: 'Eintrag manuell ergänzen' }).click();
	await page.getByLabel('Beginn').fill(start);
	await page.getByLabel('Ende', { exact: true }).fill(end);
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByText('Eintrag ergänzt.')).toBeVisible();
}

test('manual segments reproduce the ADR example: raw 6:55, evaluated 7:15, gap unchanged', async () => {
	const { page } = alice;
	await page.goto(`/time/${EXAMPLE_DAY}`);
	await expect(page.getByRole('heading', { name: new RegExp(german(EXAMPLE_DAY).replace(/\./g, '\\.')) })).toBeVisible();
	await addSegment(page, `${EXAMPLE_DAY}T08:07`, `${EXAMPLE_DAY}T12:00`);
	await addSegment(page, `${EXAMPLE_DAY}T13:00`, `${EXAMPLE_DAY}T16:02`);
	await expect(page.getByTestId('segment-row')).toHaveCount(2);
	await expect(page.getByTestId('day-target')).toHaveText('7:42');
	await expect(page.getByTestId('day-raw')).toHaveText('6:55');
	await expect(page.getByTestId('day-evaluated')).toHaveText('7:15');
	await expect(page.getByTestId('day-rounding')).toContainText('0:20');
	await expect(page.getByTestId('gap-row')).toContainText('Pause 1:00');
	await expect(page.getByTestId('day-delta')).toHaveText('-0:27');

	const day = await api(page, 'GET', `/api/v1/time/days/${EXAMPLE_DAY}`);
	expect(day.body).toMatchObject({ rawWorkSeconds: 24900, evaluatedWorkSeconds: 26100, startAdjustSeconds: 420, endAdjustSeconds: 780, breakDeductionSeconds: 0 });
	// Inner segment boundaries stay exactly as entered (no rounding of inner edges).
	const list = await api(page, 'GET', `/api/v1/time/segments?from=${EXAMPLE_DAY}T00:00:00Z&to=${EXAMPLE_DAY}T23:59:59Z`);
	const times = list.body.map((s: any) => [s.startedAt, s.endedAt]).sort();
	expect(times).toEqual([
		[`${EXAMPLE_DAY}T06:07:00Z`, `${EXAMPLE_DAY}T10:00:00Z`],
		[`${EXAMPLE_DAY}T11:00:00Z`, `${EXAMPLE_DAY}T14:02:00Z`]
	]);

	// Dashboard-independent week view shows the day with its evaluated value.
	await page.goto(`/time?week=2026-09-14`);
	await expect(page.getByTestId('week-list')).toContainText('7:15');
});

test('correction needs a reason, keeps the raw time, and a second context gets a 412 conflict', async ({ browser }) => {
	const { page } = alice;
	await page.goto(`/time/${CORRECTION_DAY}`);
	await addSegment(page, `${CORRECTION_DAY}T08:00`, `${CORRECTION_DAY}T12:00`);
	await page.getByTestId('segment-row').first().getByRole('button', { name: 'Korrigieren' }).click();
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByText('Bitte gib einen Grund an.')).toBeVisible();
	await page.getByLabel(/^Grund/).fill('Beginn war 07:50');
	await page.getByLabel('Beginn').fill(`${CORRECTION_DAY}T07:50`);
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByText('Eintrag korrigiert.')).toBeVisible();
	await expect(page.getByText('1 Korrektur(en)')).toBeVisible();
	await expect(page.getByTestId('segment-row').first()).toContainText('Roh: 08:00');
	await expect(page.getByTestId('day-raw')).toHaveText('4:10');

	// Second browser context with the same passkey: opens the form, A changes the segment, B saves -> 412.
	const other = await newActor(browser, aliceCredentials);
	await loginWithPasskey(other.page);
	await other.page.goto(`/time/${CORRECTION_DAY}`);
	await other.page.getByTestId('segment-row').first().getByRole('button', { name: 'Korrigieren' }).click();
	await other.page.getByLabel('Notiz (optional)').fill('vom anderen Gerät');
	await other.page.getByLabel(/^Grund/).fill('Notiz ergänzt');

	await page.getByTestId('segment-row').first().getByRole('button', { name: 'Korrigieren' }).click();
	await page.getByLabel('Notiz (optional)').fill('erste Änderung');
	await page.getByLabel(/^Grund/).fill('Notiz erste');
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(page.getByText('Eintrag korrigiert.')).toBeVisible();

	await other.page.getByRole('button', { name: 'Speichern' }).first().click();
	await expect(other.page.getByTestId('stale-conflict')).toContainText('zwischenzeitlich geändert');
	await other.page.getByRole('button', { name: 'Auf neue Version anwenden' }).click();
	await expect(other.page.getByText('Eintrag korrigiert.')).toBeVisible();
	// The server tracks the signature counter: later logins must continue from the used credential state.
	aliceCredentials = await exportCredentials(other);
	await other.context.close();

	const list = await api(page, 'GET', `/api/v1/time/segments?from=${CORRECTION_DAY}T00:00:00Z&to=${CORRECTION_DAY}T23:59:59Z`);
	expect(list.body).toHaveLength(1);
	expect(list.body[0]).toMatchObject({ note: 'vom anderen Gerät', revisions: 3, version: 4 });
	expect(list.body[0].rawStartedAt).toBe(`${CORRECTION_DAY}T06:00:00Z`);
});

test('void keeps the segment with reason but it no longer counts', async () => {
	const { page } = alice;
	await page.goto(`/time/${VOID_DAY}`);
	await addSegment(page, `${VOID_DAY}T08:00`, `${VOID_DAY}T09:00`);
	await expect(page.getByTestId('day-raw')).toHaveText('1:00');
	await page.getByRole('button', { name: 'Stornieren' }).first().click();
	await page.getByRole('button', { name: 'Stornieren' }).last().click();
	await expect(page.getByText('Bitte gib einen Grund an.')).toBeVisible();
	await page.getByLabel(/^Grund/).fill('Irrtum');
	await page.getByRole('button', { name: 'Stornieren' }).last().click();
	await expect(page.getByText('Eintrag storniert.')).toBeVisible();
	await expect(page.getByTestId('day-raw')).toHaveText('0:00');
	await expect(page.getByTestId('segment-row').first()).toContainText('Storniert');
});

test('day mark: vacation sets the target to 0:00 and is persisted', async () => {
	const { page } = alice;
	await page.goto(`/time/${MARK_DAY}`);
	await expect(page.getByTestId('day-target')).toHaveText('7:42');
	await page.getByLabel('Markierung').selectOption('vacation');
	await page.getByLabel('Notiz zum Tag').fill('Urlaubstag');
	await page.getByRole('button', { name: 'Speichern' }).last().click();
	await expect(page.getByText('Tageseinstellungen gespeichert.')).toBeVisible();
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await page.reload();
	await expect(page.getByLabel('Markierung')).toHaveValue('vacation');
	await expect(page.getByTestId('day-target')).toHaveText('0:00');
	await expect(page.getByLabel('Notiz zum Tag')).toHaveValue('Urlaubstag');
});

test('account time: opening balance and correction', async () => {
	const { page } = alice;
	await page.goto('/settings/account-time');
	await page.getByLabel('Startdatum').fill('2026-09-14');
	await page.getByLabel('Anfangsstand (h:mm)').fill('2:30');
	await page.getByRole('button', { name: 'Anfangsstand speichern' }).click();
	await expect(page.getByText('Anfangsstand gespeichert.')).toBeVisible();
	await expect(page.getByTestId('account-opening')).toHaveText('+2:30');
	await page.getByLabel('Korrektur (h:mm)').fill('-0:45');
	await page.getByLabel('Grund').last().fill('Zeitausgleich');
	await page.getByRole('button', { name: 'Korrektur speichern' }).click();
	await expect(page.getByText('Korrektur gespeichert.')).toBeVisible();
	await expect(page.getByTestId('account-corrections')).toHaveText('-0:45');
	const acc = await api(page, 'GET', '/api/v1/time/account');
	expect(acc.body).toMatchObject({ openingSeconds: 9000, adjustmentSeconds: -2700, accountStart: '2026-09-14' });
	// Only one opening balance may exist.
	const again = await api(page, 'POST', '/api/v1/time/account/adjustments', { kind: 'opening', date: '2026-09-14', seconds: 60, reason: 'x' });
	expect(again.status).toBe(409);
});

test('device token is shown once; automation events book or suggest per place mode', async ({ playwright }) => {
	const { page } = alice;
	await page.goto('/settings/devices');
	await page.getByLabel('Name', { exact: true }).fill('iPhone Kurzbefehle');
	await page.getByRole('button', { name: 'Token erzeugen' }).click();
	deviceToken = (await page.getByTestId('token-value').textContent())!.trim();
	expect(deviceToken.length).toBeGreaterThan(20);
	await expect(page.getByTestId('shortcut-sample')).toContainText('/api/v1/automation/events');
	await page.getByRole('button', { name: 'Ich habe es gespeichert' }).click();
	await expect(page.getByTestId('token-list')).toContainText('iPhone Kurzbefehle');
	await expect(page.getByTestId('token-list')).not.toContainText(deviceToken);
	await page.reload();
	await expect(page.getByTestId('token-list')).toContainText('noch nie genutzt');
	await expect(page.locator('body')).not.toContainText(deviceToken);

	const anon = await playwright.request.newContext({ baseURL: BASE });
	const post = async (body: Record<string, unknown>, token = deviceToken) =>
		anon.post('/api/v1/automation/events', { headers: { Authorization: `Bearer ${token}` }, data: body });
	// The backend orders events per device and place by occurredAt, so each scenario uses its own deviceId.
	const ev = (type: string, placeId: string, at: string, deviceId = 'iphone-e2e') => ({ eventId: crypto.randomUUID(), deviceId, type, placeId, occurredAt: at });

	// Wrong token -> 401.
	expect((await post(ev('arrival', ids.office, `${AUTO_DAY}T06:00:00Z`), 'ttd_wrong')).status()).toBe(401);

	// direct: arrival alone records, confirmed presence books (back-dated to arrival).
	const arrival = ev('arrival', ids.office, `${AUTO_DAY}T06:00:00Z`);
	const r1 = await post(arrival);
	expect(r1.status()).toBe(200);
	const r1Body = await r1.json();
	console.log(`[info] direct arrival -> ${JSON.stringify(r1Body)}`);
	expect(['recorded', 'ignored']).toContain(r1Body.result);
	expect((await api(page, 'GET', `/api/v1/time/segments?from=${AUTO_DAY}T00:00:00Z&to=${AUTO_DAY}T23:59:59Z`)).body).toHaveLength(0);

	const confirm = ev('presence_confirmed', ids.office, `${AUTO_DAY}T06:06:00Z`);
	const r2 = await (await post(confirm)).json();
	expect(r2.result).toBe('booked');
	expect(r2.segmentId).toBeTruthy();
	// Retry of the same event returns the first result unchanged and books nothing new.
	const r2b = await (await post(confirm)).json();
	expect(r2b).toMatchObject({ result: r2.result, segmentId: r2.segmentId });
	let segs = await api(page, 'GET', `/api/v1/time/segments?from=${AUTO_DAY}T00:00:00Z&to=${AUTO_DAY}T23:59:59Z`);
	expect(segs.body).toHaveLength(1);
	expect(segs.body[0]).toMatchObject({ source: 'automation', startedAt: `${AUTO_DAY}T06:00:00Z`, endedAt: null });
	const depart = await (await post(ev('departure', ids.office, `${AUTO_DAY}T10:00:00Z`))).json();
	console.log(`[info] direct departure -> ${JSON.stringify(depart)}`);
	expect(['booked', 'ignored', 'recorded']).toContain(depart.result);
	segs = await api(page, 'GET', `/api/v1/time/segments?from=${AUTO_DAY}T00:00:00Z&to=${AUTO_DAY}T23:59:59Z`);
	expect(segs.body[0].endedAt).toBe(`${AUTO_DAY}T10:00:00Z`);

	// Pass-by protection: confirmation before confirmAfterSeconds books nothing.
	await post(ev('arrival', ids.office, `${pastDate(6)}T06:00:00Z`, 'iphone-passby'));
	const passC = await (await post(ev('presence_confirmed', ids.office, `${pastDate(6)}T06:01:00Z`, 'iphone-passby'))).json();
	console.log(`[info] early confirmation -> ${JSON.stringify(passC)}`);
	expect(passC.result).toBe('ignored');
	expect(
		(await api(page, 'GET', `/api/v1/time/segments?from=${pastDate(6)}T00:00:00Z&to=${pastDate(6)}T23:59:59Z`)).body
	).toHaveLength(0);

	// suggest: confirmed presence creates a suggestion, no segment.
	await post(ev('arrival', ids.school, `${SUGGEST_DAY}T06:00:00Z`));
	const s1 = await (await post(ev('presence_confirmed', ids.school, `${SUGGEST_DAY}T06:06:00Z`))).json();
	expect(s1.result).toBe('suggested');
	expect(s1.suggestionId).toBeTruthy();
	ids.suggestAccept = s1.suggestionId;
	await post(ev('arrival', ids.school, `${REJECT_DAY}T06:00:00Z`));
	const s2 = await (await post(ev('presence_confirmed', ids.school, `${REJECT_DAY}T06:06:00Z`))).json();
	expect(s2.result).toBe('suggested');
	ids.suggestReject = s2.suggestionId;

	// off: only recorded.
	await post(ev('arrival', ids.home, `${pastDate(7)}T17:00:00Z`));
	const off = await (await post(ev('presence_confirmed', ids.home, `${pastDate(7)}T17:06:00Z`))).json();
	expect(off.result).toBe('recorded');
	console.log(`[info] off place confirmation -> ${JSON.stringify(off)}`);

	// Device tokens may not be used on session endpoints.
	expect((await anon.get('/api/v1/time/segments?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z', { headers: { Authorization: `Bearer ${deviceToken}` } })).status()).toBeGreaterThanOrEqual(400);
	await anon.dispose();

	// The booked segment is visible in the day view, marked as automation-sourced and the token shows as used.
	await page.goto(`/time/${AUTO_DAY}`);
	await expect(page.getByTestId('segment-row')).toHaveCount(1);
	await page.goto('/settings/devices');
	await expect(page.getByTestId('token-list')).toContainText('zuletzt genutzt');
});

test('automation edge cases: pass-by, cancel, late confirmation after an early one', async ({ playwright }) => {
	const { page } = alice;
	const anon = await playwright.request.newContext({ baseURL: BASE });
	const send = async (type: string, at: string, deviceId: string, placeId = ids.office) => {
		const res = await anon.post('/api/v1/automation/events', {
			headers: { Authorization: `Bearer ${deviceToken}` },
			data: { eventId: crypto.randomUUID(), deviceId, type, placeId, occurredAt: at }
		});
		expect(res.status()).toBe(200);
		return res.json();
	};
	const count = async (day: string) =>
		(await api(page, 'GET', `/api/v1/time/segments?from=${day}T00:00:00Z&to=${day}T23:59:59Z`)).body.filter((s: any) => !s.voided).length;

	// Pass-by: arrival, then departure without confirmation -> nothing booked.
	const passBy = pastDate(9);
	await send('arrival', `${passBy}T07:00:00Z`, 'dev-passby');
	const passByDeparture = await send('departure', `${passBy}T07:02:00Z`, 'dev-passby');
	console.log(`[info] pass-by departure -> ${JSON.stringify(passByDeparture)}`);
	expect(await count(passBy)).toBe(0);

	// Cancel after arrival -> nothing booked.
	const cancelDay = pastDate(10);
	await send('arrival', `${cancelDay}T07:00:00Z`, 'dev-cancel');
	const cancelled = await send('cancel', `${cancelDay}T07:01:00Z`, 'dev-cancel');
	console.log(`[info] cancel -> ${JSON.stringify(cancelled)}`);
	expect(await count(cancelDay)).toBe(0);

	// Early confirmation (needs_review), then a valid one for the same arrival.
	// Latest day of the story: a booked segment is open-ended until its departure and would overlap later data.
	const lateDay = pastDate(2);
	await send('arrival', `${lateDay}T07:00:00Z`, 'dev-late');
	const early = await send('presence_confirmed', `${lateDay}T07:01:00Z`, 'dev-late');
	const valid = await send('presence_confirmed', `${lateDay}T07:06:00Z`, 'dev-late');
	expect(early.result).toBe('ignored');
	expect(valid.result).toBe('booked');
	expect(await count(lateDay)).toBe(1);
	expect((await send('departure', `${lateDay}T09:00:00Z`, 'dev-late')).result).toBe('booked');
	// Shortcuts sends local time with an offset (ISO 8601 "+02:00"); a non-UUID eventId is rejected.
	const offset = await send('arrival', `${pastDate(1)}T08:00:00+02:00`, 'dev-offset', ids.home);
	expect(offset.result).toBe('recorded');
	const badId = await anon.post('/api/v1/automation/events', {
		headers: { Authorization: `Bearer ${deviceToken}` },
		data: { eventId: 'not-a-uuid', deviceId: 'dev-offset', type: 'arrival', placeId: ids.home, occurredAt: `${pastDate(1)}T09:00:00Z` }
	});
	console.log(`[info] non-UUID eventId -> ${badId.status()}`);
	expect(badId.status()).toBe(400);
	await anon.dispose();
});

test('suggestions inbox: accept (with times) and reject', async () => {
	const { page } = alice;
	await page.goto('/suggestions');
	await expect(page.getByTestId('suggestion-list').getByRole('listitem')).toHaveCount(2);
	await expect(page.getByTestId('suggestion-list')).toContainText('Berufsschule');
	// Nothing is booked before the user decides.
	const before = await api(page, 'GET', `/api/v1/time/segments?from=${SUGGEST_DAY}T00:00:00Z&to=${SUGGEST_DAY}T23:59:59Z`);
	expect(before.body).toHaveLength(0);

	const items = page.getByTestId('suggestion-list').getByRole('listitem');
	// Reject first (older suggestion REJECT_DAY is newer; pick by date text).
	const rejectItem = items.filter({ hasText: german(REJECT_DAY) }).first();
	await rejectItem.getByRole('button', { name: 'Verwerfen' }).click();
	await expect(page.getByText('Vorschlag verworfen.')).toBeVisible();
	await expect(items).toHaveCount(1);

	await page.getByRole('button', { name: 'Annehmen' }).click();
	await page.getByLabel('Ende', { exact: true }).fill(`${SUGGEST_DAY}T14:00`);
	await page.getByRole('button', { name: 'Übernehmen' }).click();
	await expect(page.getByText('Vorschlag übernommen.')).toBeVisible();
	await expect(page.getByTestId('suggestions-empty')).toBeVisible();

	const segs = await api(page, 'GET', `/api/v1/time/segments?from=${SUGGEST_DAY}T00:00:00Z&to=${SUGGEST_DAY}T23:59:59Z`);
	expect(segs.body).toHaveLength(1);
	expect(segs.body[0]).toMatchObject({ source: 'suggestion', startedAt: `${SUGGEST_DAY}T06:00:00Z` });
	// Deciding twice conflicts (UI maps suggestion_resolved to a German message and reloads the list).
	const twice = await api(page, 'POST', `/api/v1/time/suggestions/${ids.suggestAccept}/accept`, { endedAt: `${SUGGEST_DAY}T13:00:00Z` });
	expect(twice.status).toBe(409);
	expect(twice.body.error.code).toBe('suggestion_resolved');
	const none = await api(page, 'GET', `/api/v1/time/segments?from=${REJECT_DAY}T00:00:00Z&to=${REJECT_DAY}T23:59:59Z`);
	expect(none.body).toHaveLength(0);
});

test('second user cannot see or touch the first user\'s data (404)', async () => {
	const { page } = bob;
	await page.goto('/');
	for (const path of ['segments?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z']) {
		const res = await api(page, 'GET', `/api/v1/time/${path}`);
		expect(res.status).toBe(200);
		expect(res.body).toEqual([]);
	}
	expect((await api(page, 'GET', '/api/v1/places')).body).toEqual([]);
	expect((await api(page, 'GET', '/api/v1/work-models')).body).toEqual([]);
	expect((await api(page, 'GET', '/api/v1/time/suggestions')).body).toEqual([]);
	expect((await api(page, 'GET', '/api/v1/me/device-tokens')).body).toEqual([]);
	const day = await api(page, 'GET', `/api/v1/time/days/${EXAMPLE_DAY}`);
	expect(day.body.rawWorkSeconds).toBe(0);

	const aliceSegs = await api(alice.page, 'GET', `/api/v1/time/segments?from=${EXAMPLE_DAY}T00:00:00Z&to=${EXAMPLE_DAY}T23:59:59Z`);
	const segId = aliceSegs.body[0].id;
	const tokens = await api(alice.page, 'GET', '/api/v1/me/device-tokens');
	const models = await api(alice.page, 'GET', '/api/v1/work-models');
	const place = { name: 'x', kind: 'other', automationMode: 'off' };

	const attempts = [
		await api(page, 'PATCH', `/api/v1/time/segments/${segId}`, { reason: 'x', note: 'x' }, { 'If-Match': '1' }),
		await api(page, 'DELETE', `/api/v1/time/segments/${segId}?reason=x`),
		await api(page, 'PUT', `/api/v1/places/${ids.office}`, place),
		await api(page, 'DELETE', `/api/v1/places/${ids.office}`),
		await api(page, 'DELETE', `/api/v1/me/device-tokens/${tokens.body[0].id}`),
		await api(page, 'PATCH', `/api/v1/work-models/${models.body[0].id}`, { validTo: '2026-12-31' }),
		await api(page, 'POST', `/api/v1/time/suggestions/${ids.suggestAccept}/accept`, {}),
		await api(page, 'POST', `/api/v1/time/suggestions/${ids.suggestAccept}/reject`, {}),
		await api(page, 'POST', '/api/v1/time/segments', { kind: 'work', startedAt: '2026-09-20T06:00:00Z', endedAt: '2026-09-20T07:00:00Z', placeId: ids.office })
	];
	for (const [i, res] of attempts.entries()) expect(res.status, `attempt ${i}`).toBe(404);
	// Alice's data is untouched.
	const check = await api(alice.page, 'GET', `/api/v1/time/segments?from=${EXAMPLE_DAY}T00:00:00Z&to=${EXAMPLE_DAY}T23:59:59Z`);
	expect(check.body).toHaveLength(2);
});

test('phone width: no horizontal scroll on the time pages with real data', async ({ browser }) => {
	const phone = await newActor(browser, aliceCredentials);
	await phone.page.setViewportSize({ width: 390, height: 844 });
	await loginWithPasskey(phone.page);
	for (const route of ['/', '/time', `/time/${EXAMPLE_DAY}`, '/settings/work-model', '/settings/places', '/settings/account-time', '/settings/devices', '/suggestions']) {
		await phone.page.goto(route);
		await phone.page.waitForLoadState('networkidle');
		const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, route).toBeLessThanOrEqual(0);
	}
	await phone.context.close();
});
