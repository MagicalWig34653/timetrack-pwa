import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import type { AbsenceInput } from '#lib/api/types.js';
import { createMockFetch } from './fetch.ts';
import { createPlanningMock } from './planning.ts';

// Wednesday 14.10.2026 11:30 Berlin. Seed: taken 07.-09.09. (3 days), approved 26.-30.10. (5 days), planned 23.-25.11. (2,5 days).
const NOW = Date.parse('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

async function login(options?: Parameters<typeof createMockFetch>[0]) {
	mock = createMockFetch({ now: () => NOW, ...options });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	const opts = await api.loginOptions();
	await api.loginVerify(opts.challengeId, { id: 'mock-login' });
}
beforeEach(() => login());
afterEach(() => vi.unstubAllGlobals());

const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: ApiError) => `${e.status}:${e.code}`);
const vacation = (startDate: string, endDate: string, extra: Partial<AbsenceInput> = {}): AbsenceInput => ({ kind: 'vacation', startDate, endDate, status: 'planned', ...extra });

describe('mock vacation balance', () => {
	it('computes the seeded balance from integer half days', async () => {
		expect(await api.getVacationBalance(2026)).toMatchObject({
			entitlementHalfDays: 60,
			carryOverHalfDays: 0,
			bookedHalfDays: 16,
			plannedHalfDays: 5,
			availableHalfDays: 44,
			availableAfterPlannedHalfDays: 39,
			snapshotDate: null
		});
	});

	it('counts only workdays that are no holidays (Karfreitag 03.04. and Ostermontag 06.04.2026)', async () => {
		const absence = await api.createAbsence(vacation('2026-04-01', '2026-04-07'));
		expect(absence.countedHalfDays).toBe(6); // Wed, Thu, Tue
	});

	it('halves first/last day and single-day flags', async () => {
		expect((await api.createAbsence(vacation('2026-06-01', '2026-06-02', { halfDayStart: true }))).countedHalfDays).toBe(3);
		expect((await api.createAbsence(vacation('2026-06-03', '2026-06-05', { halfDayEnd: true }))).countedHalfDays).toBe(5);
		expect((await api.createAbsence(vacation('2026-06-08', '2026-06-08', { halfDayStart: true, halfDayEnd: true }))).countedHalfDays).toBe(1);
		expect((await api.createAbsence(vacation('2026-06-13', '2026-06-14'))).countedHalfDays).toBe(0); // weekend
	});

	it('counts approved -> taken exactly once and keeps planned separate', async () => {
		const [approved] = (await api.listAbsences('2026-10-26', '2026-10-30'));
		const before = await api.getVacationBalance(2026);
		const taken = await api.updateAbsence(approved.id, { ...approved, status: 'taken' }, approved.version);
		expect(taken.version).toBe(approved.version + 1);
		const after = await api.getVacationBalance(2026);
		expect(after.bookedHalfDays).toBe(before.bookedHalfDays);
		expect(after.availableHalfDays).toBe(before.availableHalfDays);
		const cancelled = await api.updateAbsence(approved.id, { ...taken, status: 'cancelled' }, taken.version);
		expect((await api.getVacationBalance(2026)).bookedHalfDays).toBe(before.bookedHalfDays - 10);
		expect(cancelled.status).toBe('cancelled');
	});

	it('does not count sick or other absences against vacation', async () => {
		await api.createAbsence({ kind: 'sick', startDate: '2026-03-02', endDate: '2026-03-04', status: 'taken' });
		await api.createAbsence({ kind: 'other', startDate: '2026-03-09', endDate: '2026-03-09', status: 'approved' });
		expect((await api.getVacationBalance(2026)).bookedHalfDays).toBe(16);
	});

	it('a snapshot replaces entitlement, carry-over and history before it (not additive)', async () => {
		const result = await api.createVacationSnapshot({ date: '2026-10-01', remainingHalfDays: 20 });
		expect(result).toMatchObject({ snapshotDate: '2026-10-01', entitlementHalfDays: 0, carryOverHalfDays: 0, bookedHalfDays: 10 });
		expect(result.availableHalfDays).toBe(10); // 20 - 10 booked since the snapshot; the September vacation lies before it
		const adjusted = await api.createVacationAdjustment({ date: '2026-10-05', halfDays: 4, reason: 'Gutschrift' });
		expect(adjusted.availableHalfDays).toBe(14);
		const before = await api.createVacationAdjustment({ date: '2026-02-01', halfDays: 2, reason: 'vor Stichtag' });
		expect(before.availableHalfDays).toBe(14);
		expect((await api.getVacationBalance(2027)).snapshotDate).toBeNull();
	});

	it('adds manual carry-over and adjustments when no snapshot exists', async () => {
		await api.putVacationSettings({ region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: { '2026': 7, '2025': 3 }, carryOverExpiry: '03-31' });
		const result = await api.createVacationAdjustment({ date: '2026-05-01', halfDays: -3, reason: 'Abzug' });
		expect(result).toMatchObject({ carryOverHalfDays: 7, adjustmentHalfDays: -3, availableHalfDays: 60 + 7 - 3 - 16 });
	});

	it('rejects invalid input', async () => {
		expect(await code(api.putVacationSettings({ region: 'x', annualEntitlementHalfDays: 60 }))).toBe('400:bad_request');
		expect(await code(api.putVacationSettings({ region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverExpiry: '13-45' }))).toBe('400:bad_request');
		expect(await code(api.createVacationAdjustment({ date: '2026-05-01', halfDays: 0, reason: 'x' }))).toBe('400:bad_request');
		expect(await code(api.createVacationAdjustment({ date: '2026-05-01', halfDays: 1, reason: '  ' }))).toBe('400:bad_request');
		expect(await code(api.createVacationSnapshot({ date: '2026-05-01', remainingHalfDays: -1 }))).toBe('400:bad_request');
	});

	it('reports unconfigured settings as 200 defaults with configured=false and entitlement 0', async () => {
		vi.unstubAllGlobals();
		await login({ seedPlanning: false });
		expect(await api.getVacationSettings()).toMatchObject({ configured: false, region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: {} });
		expect((await api.getVacationBalance(2026)).entitlementHalfDays).toBe(0);
	});
});

