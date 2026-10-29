import type { Absence } from '#lib/api/types.js';
import { dayInfo, dayWorkState, type CalendarData, type DayInfo } from './calendar.js';

/**
 * View model of one month cell (C2, U1: no mini timelines any more): everything the cell needs to draw, computed once per day from the loaded data so
 * the component stays a thin template and the rules can be unit tested.
 */

/** How a day is covered by vacation: open (planned/requested: hatched) or booked (approved/taken: solid). */
export type VacationLook = 'none' | 'open' | 'booked';

export interface CellModel {
	date: string;
	vacation: VacationLook;
	/** Half day vacation (first or last day of a half-day absence) */
	vacationHalf: boolean;
	sick: boolean;
	/** Excused or other absence */
	otherAbsence: boolean;
	holiday: 'none' | 'full' | 'half';
	schoolHoliday: boolean;
	/** Weekend or other non-working day without absence */
	free: boolean;
	workedSeconds: number;
}

export function isHalfDay(absence: Absence, date: string): boolean {
	return !!((absence.halfDayStart && absence.startDate === date) || (absence.halfDayEnd && absence.endDate === date));
}

export function cellModel(info: DayInfo, models: Parameters<typeof dayWorkState>[1]): CellModel {
	const vacations = info.absences.filter((a) => a.kind === 'vacation');
	const booked = vacations.some((a) => a.status === 'approved' || a.status === 'taken');
	const state = dayWorkState(info, models);
	return {
		date: info.date,
		vacation: vacations.length === 0 ? 'none' : booked ? 'booked' : 'open',
		vacationHalf: vacations.some((a) => isHalfDay(a, info.date)),
		sick: info.absences.some((a) => a.kind === 'sick'),
		otherAbsence: info.absences.some((a) => a.kind === 'excused' || a.kind === 'other'),
		holiday: info.holidays.length === 0 ? 'none' : info.holidays.some((h) => h.companyTreatment === 'half') && info.holidays.every((h) => h.companyTreatment === 'half') ? 'half' : 'full',
		schoolHoliday: info.schoolHolidays.length > 0,
		free: state === 'free' && info.absences.length === 0 && info.holidays.length === 0,
		workedSeconds: info.evaluation && info.evaluation.evaluatedWorkSeconds > 0 ? info.evaluation.evaluatedWorkSeconds : 0
	};
}

export interface MonthSummary {
	/** Worked and credited seconds of the days of the month */
	actualSeconds: number;
	/** Soll of the whole month */
	targetSeconds: number;
	/** Soll up to and including today (the whole Soll for past months, none for future ones) */
	targetToDateSeconds: number;
	/** Ist minus Soll up to today */
	balanceSeconds: number;
	/** Working days with approved or taken vacation (half days count 0.5) */
	vacationBooked: number;
	/** Working days with planned or requested vacation */
	vacationOpen: number;
	/** Days with sickness */
	sickDays: number;
	/** True when every day of the month has an evaluation; otherwise the sums are incomplete */
	complete: boolean;
}

/** Totals of a month from the loaded data; `dates` are the days of the month (not the dimmed days of the grid). */
export function monthSummary(dates: string[], data: CalendarData, models: Parameters<typeof dayWorkState>[1], today: string): MonthSummary {
	const byDate = new Map(data.days.map((d) => [d.date, d]));
	let actual = 0;
	let target = 0;
	let targetToDate = 0;
	let vacationBooked = 0;
	let vacationOpen = 0;
	let sickDays = 0;
	let covered = 0;
	for (const date of dates) {
		const evaluation = byDate.get(date);
		if (evaluation) {
			covered++;
			actual += evaluation.evaluatedWorkSeconds + evaluation.creditSeconds;
			target += evaluation.targetSeconds;
			if (date <= today) targetToDate += evaluation.targetSeconds;
		}
		const info = dayInfo(date, data);
		if (info.absences.some((a) => a.kind === 'sick')) sickDays++;
		const vacations = info.absences.filter((a) => a.kind === 'vacation');
		if (vacations.length > 0 && dayWorkState({ ...info, absences: [] }, models) === 'work') {
			const half = vacations.every((a) => isHalfDay(a, date)) ? 0.5 : 1;
			if (vacations.some((a) => a.status === 'approved' || a.status === 'taken')) vacationBooked += half;
			else vacationOpen += half;
		}
	}
	return { actualSeconds: actual, targetSeconds: target, targetToDateSeconds: targetToDate, balanceSeconds: actual - targetToDate, vacationBooked, vacationOpen, sickDays, complete: covered === dates.length };
}

/** Heat level 0..4 of a day for the year overview, from worked time against the Soll. */
export function heatLevel(workedSeconds: number, targetSeconds: number): 0 | 1 | 2 | 3 | 4 {
	if (workedSeconds <= 0) return 0;
	const ratio = targetSeconds > 0 ? workedSeconds / targetSeconds : 1;
	if (ratio < 0.5) return 1;
	if (ratio < 0.9) return 2;
	if (ratio <= 1.1) return 3;
	return 4;
}


