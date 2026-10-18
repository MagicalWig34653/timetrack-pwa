/**
 * Decides whether the "new version available" banner may show (P3a).
 *
 * With several backend replicas on rolling updates the browser can fetch service-worker.js from replicas of different
 * versions and keep installing "updates". The banner is therefore only trusted when the server-reported PWA revision
 * really differs from the running bundle; after the user applied an update it stays suppressed for a while.
 */

export const SUPPRESS_MS = 10 * 60 * 1000;
export const APPLIED_KEY = 'tt-pwa-update-applied-at';
export const HARD_RESET_KEY = 'tt-pwa-hard-reset-at';
/** a second hard reset within this window is refused (reload-loop guard) */
export const HARD_RESET_GUARD_MS = 60 * 1000;

const isKnown = (revision: string | null | undefined): revision is string => !!revision && revision !== 'unknown';

/** Reads a timestamp (ms) from storage; unreadable storage or garbage counts as "never". */
export function readStamp(storage: Pick<Storage, 'getItem'> | null | undefined, key: string): number | null {
	try {
		const raw = storage?.getItem(key);
		const value = raw ? Number(raw) : NaN;
		return Number.isFinite(value) ? value : null;
	} catch {
		return null;
	}
}

export function writeStamp(storage: Pick<Storage, 'setItem'> | null | undefined, key: string, now: number): void {
	try {
		storage?.setItem(key, String(now));
	} catch {
		// private mode or blocked storage: the banner logic then simply runs without a suppression window
	}
}

/** True while the last applied update (or reload) is younger than the suppression window. */
export function isSuppressed(appliedAt: number | null, now: number, windowMs = SUPPRESS_MS): boolean {
	return appliedAt !== null && now - appliedAt >= 0 && now - appliedAt < windowMs;
}

export interface BannerInput {
	/** a worker is installed and waiting while another one controls the page */
	waitingWorker: boolean;
	ownRevision: string;
	/** `pwa.revision` from GET /system/info; null/undefined when unavailable (old backend, offline, not logged in) */
	serverRevision: string | null | undefined;
	suppressed: boolean;
}

export function shouldShowUpdateBanner(input: BannerInput): boolean {
	if (!input.waitingWorker) return false;
	if (isKnown(input.ownRevision) && isKnown(input.serverRevision)) {
		// the server is authoritative: equal revisions mean the waiting worker is a stale/mixed-version artefact
		return input.serverRevision.toLowerCase() !== input.ownRevision.toLowerCase();
	}
	return !input.suppressed;
}

/** Reads `pwa.revision` from a /system/info body; anything unexpected yields null. */
export function parseServerRevision(body: unknown): string | null {
	const revision = (body as { pwa?: { revision?: unknown } } | null)?.pwa?.revision;
	return typeof revision === 'string' && revision ? revision : null;
}