describe('mock absences', () => {
	it('rejects overlaps of any kind with absence_overlap, allows adjacent and cancelled ones', async () => {
		expect(await code(api.createAbsence(vacation('2026-10-30', '2026-11-02')))).toBe('409:absence_overlap');
		expect(await code(api.createAbsence({ kind: 'sick', startDate: '2026-10-28', endDate: '2026-10-28', status: 'taken' }))).toBe('409:absence_overlap');
		expect(await code(api.createAbsence(vacation('2026-10-31', '2026-11-02')))).toBe('ok');
		expect(await code(api.createAbsence(vacation('2026-10-28', '2026-10-28', { status: 'cancelled' })))).toBe('ok');
	});

	it('checks overlap on update ignoring the entry itself', async () => {
		const [approved] = await api.listAbsences('2026-10-26', '2026-10-30');
		expect(await code(api.updateAbsence(approved.id, { ...approved, endDate: '2026-10-31' }, approved.version))).toBe('ok');
		const other = await api.createAbsence(vacation('2026-12-01', '2026-12-02'));
		expect(await code(api.updateAbsence(other.id, { ...other, startDate: '2026-10-30' }, other.version))).toBe('409:absence_overlap');
	});

	it('requires a matching If-Match version', async () => {
		const [approved] = await api.listAbsences('2026-10-26', '2026-10-30');
		await api.updateAbsence(approved.id, { ...approved, note: 'neu' }, approved.version);
		expect(await code(api.updateAbsence(approved.id, { ...approved, note: 'alt' }, approved.version))).toBe('412:stale_version');
	});

	it('validates documents of sick absences and deletes entries', async () => {
		const sick = await api.createAbsence({
			kind: 'sick', startDate: '2026-02-02', endDate: '2026-02-03', status: 'taken', documentStatus: 'submitted',
			documentSubmittedOn: '2026-02-04', documentReferenceStart: '2026-02-02', documentReferenceEnd: '2026-02-03'
		});
		expect(sick).toMatchObject({ documentStatus: 'submitted', documentSubmittedOn: '2026-02-04', countedHalfDays: 0 });
		expect(await code(api.createAbsence({ kind: 'sick', startDate: '2026-02-10', endDate: '2026-02-09', status: 'taken' }))).toBe('400:bad_request');
		await api.deleteAbsence(sick.id);
		expect(await code(api.deleteAbsence(sick.id))).toBe('404:not_found');
	});
});

