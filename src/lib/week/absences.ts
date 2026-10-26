import type { AbsenceKind, AbsenceStatus, TimeWeekDay, WeekMark } from '#lib/api/types.js';
import { t } from '#lib/i18n/index.js';
import { addDays } from '#lib/time/dates.js';

/** Absences in the week view (P12): all active statuses show up, planned and requested ones carry a warning. */

type DayAbsence = TimeWeekDay['absences'][number];

/** Statuses that still need a step of the user (planned = not requested yet, requested = waiting for the employer). */
export const OPEN_STATUSES: AbsenceStatus[] = ['planned', 'requested'];

export const isOpenStatus = (status: AbsenceStatus) => OPEN_STATUSES.includes(status);

/** Warning text of an absence that is not decided yet; null for approved and taken ones (shown as usual). */
export function absenceWarning(status: AbsenceStatus): string | null {
	if (status === 'planned') return t('weekview.absence.not_requested');
	if (status === 'requested') return t('weekview.absence.not_approved');
	return null;
}

/** The mark a day gets from an absence once it is decided; used to avoid showing the same fact twice. */
const MARK_OF_KIND: Partial<Record<AbsenceKind, WeekMark>> = { vacation: 'vacation', sick: 'sick', excused: 'excused' };

/**
 * Absences of a day that need their own chip on the day card: every open one (planned/requested) and decided ones
 * the day mark does not already express (e.g. "Sonstiges"). With `vacationListed` vacation is left out.
 */
export function chipAbsences(day: Pick<TimeWeekDay, 'mark' | 'absences'>, vacationListed = false): DayAbsence[] {
	// when the vacation entries come from the absence list (N3), they get their own chips and are not repeated here
	// open absences on free days (weekend, holiday) are not shown: nothing is taken there
	if (day.mark === 'off' || day.mark === 'holiday') return [];
	return day.absences.filter((a) => !(vacationListed && a.kind === 'vacation') && (isOpenStatus(a.status) || MARK_OF_KIND[a.kind] !== day.mark));
}

export interface AbsenceRun {
	kind: AbsenceKind;
	status: AbsenceStatus;
	from: string;
	to: string;
	days: number;
	/** half days count 0.5 */
	counted: number;
}

/** Consecutive days with the same kind and status, as one entry of the absence list below the week. */
export function absenceRuns(days: Pick<TimeWeekDay, 'date' | 'absences'>[]): AbsenceRun[] {
	const runs: AbsenceRun[] = [];
	for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
		for (const a of day.absences) {
			const open = runs.find((r) => r.kind === a.kind && r.status === a.status && addDays(r.to, 1) === day.date);
			if (open) {
				open.to = day.date;
				open.days += 1;
				open.counted += a.halfDay ? 0.5 : 1;
			} else runs.push({ kind: a.kind, status: a.status, from: day.date, to: day.date, days: 1, counted: a.halfDay ? 0.5 : 1 });
		}
	}
	return runs;
}

/** True when the week has at least one absence that is still planned or requested. */
export const hasOpenAbsence = (days: Pick<TimeWeekDay, 'absences'>[]) => days.some((d) => d.absences.some((a) => isOpenStatus(a.status)));
