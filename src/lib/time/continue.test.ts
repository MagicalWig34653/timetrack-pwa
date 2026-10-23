import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { ApiError } from '#lib/api/errors.js';
import type { Segment } from '#lib/api/types.js';
import { sessionStore } from '#lib/session.svelte.js';
import { continuableSegment, continueErrorMessage, continueSegment, gapSeconds, isReopenUnsupported, restartLike } from './continue.js';

const NOW = Date.parse('2026-10-14T09:30:00Z'); // 11:30 in Berlin
let mock: ReturnType<typeof createMockFetch>;

const seg = (over: Partial<Segment>): Segment => ({
	id: 'x', kind: 'work', startedAt: '2026-10-14T06:00:00Z', endedAt: '2026-10-14T09:00:00Z', rawStartedAt: '2026-10-14T06:00:00Z',
	rawEndedAt: '2026-10-14T09:00:00Z', source: 'timer', version: 1, voided: false, needsReview: false, ...over
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('continuableSegment / gapSeconds', () => {
	it('picks the chronologically last non-voided segment only when it is finished', () => {
		const a = seg({ id: 'a' });
		const b = seg({ id: 'b', startedAt: '2026-10-14T09:10:00Z', endedAt: '2026-10-14T09:20:00Z' });
		const voided = seg({ id: 'v', startedAt: '2026-10-14T09:25:00Z', endedAt: '2026-10-14T09:26:00Z', voided: true });
		expect(continuableSegment([b, a, voided])?.id).toBe('b');
		expect(continuableSegment([a, seg({ id: 'r', startedAt: '2026-10-14T09:10:00Z', endedAt: null })])).toBeNull();
		expect(continuableSegment([])).toBeNull();
		expect(continuableSegment([voided])).toBeNull();
	});

	it('computes the gap and never goes negative', () => {
		expect(gapSeconds(seg({}), NOW)).toBe(30 * 60);
		expect(gapSeconds(seg({ endedAt: '2026-10-14T10:00:00Z' }), NOW)).toBe(0);
		expect(gapSeconds(seg({ endedAt: null }), NOW)).toBe(0);
	});
});

describe('fallback decision', () => {
	it('only unknown 4xx answers mean "reopen unsupported"', () => {
		const e = (status: number) => new ApiError(status, 'x', 'm');
		for (const status of [400, 405, 415, 422]) expect(isReopenUnsupported(e(status))).toBe(true);
		for (const status of [0, 401, 403, 404, 409, 412, 429, 500, 502, 503]) expect(isReopenUnsupported(e(status))).toBe(false);
		expect(isReopenUnsupported(new Error('boom'))).toBe(false);
	});

	it('maps guards to German messages', () => {
		expect(continueErrorMessage(new ApiError(409, 'segment_overlap', 'm'))).toMatch(/späteren/);
		expect(continueErrorMessage(new ApiError(412, 'stale_version', 'm'))).toMatch(/zwischenzeitlich/);
		expect(continueErrorMessage(new ApiError(409, 'timer_already_running', 'm'))).toBe('Es läuft bereits ein Timer.');
	});
});

describe('continueSegment against the mock', () => {
	let finished: Segment;
	beforeEach(async () => {
		mock = createMockFetch({ now: () => NOW });
		vi.stubGlobal('fetch', mock.fetch);
		setCsrfToken(null);
		const options = await api.loginOptions();
		sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
		finished = await api.createSegment({ kind: 'school', startedAt: '2026-10-14T06:00:00Z', endedAt: '2026-10-14T09:00:00Z', note: 'Mathe' });
	});
	afterEach(() => vi.unstubAllGlobals());

	/** Replaces PATCH answers; everything else goes to the mock. */
	function patchAnswers(make: () => Response | Promise<Response>) {
		const inner = mock.fetch;
		// only the reopen call (endedAt null) is answered; other corrections (e.g. the note carry-over) reach the mock
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
			init?.method === 'PATCH' && String(init.body).includes('"endedAt":null') ? make() : inner(input, init)
		);
	}
	const timerStarts = () => mock.calls.filter((c) => c.path.endsWith('/time/timer/start'));

	it('reopens the same segment with endedAt null, If-Match and the fixed reason', async () => {
		const inner = mock.fetch;
		let sent: RequestInit | undefined;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'PATCH') sent = init;
			return inner(input, init);
		});
		const outcome = await continueSegment(finished, 0);
		expect(JSON.parse(String(sent!.body))).toEqual({ endedAt: null, reason: 'Timer fortgesetzt' });
		expect(new Headers(sent!.headers).get('If-Match')).toBe(String(finished.version));
		expect(outcome.mode).toBe('reopened');
		expect(outcome.segment).toMatchObject({ id: finished.id, endedAt: null, kind: 'school', note: 'Mathe', version: finished.version + 1, rawEndedAt: finished.rawEndedAt });
		expect(await api.currentTimer()).toMatchObject({ id: finished.id });
	});

	it('does not fall back on stale_version / segment_overlap / timer_already_running', async () => {
		await expect(continueSegment({ ...finished, version: 99 }, 0)).rejects.toMatchObject({ status: 412 });
		const later = await api.createSegment({ kind: 'work', startedAt: '2026-10-14T09:10:00Z', endedAt: '2026-10-14T09:20:00Z' });
		await expect(continueSegment(finished, 0)).rejects.toMatchObject({ code: 'segment_overlap' });
		await api.correctSegment(later.id, { endedAt: null, reason: 'x' }, later.version);
		await expect(continueSegment(finished, 0)).rejects.toMatchObject({ code: 'timer_already_running' });
		expect(timerStarts()).toHaveLength(0);
	});

	it('falls back to a new segment with the same attributes on an unknown 4xx (older backend)', async () => {
		patchAnswers(() => json(400, { code: 'bad_request', message: 'bad' }));
		const outcome = await continueSegment(finished, 0);
		expect(outcome.mode).toBe('fallback');
		expect(outcome.segment).toMatchObject({ kind: 'school', endedAt: null, source: 'timer', note: 'Mathe' });
		expect(outcome.segment.id).not.toBe(finished.id);
	});

	it('treats a 200 that still has an end (server ignores null) as unsupported', async () => {
		patchAnswers(() => json(200, finished));
		expect((await continueSegment(finished, 0)).mode).toBe('fallback');
	});

	it('does not fall back on 5xx, 429, 401 or network errors', async () => {
		for (const status of [500, 503, 429, 401]) {
			patchAnswers(() => json(status, { code: 'x', message: 'x' }));
			await expect(continueSegment(finished, 0)).rejects.toMatchObject({ status });
		}
		patchAnswers(() => {
			throw new TypeError('offline');
		});
		await expect(continueSegment(finished, 0)).rejects.toMatchObject({ status: 0 });
		expect(timerStarts()).toHaveLength(0);
	});

	it('restartLike starts a new segment from now with kind and place', async () => {
		const places = await api.listPlaces();
		const started = await restartLike({ ...finished, placeId: places[0].id, note: null }, 0);
		expect(started).toMatchObject({ kind: 'school', placeId: places[0].id, endedAt: null });
	});
});