describe('mock calendar and plan', () => {
	it('lists built-in holidays of the account region plus own entries', async () => {
		const holidays = await api.listHolidays(2026);
		expect(holidays.find((h) => h.name === 'Karfreitag')?.startDate).toBe('2026-04-03');
		expect(holidays.some((h) => h.kind === 'school_holiday' && h.source === 'custom')).toBe(true);
		const custom = await api.createCustomDay({ kind: 'holiday', startDate: '2026-12-24', endDate: '2026-12-24', name: 'Heiligabend' });
		expect(custom.id).toBeTruthy();
		// a custom holiday reduces the counted days
		expect((await api.createAbsence(vacation('2026-12-23', '2026-12-24'))).countedHalfDays).toBe(2);
		await api.deleteCustomDay(custom.id!);
		expect(await code(api.deleteCustomDay(custom.id!))).toBe('404:not_found');
	});

	it('stores plan days per date', async () => {
		await api.putPlanDay('2026-11-02', { mode: 'customer', note: 'Kunde A' });
		expect((await api.listPlanDays('2026-11-01', '2026-11-07'))).toEqual([{ date: '2026-11-02', mode: 'customer', placeId: null, note: 'Kunde A', plannedStart: null, plannedEnd: null, plannedBreakMinutes: null, plannedSeconds: null, blocks: [], planHints: [] }]);
		await api.deletePlanDay('2026-11-02');
		expect(await api.listPlanDays('2026-11-01', '2026-11-07')).toEqual([]);
		expect(await code(api.putPlanDay('2026-11-02', { mode: 'sick' as never }))).toBe('400:bad_request');
	});
});

describe('mock shares', () => {
	it('shows the admin an incoming share with only the granted scopes and no sick days', async () => {
		const [incoming] = await api.listIncomingShares();
		expect(incoming).toMatchObject({ ownerDisplayName: 'Lena Beispiel', scopes: { plan: true, actual: false, vacation: true } });
		const view = await api.viewShared(incoming.id, '2026-09-01', '2026-12-31');
		expect(Object.keys(view).sort()).toEqual(['plan', 'vacation']);
		expect(view.plan!.length).toBeGreaterThan(0);
		expect(view.plan![0]).not.toHaveProperty('note');
		expect(view.vacation!.every((v) => Object.keys(v).sort().join() === 'endDate,startDate')).toBe(true);
		// Lena's seeded sick absence (two weeks ago) never appears
		expect(JSON.stringify(view)).not.toContain('2026-09-28');
	});

	it('creates, updates and rejects outgoing shares', async () => {
		expect(await code(api.createShare({ recipientHandle: 'niemand', scopes: { plan: true } }))).toBe('404:recipient_not_found');
		expect(await code(api.createShare({ recipientHandle: 'admin', scopes: { plan: true } }))).toBe('400:bad_request');
		const share = await api.createShare({ recipientHandle: 'lena', scopes: {} });
		expect(share.scopes).toEqual({ plan: false, actual: false, vacation: false });
		expect(await code(api.createShare({ recipientHandle: 'lena', scopes: { plan: true } }))).toBe('409:share_exists');
		expect((await api.updateShare(share.id, { plan: true })).scopes).toEqual({ plan: true, actual: false, vacation: false });
		await api.revokeShare(share.id);
		expect(await api.listShares()).toEqual([]);
	});

	it('answers 404 for the recipient immediately after revoke', async () => {
		const ids = { a: 'a', b: 'b' };
		const planning = createPlanningMock({
			clock: () => NOW,
			modelsOf: () => [],
			evaluateFor: () => ({ evaluatedWorkSeconds: 3600 }),
			findByHandle: (h) => (h === 'b' ? { id: ids.b, displayName: 'B' } : undefined),
			displayNameOf: () => 'A'
		});
		const call = (accountId: string, method: string, path: string, body?: unknown) => planning.handle(accountId, { method, path: `/api/v1${path}`, body })!;
		const created = call(ids.a, 'POST', '/shares', { recipientHandle: 'b', scopes: { actual: true } });
		const id = (created.body as { id: string }).id;
		expect(call(ids.b, 'GET', `/shares/incoming/${id}/view?from=2026-10-01&to=2026-10-02`).status).toBe(200);
		expect(call(ids.a, 'GET', `/shares/incoming/${id}/view?from=2026-10-01&to=2026-10-02`).status).toBe(404);
		expect(call(ids.a, 'DELETE', `/shares/${id}`).status).toBe(204);
		expect(call(ids.b, 'GET', `/shares/incoming/${id}/view?from=2026-10-01&to=2026-10-02`).status).toBe(404);
		expect((call(ids.b, 'GET', '/shares/incoming').body as unknown[]).length).toBe(0);
	});
});

