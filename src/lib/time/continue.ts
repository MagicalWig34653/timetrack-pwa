import { api } from '#lib/api/client.js';
import { ApiError } from '#lib/api/errors.js';
import type { Segment } from '#lib/api/types.js';
import { errorMessage, t } from '#lib/i18n/index.js';
import { newEventId, retryOnNetworkError } from '#lib/time/idempotent.js';

/** Gaps longer than this get the explicit choice "continue (gap counts)" vs. "restart (gap stays a pause)". */
export const LONG_GAP_SECONDS = 15 * 60;
/** Fixed correction reason of the backend contract 0.27.0 reopen call. */
export const REOPEN_REASON = 'Timer fortgesetzt';

/**
 * The segment "Fortführen" applies to: the chronologically last non-voided segment, if it is finished.
 * With a running timer (or no segment) nothing can be continued; the server only reopens the latest segment.
 */
export function continuableSegment(segments: Segment[]): Segment | null {
	const active = segments.filter((s) => !s.voided);
	if (active.length === 0) return null;
	const last = active.reduce((a, b) => (Date.parse(b.startedAt) > Date.parse(a.startedAt) ? b : a));
	return last.endedAt ? last : null;
}

/** Seconds between the end of the finished segment and `nowMs`; never negative. */
export function gapSeconds(segment: Segment, nowMs: number): number {
	return segment.endedAt ? Math.max(0, Math.floor((nowMs - Date.parse(segment.endedAt)) / 1000)) : 0;
}

export type ContinueOutcome =
	/** the same segment runs again, the gap counts as work time */
	| { mode: 'reopened'; segment: Segment }
	/** server too old for reopen: a new segment was started, the gap stays a pause */
	| { mode: 'fallback'; segment: Segment };

// Statuses that must never trigger the fallback: the known guards (404/409/412) and transient or auth problems.
const NO_FALLBACK_STATUSES = new Set([0, 401, 403, 404, 408, 409, 412, 429]);

/** True when an error of the reopen call means "this server does not know the reopen semantics" (4xx, not a known guard). */
export function isReopenUnsupported(error: unknown): boolean {
	return error instanceof ApiError && error.status >= 400 && error.status < 500 && !NO_FALLBACK_STATUSES.has(error.status);
}

/** Starts a new segment with the kind, place and note of `segment` from now (the gap stays a pause). */
export async function restartLike(segment: Segment, retryDelayMs?: number): Promise<Segment> {
	const clientEventId = newEventId();
	const started = await retryOnNetworkError(
		() => api.startTimer({ clientEventId, kind: segment.kind, placeId: segment.placeId ?? null }),
		{ delayMs: retryDelayMs }
	);
	if (!segment.note) return started;
	try {
		// The timer endpoint has no note field; carrying it over is best effort.
		return await api.correctSegment(started.id, { note: segment.note, reason: 'Notiz übernommen' }, started.version);
	} catch {
		return started;
	}
}

/**
 * Reopens the finished `segment` (PATCH endedAt null, contract 0.27.0). Known guards (409 timer_already_running,
 * 409 segment_overlap, 412 stale_version, ...) and network/5xx/429/401 errors are thrown to the caller; only other
 * 4xx answers (older backend) fall back to a new segment. A 200 that still carries an end is treated the same way.
 */
export async function continueSegment(segment: Segment, retryDelayMs?: number): Promise<ContinueOutcome> {
	let reopened: Segment;
	try {
		reopened = await retryOnNetworkError(
			() => api.correctSegment(segment.id, { endedAt: null, reason: REOPEN_REASON }, segment.version),
			{ delayMs: retryDelayMs }
		);
	} catch (error) {
		if (!isReopenUnsupported(error)) throw error;
		return { mode: 'fallback', segment: await restartLike(segment, retryDelayMs) };
	}
	// An older server may ignore `endedAt: null` and answer 200 with the unchanged segment.
	if (reopened.endedAt !== null) return { mode: 'fallback', segment: await restartLike(segment, retryDelayMs) };
	return { mode: 'reopened', segment: reopened };
}

/** Whether the view must be reloaded after this error (the segment list is stale). */
export function continueNeedsReload(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 412 || error.status === 409 || error.status === 404);
}

/** German message for a failed continue/reopen call. */
export function continueErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === 'segment_overlap') return t('timer.continue_overlap');
		if (error.code === 'stale_version' || error.status === 412) return t('timer.continue_stale');
	}
	return errorMessage(error);
}
