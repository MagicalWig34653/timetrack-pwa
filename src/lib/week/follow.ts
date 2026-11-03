import type { PlanWeek, PlanWeekEntry } from '#lib/api/types.js';
import { entryFromDraft, type DayDraft } from './plan-draft.js';

export const MAX_FOLLOW_WEEKS = 12;

/**
 * Entries that copy a planned week onto a later week ("Auf Folgewochen kopieren"). Weekday by weekday: days without a
 * plan stay untouched in the target. Target days marked vacation, sick, excused or holiday stay unchanged even when
 * `overwrite` is set; other existing plans are only replaced when `overwrite` is set. The result is sent with `replace: false` (upsert by date).
 */
export function followEntries(source: DayDraft[], target: PlanWeek, overwrite: boolean, multi = true): { entries: PlanWeekEntry[]; skippedExisting: number } {
	const entries: PlanWeekEntry[] = [];
	let skippedExisting = 0;
	source.forEach((draft, index) => {
		const day = target.days[index];
		if (!day || draft.mode === '' || day.blockedBy !== null) return;
		if (day.plan !== null && !overwrite) {
			skippedExisting++;
			return;
		}
		const entry = entryFromDraft({ ...draft, date: day.date }, multi);
		if (entry) entries.push(entry);
	});
	return { entries, skippedExisting };
}