describe('contract v0.3.1 rules', () => {
	it('keeps carry-over per year and reports the snapshot remaining days', async () => {
		await api.putVacationSettings({ region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: { '2026': 7, '2027': 3 } });
		expect(await api.getVacationSettings()).toMatchObject({ configured: true, carryOverByYear: { '2026': 7, '2027': 3 } });
		expect((await api.getVacationBalance(2027)).carryOverHalfDays).toBe(3);
		expect(await code(api.putVacationSettings({ region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverByYear: { x: 1 } }))).toBe('400:bad_request');
		const snap = await api.createVacationSnapshot({ date: '2026-10-01', remainingHalfDays: 20 });
		expect(snap).toMatchObject({ snapshotRemainingHalfDays: 20, entitlementHalfDays: 0, carryOverHalfDays: 0 });
		expect((await api.getVacationBalance(2027)).snapshotRemainingHalfDays).toBeNull();
	});

	it('lists and deletes snapshots and adjustments by id', async () => {
		await api.createVacationSnapshot({ date: '2026-10-01', remainingHalfDays: 20 });
		await api.createVacationAdjustment({ date: '2026-10-05', halfDays: 4, reason: 'Gutschrift' });
		const entries = await api.listVacationEntries(2026);
		expect(entries.snapshots).toHaveLength(1);
		expect(entries.adjustments).toMatchObject([{ date: '2026-10-05', halfDays: 4, reason: 'Gutschrift' }]);
		expect((await api.listVacationEntries(2027))).toEqual({ snapshots: [], adjustments: [] });
		await api.deleteVacationEntry(entries.adjustments[0].id);
		await api.deleteVacationEntry(entries.snapshots[0].id);
		expect(await code(api.deleteVacationEntry(entries.snapshots[0].id))).toBe('404:not_found');
		expect((await api.getVacationBalance(2026)).snapshotDate).toBeNull();
		expect((await api.listVacationEntries(2026)).adjustments).toEqual([]);
	});

	it('reads a single absence and counts only vacation (0 for sick, other, rejected, cancelled)', async () => {
		const [approved] = await api.listAbsences('2026-10-26', '2026-10-30');
		expect(await api.getAbsence(approved.id)).toEqual(approved);
		expect(await code(api.getAbsence('00000000-0000-4000-8000-000000000000'))).toBe('404:not_found');
		expect((await api.createAbsence({ kind: 'other', startDate: '2026-11-02', endDate: '2026-11-03', status: 'approved' })).countedHalfDays).toBe(0);
		expect((await api.createAbsence(vacation('2026-11-09', '2026-11-10', { status: 'rejected' }))).countedHalfDays).toBe(0);
		expect((await api.createAbsence(vacation('2026-11-16', '2026-11-17', { status: 'approved' }))).countedHalfDays).toBe(4);
	});

	it('lets rejected and cancelled absences not block overlaps', async () => {
		const rejected = await api.createAbsence(vacation('2026-11-02', '2026-11-04', { status: 'rejected' }));
		expect(await code(api.createAbsence(vacation('2026-11-03', '2026-11-03')))).toBe('ok');
		// reviving the rejected one now collides
		expect(await code(api.updateAbsence(rejected.id, { ...rejected, status: 'planned' }, rejected.version))).toBe('409:absence_overlap');
	});

	it('limits ranges to 366 days with range_too_large (the client chunks longer ranges)', async () => {
		const planning = createPlanningMock({ clock: () => NOW, modelsOf: () => [], evaluateFor: () => ({ evaluatedWorkSeconds: 0 }), findByHandle: () => undefined, displayNameOf: () => '' });
		const get = (path: string) => planning.handle('a', { method: 'GET', path: `/api/v1${path}` })!;
		expect(get('/absences?from=2026-01-01&to=2026-12-31').status).toBe(200); // 365 days
		expect(get('/absences?from=2024-01-01&to=2024-12-31').status).toBe(200); // 366 days
		expect(get('/absences?from=2026-01-01&to=2027-01-02')).toMatchObject({ status: 400, body: { error: { code: 'range_too_large' } } }); // 367 days
		expect(get('/plan/days?from=2026-01-01&to=2027-01-02').status).toBe(400);
	});

	it('chunks long client requests and merges shared views', async () => {
		const before = mock.calls.length;
		await api.listAbsences('2025-01-01', '2027-12-31');
		expect(mock.calls.slice(before).filter((c) => c.path.includes('/absences?')).length).toBe(3);
		const [incoming] = await api.listIncomingShares();
		const mark = mock.calls.length;
		const view = await api.viewShared(incoming.id, '2025-01-01', '2027-12-31');
		expect(mock.calls.slice(mark).filter((c) => c.path.includes('/view?')).length).toBe(3);
		expect(Object.keys(view).sort()).toEqual(['plan', 'vacation']);
		const days = await api.listDays('2026-01-01', '2026-06-30');
		expect(days).toHaveLength(181);
		expect(mock.calls.filter((c) => c.path.includes('/time/days?')).length).toBe(2);
	});

	it('shares only approved/taken vacation and actual days with work', async () => {
		const [incoming] = await api.listIncomingShares();
		const view = await api.viewShared(incoming.id, '2026-09-01', '2026-12-31');
		// Lena's seed: taken in September, approved 26.-30.10., planned 23.-25.11. (not visible)
		expect(view.vacation).toEqual([
			{ startDate: '2026-09-07', endDate: '2026-09-09' },
			{ startDate: '2026-10-26', endDate: '2026-10-30' }
		]);
	});

	it('shows shared actual time only for days with work', async () => {
		const planning = createPlanningMock({
			clock: () => NOW,
			modelsOf: () => [],
			evaluateFor: (_a, date) => ({ evaluatedWorkSeconds: date === '2026-10-02' ? 7200 : 0 }),
			findByHandle: (h) => (h === 'b' ? { id: 'b', displayName: 'B' } : undefined),
			displayNameOf: () => 'A'
		});
		const created = planning.handle('a', { method: 'POST', path: '/api/v1/shares', body: { recipientHandle: 'b', scopes: { actual: true } } })!;
		const id = (created.body as { id: string }).id;
		const view = planning.handle('b', { method: 'GET', path: `/api/v1/shares/incoming/${id}/view?from=2026-10-01&to=2026-10-05` })!.body as { actual: { date: string }[] };
		expect(view.actual.map((d) => d.date)).toEqual(['2026-10-02']);
	});

	it('rejects a second share and a share to oneself', async () => {
		expect(await code(api.createShare({ recipientHandle: 'admin', scopes: { plan: true } }))).toBe('400:bad_request');
	});
});

