import type { Absence, CalendarDay, DayEvaluation, PlanDay, WorkModel } from '#lib/api/types.js';
import { addDays, isoWeekday, startOfWeek } from '#lib/time/dates.js';

/** "2026-10-14" -> "2026-10-01" */
export function firstOfMonth(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

/** Last day of the month containing the date. */
export function lastOfMonth(date: string): string {
	return addDays(addMonths(date, 1), -1);
}

/** First day of the month n months after (or before) the date's month. */
export function addMonths(date: string, months: number): string {
	const total = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) + months;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** Weeks (Monday first) covering the month of the date; 4 to 6 rows of 7 ISO dates. */
export function monthGrid(date: string): string[][] {
	const first = firstOfMonth(date);
	const last = lastOfMonth(date);
	const weeks: string[][] = [];
	for (let start = startOfWeek(first); start <= last; start = addDays(start, 7)) {
		weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
	}
	return weeks;
}

export function weekOf(date: string): string[] {
	const start = startOfWeek(date);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const covers = (entry: { startDate: string; endDate: string }, date: string) => entry.startDate <= date && date <= entry.endDate;

/** Cancelled and rejected absences are kept in lists but do not mark the calendar. */
export const isActiveAbsence = (absence: Pick<Absence, 'status'>) => absence.status !== 'cancelled' && absence.status !== 'rejected';

export interface CalendarData {
	holidays: CalendarDay[];
	absences: Absence[];
	plan: PlanDay[];
	days: DayEvaluation[];
}

export interface DayInfo {
	date: string;
	holidays: CalendarDay[];
	schoolHolidays: CalendarDay[];
	absences: Absence[];
	plan: PlanDay | null;
	evaluation: DayEvaluation | null;
}

export function dayInfo(date: string, data: CalendarData): DayInfo {
	return {
		date,
		holidays: data.holidays.filter((h) => h.kind === 'holiday' && covers(h, date)),
		schoolHolidays: data.holidays.filter((h) => h.kind === 'school_holiday' && covers(h, date)),
		absences: data.absences.filter((a) => isActiveAbsence(a) && covers(a, date)),
		plan: data.plan.find((p) => p.date === date) ?? null,
		evaluation: data.days.find((d) => d.date === date) ?? null
	};
}

/** The whole-year spans a date range touches (holidays are requested per year). */
export function yearsOf(from: string, to: string): number[] {
	const years: number[] = [];
	for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
	return years;
}

/** "03.04." from an ISO date, or "31.03." from MM-DD. */
export function formatDayMonth(value: string): string {
	const [month, day] = value.length === 5 ? value.split('-') : value.slice(5).split('-');
	return `${day}.${month}.`;
}

/** "31.03." / "31.3" -> "03-31"; null for invalid input. */
export function parseDayMonth(input: string): string | null {
	const match = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(input.trim());
	if (!match) return null;
	const day = Number(match[1]);
	const month = Number(match[2]);
	if (month < 1 || month > 12 || day < 1 || day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return null;
	return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whether the user has to work on a day, for tile backgrounds (P5). */
export type DayWorkState = 'work' | 'free' | 'vacation_booked' | 'vacation_planned' | 'sick' | 'absence';

type ModelLike = Pick<WorkModel, 'validFrom' | 'validTo' | 'workdays' | 'dailyTargetSeconds'>;

/** Work model valid on a date (open end allowed); the latest start wins. */
export function modelOn(date: string, models: ModelLike[]): ModelLike | null {
	return models.filter((m) => m.validFrom <= date && (!m.validTo || date <= m.validTo)).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0] ?? null;
}

/**
 * Classification for the tile background. Precedence: absence > holiday > non-working day > working day.
 * School holidays do not free the day. Without a valid work model Monday to Friday count as working days.
 */
export function dayWorkState(info: DayInfo, models: ModelLike[]): DayWorkState {
	const absence = info.absences[0];
	if (absence) {
		if (absence.kind === 'vacation') return absence.status === 'approved' || absence.status === 'taken' ? 'vacation_booked' : 'vacation_planned';
		return absence.kind === 'sick' ? 'sick' : 'absence';
	}
	if (info.holidays.length > 0) return 'free';
	const weekday = isoWeekday(info.date);
	const model = modelOn(info.date, models);
	if (!(model ? model.workdays : [1, 2, 3, 4, 5]).includes(weekday)) return 'free';
	if (model?.dailyTargetSeconds?.[String(weekday)] === 0) return 'free';
	return 'work';
}
