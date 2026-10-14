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
		await api.putVacationSettings({ region: 'DE-ST', annualEntitlementHalfDays: 60, carryOverHalfDays: 7, carryOverExpiry: '03-31' });
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

	it('reports unconfigured settings as 404 and entitlement 0 (defaults are only a suggestion)', async () => {
		vi.unstubAllGlobals();
		await login({ seedPlanning: false });
		expect(await code(api.getVacationSettings())).toBe('404:not_found');
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
		expect(sick).toMatchObject({ documentStatus: 'submitted', documentSubmittedOn: '2026-02-04', countedHalfDays: 4 });
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
		expect((await api.listPlanDays('2026-11-01', '2026-11-07'))).toEqual([{ date: '2026-11-02', mode: 'customer', placeId: null, note: 'Kunde A' }]);
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