describe('absences, holidays and marks in time/days (C9 behaviour)', () => {
	const day = async (date: string) => (await api.listDays(date, date))[0];

	it('sets vacation and sick to target 0, approved or taken only', async () => {
		const [vac] = await api.listDays('2026-10-26', '2026-10-26');
		expect(vac).toMatchObject({ mark: 'vacation', targetSeconds: 0 });
		const planned = await api.createAbsence(vacation('2026-11-30', '2026-11-30'));
		expect(await day('2026-11-30')).toMatchObject({ mark: 'none', targetSeconds: 27720 });
		await api.updateAbsence(planned.id, { ...planned, status: 'requested' }, planned.version);
		expect((await day('2026-11-30')).targetSeconds).toBe(27720);
		await api.createAbsence({ kind: 'sick', startDate: '2026-12-01', endDate: '2026-12-01', status: 'taken' });
		expect(await day('2026-12-01')).toMatchObject({ mark: 'sick', targetSeconds: 0 });
		await api.createAbsence({ kind: 'other', startDate: '2026-12-02', endDate: '2026-12-02', status: 'approved' });
		expect(await day('2026-12-02')).toMatchObject({ mark: 'none', targetSeconds: 27720 });
	});

	it('halves the target on a half vacation day and sets holidays on workdays', async () => {
		await api.createAbsence(vacation('2026-12-07', '2026-12-08', { status: 'approved', halfDayEnd: true }));
		expect((await day('2026-12-07')).targetSeconds).toBe(0);
		expect(await day('2026-12-08')).toMatchObject({ mark: 'vacation', targetSeconds: 13860 });
		expect(await day('2026-12-25')).toMatchObject({ mark: 'holiday', targetSeconds: 0 });
		expect(await day('2026-12-26')).toMatchObject({ mark: 'none', targetSeconds: 0 }); // Saturday, no workday
	});

	it('lets an explicit mark win and ignores rejected or cancelled absences', async () => {
		await api.createAbsence(vacation('2026-12-14', '2026-12-14', { status: 'approved' }));
		await api.setDayPreferences('2026-12-14', { mark: 'school_credit' });
		expect(await day('2026-12-14')).toMatchObject({ mark: 'school_credit', targetSeconds: 27720 });
		await api.createAbsence(vacation('2026-12-15', '2026-12-15', { status: 'cancelled' }));
		expect(await day('2026-12-15')).toMatchObject({ mark: 'none', targetSeconds: 27720 });
	});

	it('feeds the effect into the time account', async () => {
		const before = await api.getTimeAccount('2026-12-31');
		await api.createAbsence({ kind: 'sick', startDate: '2026-10-13', endDate: '2026-10-13', status: 'taken' });
		const after = await api.getTimeAccount('2026-12-31');
		expect(after.balanceSeconds - before.balanceSeconds).toBe(27720); // the target of the sick day no longer counts as missing
	});
});

