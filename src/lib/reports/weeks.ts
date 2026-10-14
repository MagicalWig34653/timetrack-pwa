import { addDays, isoWeekday, startOfWeek } from '../time/dates';

/** ISO 8601 weeks (Monday to Sunday; week 1 contains the first Thursday of the year). */
export interface IsoWeek {
	year: number;
	week: number;
}

/** ISO week-numbering year and week of a local date ("2026-12-31" -> 2026-W53, "2027-01-01" -> 2026-W53). */
export function isoWeekOf(date: string): IsoWeek {
	const thursday = addDays(date, 4 - isoWeekday(date));
	const year = Number(thursday.slice(0, 4));
	const jan1 = `${year}-01-01`;
	const dayOfYear = Math.round((Date.parse(thursday) - Date.parse(jan1)) / 86_400_000);
	return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

/** 53 for years whose 1 January is a Thursday, or a Wednesday in leap years; otherwise 52. */
export function isoWeeksInYear(year: number): 52 | 53 {
	return isoWeekOf(`${year}-12-28`).week === 53 ? 53 : 52;
}

export function isValidIsoWeek(year: number, week: number): boolean {
	return Number.isInteger(year) && Number.isInteger(week) && year >= 1000 && year <= 9999 && week >= 1 && week <= isoWeeksInYear(year);
}

/** Monday of the given ISO week. */
export function weekStartDate(year: number, week: number): string {
	return addDays(startOfWeek(`${year}-01-04`), (week - 1) * 7);
}

/** The seven dates Monday..Sunday. */
export function weekDates(year: number, week: number): string[] {
	const start = weekStartDate(year, week);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Moves by whole weeks and crosses year borders, respecting years with 53 weeks. */
export function shiftWeek({ year, week }: IsoWeek, delta: number): IsoWeek {
	return isoWeekOf(addDays(weekStartDate(year, week), delta * 7));
}

export function compareWeeks(a: IsoWeek, b: IsoWeek): number {
	return a.year !== b.year ? a.year - b.year : a.week - b.week;
}

/** "KW 42/2026" */
export function formatWeekLabel({ year, week }: IsoWeek): string {
	return `KW ${week}/${year}`;
}
