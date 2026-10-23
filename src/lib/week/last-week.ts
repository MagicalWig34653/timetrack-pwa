import { mondayOfIsoWeek } from '#lib/time/dates.js';

/** Remembers the last viewed week of /week for this browser tab (P12). The URL stays the source of truth when it names a week. */
const KEY = 'timetrack.week.last';

/** Saves an ISO week label such as "2026-W43"; invalid labels and blocked storage are ignored. */
export function rememberWeek(isoWeek: string): void {
	if (!mondayOfIsoWeek(isoWeek)) return;
	try {
		sessionStorage.setItem(KEY, isoWeek);
	} catch {
		// remembering is a convenience only
	}
}

/** The remembered ISO week label, or null when nothing valid is stored. */
export function recalledWeek(): string | null {
	try {
		const value = sessionStorage.getItem(KEY);
		return value && mondayOfIsoWeek(value) ? value : null;
	} catch {
		return null;
	}
}
