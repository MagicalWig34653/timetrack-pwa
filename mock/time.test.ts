import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import { createMockFetch } from './fetch.ts';

// Wednesday 14.10.2026 11:30 Berlin
const NOW = Date.parse('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	mock = createMockFetch({ now: () => NOW });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	const options = await api.loginOptions();
	await api.loginVerify(options.challengeId, { id: 'mock-login' });
});
afterEach(() => vi.unstubAllGlobals());

const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: ApiError) => `${e.status}:${e.code}`);

describe('mock time API', () => {
	it('seeds a 38:30 h/week model with 7:42 daily target and quarter-hour rounding', async () => {
		const [model] = await api.listWorkModels();
		expect(model).toMatchObject({ weeklyTargetSeconds: 138600, workdays: [1, 2, 3, 4, 5], roundingEnabled: true, roundingMinutes: 15 });
		const day = await api.getDay('2026-10-14');
		expect(day.targetSeconds).toBe(27720);
	});

	it('evaluates seeded days with rounding at first start/last end only and keeps gaps', async () => {
		const day = await api.getDay('2026-10-12'); // 07:58-12:10, 12:50-16:30
		expect(day.rawWorkSeconds).toBe(7 * 3600 + 52 * 60);
		expect(day.startAdjustSeconds).toBe(13 * 60);
		expect(day.endAdjustSeconds).toBe(0);
		expect(day.evaluatedWorkSeconds).toBe(8 * 3600 + 5 * 60);
		expect(day.provisional).toBe(false);
	});

	it('timer start/stop is idempotent over clientEventId', async () => {
		const startId = crypto.randomUUID();
		const first = await api.startTimer({ clientEventId: startId });
		const again = await api.startTimer({ clientEventId: startId });
		expect(again.id).toBe(first.id);
		expect(await code(api.startTimer({ clientEventId: crypto.randomUUID() }))).toBe('409:timer_already_running');
		const stopId = crypto.randomUUID();
		const stopped = await api.stopTimer({ clientEventId: stopId });
		expect(stopped.endedAt).not.toBeNull();
		expect((await api.stopTimer({ clientEventId: stopId })).id).toBe(first.id);
		expect(await code(api.stopTimer({ clientEventId: crypto.randomUUID() }))).toBe('409:no_running_timer');
		expect(await api.currentTimer()).toBeNull();
	});

	it('marks the running day provisional', async () => {
		await api.startTimer({ clientEventId: crypto.randomUUID() });
		const day = await api.getDay('2026-10-14');
		expect(day.provisional).toBe(true);
	});

	it('enforces overlap, If-Match versions and a correction reason', async () => {
		const created = await api.createSegment({ kind: 'work', startedAt: '2026-10-14T06:00:00Z', endedAt: '2026-10-14T08:00:00Z' });
		expect(await code(api.createSegment({ kind: 'work', startedAt: '2026-10-14T07:00:00Z', endedAt: '2026-10-14T09:00:00Z' }))).toBe('409:segment_overlap');
		expect(await code(api.correctSegment(created.id, { note: 'x', reason: 'r' }, 7))).toBe('412:stale_version');
		expect(await code(api.correctSegment(created.id, { note: 'x', reason: ' ' }, 1))).toBe('400:bad_request');
		const corrected = await api.correctSegment(created.id, { endedAt: '2026-10-14T08:30:00Z', reason: 'länger' }, 1);
		expect(corrected).toMatchObject({ version: 2, revisions: 1, rawEndedAt: '2026-10-14T08:00:00Z' });
		await api.voidSegment(created.id, 'Fehlbuchung');
		const visible = await api.listSegments('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z');
		expect(visible.find((s) => s.id === created.id)).toBeUndefined();
		const all = await api.listSegments('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', true);
		expect(all.find((s) => s.id === created.id)?.voided).toBe(true);
	});

	it('corrects a version in place with a server-computed preview that equals the real change (contract v0.16.0)', async () => {
		const [model] = await api.listWorkModels();
		expect(model.version).toBe(1);
		const input = { ...model, weeklyTargetSeconds: 100800 };
		const preview = await api.previewWorkModel(model.id, input);
		expect(preview.changedFields).toEqual(['weeklyTargetSeconds']);
		expect(preview.differenceSeconds).toBeGreaterThan(0);
		expect(preview.affectedFrom).toBe(model.validFrom);
		expect(preview.affectedTo).toBeNull();
		const before = (await api.getTimeAccount()).balanceSeconds;
		expect(before).toBe(preview.balanceBeforeSeconds);
		const corrected = await api.correctWorkModel(model.id, input, 1);
		expect(corrected.version).toBe(2);
		expect((await api.getTimeAccount()).balanceSeconds).toBe(preview.balanceAfterSeconds);
		// identical values: neutral preview
		const neutral = await api.previewWorkModel(model.id, corrected);
		expect(neutral.differenceSeconds).toBe(0);
		expect(neutral.changedFields).toEqual([]);
	});

	it('adjusts the previous version when a correction moves validFrom and rejects overlaps', async () => {
		const [first] = await api.listWorkModels();
		const second = await api.createWorkModel({ ...first, validFrom: '2026-10-01', validTo: null });
		const moved = await api.previewWorkModel(second.id, { ...second, validFrom: '2026-09-20' });
		expect(moved.previousValidTo).toBe('2026-09-19');
		await api.correctWorkModel(second.id, { ...second, validFrom: '2026-09-20' });
		expect((await api.listWorkModels()).find((m) => m.id === first.id)?.validTo).toBe('2026-09-19');
		expect(await code(api.correctWorkModel(first.id, { ...first, validTo: null }))).toBe('409:model_overlap');
		expect(await code(api.correctWorkModel(second.id, { ...second, validFrom: first.validFrom }))).toBe('409:model_overlap');
		expect(await code(api.correctWorkModel(second.id, { ...second, weeklyTargetSeconds: -1 }))).toBe('400:bad_request');
		expect(await code(api.previewWorkModel('00000000-0000-0000-0000-000000000000', second))).toBe('404:not_found');
	});

	it('creates a new work model version, ending the previous one the day before, and rejects overlaps', async () => {
		const [old] = await api.listWorkModels();
		const next = await api.createWorkModel({ validFrom: '2026-11-01', weeklyTargetSeconds: 144000, workdays: [1, 2, 3, 4, 5] });
		const models = await api.listWorkModels();
		expect(models.find((m) => m.id === old.id)?.validTo).toBe('2026-10-31');
		expect(next.validTo).toBeNull();
		expect((await api.getDay('2026-10-14')).targetSeconds).toBe(27720); // history untouched
		expect((await api.getDay('2026-11-02')).targetSeconds).toBe(28800);
		expect(await code(api.createWorkModel({ validFrom: '2026-10-20', weeklyTargetSeconds: 1, workdays: [1] }))).toBe('409:model_overlap');
		const ended = await api.endWorkModel(next.id, '2027-06-30');
		expect(ended.validTo).toBe('2027-06-30');
	});

	it('applies day preferences and the time account balance', async () => {
		const before = (await api.getTimeAccount()).balanceSeconds;
		const day = await api.setDayPreferences('2026-10-13', { mark: 'holiday' });
		expect(day).toMatchObject({ mark: 'holiday', targetSeconds: 0 });
		expect((await api.getTimeAccount()).balanceSeconds).not.toBe(before);
		await api.setDayPreferences('2026-10-13', { mark: 'none' });
		expect((await api.getTimeAccount()).balanceSeconds).toBe(before);
		const withCorrection = await api.createAccountAdjustment({ kind: 'correction', date: '2026-10-13', seconds: 3600, reason: 'Ausgleich' });
		expect(withCorrection.balanceSeconds).toBe(before + 3600);
		expect(await code(api.createAccountAdjustment({ kind: 'opening', date: '2026-10-01', seconds: 0, reason: 'x' }))).toBe('409:opening_exists');
	});

	it('accepts suggestions once and rejects the rest', async () => {
		const [suggestion] = await api.listSuggestions();
		expect(suggestion.type).toBe('start');
		const segment = await api.acceptSuggestion(suggestion.id, { startedAt: '2026-10-14T08:00:00Z' });
		expect(segment).toMatchObject({ source: 'suggestion', startedAt: '2026-10-14T08:00:00Z' });
		expect(await code(api.acceptSuggestion(suggestion.id))).toBe('404:not_found');
		expect(await api.listSuggestions()).toEqual([]);
	});

	it('shows device tokens once and honours Bearer tokens for automation events', async () => {
		const created = await api.createDeviceToken({ name: 'iPhone', expiresInDays: 30 });
		expect(created.token).toMatch(/^ttd_/);
		const listed = await api.listDeviceTokens();
		expect(JSON.stringify(listed)).not.toContain(created.token);
		const [office] = (await api.listPlaces()).filter((p) => p.automationMode === 'direct');
		const post = (type: string, eventId: string, token = created.token) =>
			mock.fetch('/api/v1/automation/events', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ eventId, deviceId: 'd', type, placeId: office.id, occurredAt: '2026-10-14T06:00:00Z' })
			});
		const eventId = crypto.randomUUID();
		const first = await (await post('presence_confirmed', eventId)).json();
		expect(first.result).toBe('booked');
		expect((await (await post('presence_confirmed', eventId)).json()).segmentId).toBe(first.segmentId);
		expect((await post('arrival', crypto.randomUUID(), 'wrong')).status).toBe(401);
		const afterUse = await api.listDeviceTokens();
		expect(afterUse[0].lastUsedAt).not.toBeNull();
		await api.revokeDeviceToken(created.id);
		expect((await post('departure', crypto.randomUUID())).status).toBe(401);
	});
});