describe('mock absence status per kind (contract 0.36.0)', () => {
	const input = (kind: AbsenceInput['kind'], status?: string): AbsenceInput => ({ kind, startDate: '2026-11-02', endDate: '2026-11-02', ...(status ? { status } : {}) });

	it('defaults the status by kind when it is omitted', async () => {
		expect((await api.createAbsence(input('sick'))).status).toBe('recorded');
		expect((await api.createAbsence({ ...input('vacation'), startDate: '2026-11-03', endDate: '2026-11-03' })).status).toBe('planned');
	});

	it('normalises the old workflow statuses for other kinds and rejects invalid combinations', async () => {
		expect((await api.createAbsence(input('sick', 'taken'))).status).toBe('recorded');
		expect((await api.createAbsence({ ...input('other', 'requested'), startDate: '2026-11-04', endDate: '2026-11-04' })).status).toBe('planned');
		expect(await code(api.createAbsence({ ...input('vacation', 'recorded'), startDate: '2026-11-05', endDate: '2026-11-05' }))).toBe('400:absence_status_invalid_for_kind');
		expect(await code(api.createAbsence({ ...input('sick', 'rejected'), startDate: '2026-11-06', endDate: '2026-11-06' }))).toBe('400:absence_status_invalid_for_kind');
		expect(await code(api.createAbsence({ ...input('sick', 'bogus'), startDate: '2026-11-09', endDate: '2026-11-09' }))).toBe('400:bad_request');
	});
});
