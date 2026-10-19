import type { CalendarDay, WorkModel } from '../api/types';
import { modelOn } from '../planning/calendar';
import { addDays, isoWeekday } from '../time/dates';

type ModelLike = Pick<WorkModel, 'validFrom' | 'validTo' | 'workdays' | 'dailyTargetSeconds'>;
type HolidayLike = Pick<CalendarDay, 'startDate' | 'endDate' | 'kind'>;

export interface DateRange {
	from: string;
	to: string;
}

/** Why a day inside a request span is not a working day. */
export type FreeReason = 'weekend' | 'holiday' | 'non_working';

/** Every ISO date of an inclusive span; empty when `to` lies before `from`. */
export function datesBetween(from: string, to: string): string[] {
	const dates: string[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) {
		dates.push(date);
		if (dates.length > 800) break; // a request spans weeks, never years; protects against bad input
	}
	return dates;
}

const isHoliday = (date: string, holidays: HolidayLike[]) => holidays.some((h) => h.kind === 'holiday' && h.startDate <= date && date <= h.endDate);

/**
 * Whether the day is a working day by the work model valid on that date (no model: Monday to Friday) and no public
 * holiday. School holidays do not free a day. Returns null for a working day, else the reason.
 */
export function freeReason(date: string, models: ModelLike[], holidays: HolidayLike[]): FreeReason | null {
	if (isHoliday(date, holidays)) return 'holiday';
	const weekday = isoWeekday(date);
	const model = modelOn(date, models);
	const workdays = model ? model.workdays : [1, 2, 3, 4, 5];
	if (!workdays.includes(weekday)) return weekday >= 6 ? 'weekend' : 'non_working';
	if (model?.dailyTargetSeconds?.[String(weekday)] === 0) return 'non_working';
	return null;
}

/** Days of the span that are not working days (weekends, holidays, days the work model leaves free). */
export function freeDaysInSpan(from: string, to: string, models: ModelLike[], holidays: HolidayLike[]): string[] {
	return datesBetween(from, to).filter((date) => freeReason(date, models, holidays) !== null);
}

/** Merges dates into ranges of consecutive calendar days. */
export function mergeIntoRanges(dates: string[]): DateRange[] {
	const sorted = [...new Set(dates)].sort();
	const ranges: DateRange[] = [];
	for (const date of sorted) {
		const last = ranges.at(-1);
		if (last && addDays(last.to, 1) === date) last.to = date;
		else ranges.push({ from: date, to: date });
	}
	return ranges;
}

/**
 * Working days in the span (public holidays and free weekdays excluded). A half day at the start or end removes half a
 * day when that day is a working day; both flags on a one-day span count once.
 */
export function countWorkingDays(from: string, to: string, models: ModelLike[], holidays: HolidayLike[], halfDayStart = false, halfDayEnd = false): number {
	const days = datesBetween(from, to);
	let total = days.filter((date) => freeReason(date, models, holidays) === null).length;
	const halves = new Set<string>();
	if (halfDayStart) halves.add(from);
	if (halfDayEnd) halves.add(to);
	for (const date of halves) if (days.includes(date) && freeReason(date, models, holidays) === null) total -= 0.5;
	return total;
}

/**
 * Fits ranges into `slots` places of a form. When there are more ranges than places, the overflow is reported so the
 * dialog can warn instead of silently dropping days.
 */
export function fitRanges(ranges: DateRange[], slots: number): { shown: DateRange[]; overflow: DateRange[] } {
	return { shown: ranges.slice(0, slots), overflow: ranges.slice(slots) };
}
