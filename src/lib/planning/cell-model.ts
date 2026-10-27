import type { Absence, DayEvaluation, PlanBlockKind, PlanDay } from '#lib/api/types.js';
import { localMinutesOf } from '#lib/time/dates.js';
import { dayInfo, dayWorkState, type CalendarData, type DayInfo } from './calendar.js';

/**
 * View model of one month cell (C2): everything the cell needs to draw, computed once per day from the loaded data so
 * the component stays a thin template and the rules can be unit tested.
 */

/** Window of the mini timeline in minutes since midnight; plan and tracked times outside are clamped to its edges. */
export const LINE_START_MIN = 6 * 60;
export const LINE_END_MIN = 22 * 60;

export interface LineBar {
	kind: PlanBlockKind;
	/** Percent from the left edge of the mini timeline */
	left: number;
	/** Percent of the timeline width, at least {@link MIN_WIDTH} so short blocks stay visible */
	width: number;
}

const MIN_WIDTH = 3;

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Percent position of a minute-of-day range inside the timeline window; null when it lies completely outside. */
export function lineSpan(startMin: number, endMin: number): { left: number; width: number } | null {
	if (!(endMin > startMin)) return null;
	const start = Math.max(LINE_START_MIN, startMin);
	const end = Math.min(LINE_END_MIN, endMin);
	if (end <= start) return null;
	const total = LINE_END_MIN - LINE_START_MIN;
	const left = ((start - LINE_START_MIN) / total) * 100;
	const width = Math.max(MIN_WIDTH, ((end - start) / total) * 100);
	return { left: round(Math.min(left, 100 - width)), width: round(width) };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The plan blocks of a day as bars: the block list, else the rough window in the plan's mode; none for a free plan. */
export function planBars(plan: PlanDay | null): LineBar[] {
	if (!plan) return [];
	const bars: LineBar[] = [];
	if (plan.blocks && plan.blocks.length > 0) {
		for (const block of plan.blocks) {
			const span = lineSpan(toMinutes(block.start), toMinutes(block.end));
			if (span) bars.push({ kind: block.kind, ...span });
		}
	} else if (plan.mode !== 'off' && plan.plannedStart && plan.plannedEnd) {
		const span = lineSpan(toMinutes(plan.plannedStart), toMinutes(plan.plannedEnd));
		if (span) bars.push({ kind: plan.mode, ...span });
	}
	return bars;
}

/** Tracked time from the first start to the last end of the day's evaluation, in the user's time zone. */
export function actualBar(evaluation: DayEvaluation | null, timeZone: string): { left: number; width: number } | null {
	if (!evaluation?.evaluatedStart || !evaluation.evaluatedEnd || evaluation.evaluatedWorkSeconds <= 0) return null;
	return lineSpan(localMinutesOf(evaluation.evaluatedStart, timeZone), localMinutesOf(evaluation.evaluatedEnd, timeZone));
}

/** How a day is covered by vacation: open (planned/requested: hatched) or booked (approved/taken: solid). */
export type VacationLook = 'none' | 'open' | 'booked';

export interface CellModel {
	date: string;
	plan: LineBar[];
	actual: { left: number; width: number } | null;
	/** Distinct plan kinds of the day in painting order, for the icon row */
	kinds: PlanBlockKind[];
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
	hasTimeline: boolean;
}

const KIND_ORDER: PlanBlockKind[] = ['work', 'school', 'travel', 'office', 'home', 'customer'];

export function isHalfDay(absence: Absence, date: string): boolean {
	return !!((absence.halfDayStart && absence.startDate === date) || (absence.halfDayEnd && absence.endDate === date));
}

export function cellModel(info: DayInfo, models: Parameters<typeof dayWorkState>[1], timeZone: string): CellModel {
	const plan = planBars(info.plan);
	const actual = actualBar(info.evaluation, timeZone);
	const vacations = info.absences.filter((a) => a.kind === 'vacation');
	const booked = vacations.some((a) => a.status === 'approved' || a.status === 'taken');
	const state = dayWorkState(info, models);
	const kinds = KIND_ORDER.filter((k) => plan.some((b) => b.kind === k));
	return {
		date: info.date,
		plan,
		actual,
		kinds,
		vacation: vacations.length === 0 ? 'none' : booked ? 'booked' : 'open',
		vacationHalf: vacations.some((a) => isHalfDay(a, info.date)),
		sick: info.absences.some((a) => a.kind === 'sick'),
		otherAbsence: info.absences.some((a) => a.kind === 'excused' || a.kind === 'other'),
		holiday: info.holidays.length === 0 ? 'none' : info.holidays.some((h) => h.companyTreatment === 'half') && info.holidays.every((h) => h.companyTreatment === 'half') ? 'half' : 'full',
		schoolHoliday: info.schoolHolidays.length > 0,
		free: state === 'free' && info.absences.length === 0 && info.holidays.length === 0,
		workedSeconds: info.evaluation && info.evaluation.evaluatedWorkSeconds > 0 ? info.evaluation.evaluatedWorkSeconds : 0,
		hasTimeline: plan.length > 0 || actual !== null
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


/**
 * The visible text of a compact month cell in reading order: day number, then the chip labels. The accessible name of
 * the cell starts with it (WCAG 2.5.3 Label in Name; axe label-content-name-mismatch), followed by the full description.
 * Must mirror DayChips in compact mode.
 */
export function visibleCellText(info: DayInfo, hidden: Set<string>, labels: { absence: (a: Absence) => string; plan: (p: PlanDay) => string; worked: (seconds: number) => string; holidayHint: (name: string, treatment: string | null | undefined) => string }): string {
	const parts = [String(Number(info.date.slice(8)))];
	if (!hidden.has('holiday')) for (const h of info.holidays) parts.push(h.companyTreatment === 'half' ? `${h.name} ½ ${labels.holidayHint(h.name, 'half')}`.replace(/\s+/g, ' ') : h.name);
	if (!hidden.has('school_holiday')) for (const h of info.schoolHolidays) parts.push(h.name);
	for (const a of info.absences) if (!hidden.has(a.kind)) parts.push(labels.absence(a));
	if (info.plan && !hidden.has('plan')) parts.push(labels.plan(info.plan));
	const worked = info.evaluation && info.evaluation.evaluatedWorkSeconds > 0 ? info.evaluation.evaluatedWorkSeconds : 0;
	if (worked > 0 && !hidden.has('worked')) parts.push(labels.worked(worked));
	return parts.join(' ');
}
