import type { Absence, AbsenceStatus } from '#lib/api/types.js';
import { t } from '#lib/i18n/index.js';
import { addDays } from '#lib/time/dates.js';

/**
 * Vacation in the week overview (N3): every planned, requested or approved vacation shows up on the days it covers,
 * independent of what the day mark says. Vacation is an entry, never worked time, so no summary figure uses it.
 */

/** Statuses shown in the week overview; rejected, cancelled (and taken, which the day mark already shows) are left out. */
export const VACATION_STATUSES: AbsenceStatus[] = ['planned', 'requested', 'approved'];

export type VacationStatus = 'planned' | 'requested' | 'approved';

export interface VacationEntry {
	id: string;
	status: VacationStatus;
	halfDay: boolean;
}

/** Days without work duty (weekend, other free days, holidays) never carry a vacation entry: nothing is taken there. */
export const isFreeMark = (mark: string) => mark === 'off' || mark === 'holiday';

/** Entries of one day of the week data; null when the vacation list is unavailable so the caller falls back to the week's own absences. */
export function entriesForDay(byDay: Record<string, VacationEntry[]> | null, date: string, mark: string): VacationEntry[] | null {
	if (!byDay) return null;
	return isFreeMark(mark) ? [] : (byDay[date] ?? []);
}

/** Status wording: "Urlaub – geplant", half days "Urlaub (halber Tag) – genehmigt". */
export function vacationLabel(entry: Pick<VacationEntry, 'status' | 'halfDay'>): string {
	return t(entry.halfDay ? 'weekview.vacation.half' : 'weekview.vacation.full', { status: t(`weekview.vacation.status.${entry.status}`) });
}

/** Tooltip and screen reader text: label plus what is still open ("Urlaub – geplant, noch nicht beantragt"). */
export function vacationTooltip(entry: Pick<VacationEntry, 'status' | 'halfDay'>): string {
	if (entry.status === 'approved') return vacationLabel(entry);
	return `${vacationLabel(entry)}, ${t(`weekview.vacation.hint.${entry.status}`)}`;
}

const RANK: Record<string, number> = { approved: 3, requested: 2, planned: 1 };

/** Vacation entries per date of [from, to]; several absences on one day are ordered by status (approved first). */
export function vacationByDay(absences: Absence[], from: string, to: string): Record<string, VacationEntry[]> {
	const result: Record<string, VacationEntry[]> = {};
	for (const absence of absences) {
		if (absence.kind !== 'vacation' || !VACATION_STATUSES.includes(absence.status)) continue;
		const single = absence.startDate === absence.endDate;
		for (let d = absence.startDate < from ? from : absence.startDate; d <= absence.endDate && d <= to; d = addDays(d, 1)) {
			// a single day counts as half day when either flag is set (same rule as the absence form hint)
			const halfDay = single ? !!(absence.halfDayStart || absence.halfDayEnd) : (d === absence.startDate && !!absence.halfDayStart) || (d === absence.endDate && !!absence.halfDayEnd);
			(result[d] ??= []).push({ id: absence.id, status: absence.status as VacationStatus, halfDay });
		}
	}
	for (const list of Object.values(result)) list.sort((a, b) => RANK[b.status] - RANK[a.status]);
	return result;
}
