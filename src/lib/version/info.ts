import type { SystemInfo } from '#lib/api/types.js';

/** Build metadata of this running PWA bundle (injected at build time by vite.config.ts). */
export interface PwaBuild {
	version: string;
	revision: string;
	buildDate: string;
}

export function ownBuild(): PwaBuild {
	return { version: __APP_VERSION__, revision: __APP_REVISION__, buildDate: __APP_BUILD_DATE__ };
}

const isKnown = (revision: string | null | undefined): revision is string => !!revision && revision !== 'unknown';

/** First seven characters of a commit id; "unknown" and empty values stay readable. */
export function shortRevision(revision: string | null | undefined): string {
	return isKnown(revision) ? revision.slice(0, 7) : 'unbekannt';
}

/** `2026-10-18T08:01:02Z` -> `2026-10-18` (the date part is enough for support texts). */
export function shortDate(iso: string | null | undefined): string {
	return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
}

/** German date and time for display; falls back to the raw value for anything unparsable. */
export function formatBuildDate(iso: string | null | undefined): string {
	if (!iso) return '–';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * The server ships a different PWA revision than the one running in this tab (typically an old service worker cache
 * after an update). Unknown revisions on either side never count as a mismatch.
 */
export function revisionMismatch(own: PwaBuild, info: SystemInfo | null): boolean {
	const served = info?.pwa?.revision;
	return isKnown(own.revision) && isKnown(served) && served.toLowerCase() !== own.revision.toLowerCase();
}

/** `93784` -> `1 Tag 2 Std. 3 Min.`; seconds only below a minute. */
export function formatUptime(seconds: number): string {
	if (!Number.isFinite(seconds)) return '–';
	const total = Math.max(0, Math.floor(seconds));
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const parts: string[] = [];
	if (days) parts.push(`${days} ${days === 1 ? 'Tag' : 'Tage'}`);
	if (days || hours) parts.push(`${hours} Std.`);
	if (days || hours || minutes) parts.push(`${minutes} Min.`);
	return parts.length ? parts.join(' ') : `${total} Sek.`;
}

const part = (build: { version?: string | null; revision?: string | null; buildDate?: string | null }) => {
	const details = [isKnown(build.revision) ? build.revision.slice(0, 7) : null, shortDate(build.buildDate) || null].filter(Boolean);
	return `${build.version ?? 'unbekannt'}${details.length ? ` (${details.join(', ')})` : ''}`;
};

/** One line for bug reports, e.g. `Timetrack PWA 0.1.0 (abc1234, 2026-10-18), Backend 0.1.0 (def5678, 2026-10-18), API 0.19.0, mariadb`. */
export function supportText(own: PwaBuild, info: SystemInfo | null): string {
	let text = `Timetrack PWA ${part(own)}`;
	if (info) text += `, Backend ${part(info.backend)}, API ${info.backend.apiVersion}${info.backend.database ? `, ${info.backend.database}` : ''}`;
	else text += ', Backend: keine Versionsangabe verfügbar';
	return text;
}
