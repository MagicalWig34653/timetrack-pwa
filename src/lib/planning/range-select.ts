import { addDays } from '#lib/time/dates.js';

/** Inclusive ISO date range, start <= end. */
export interface DateRange {
	start: string;
	end: string;
}

/** Orders two dates into a range regardless of drag direction. */
export function normalizeRange(a: string, b: string): DateRange {
	return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/** Number of days in the range, inclusive. */
export function rangeLength(range: DateRange): number {
	return Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** All ISO dates of the range, in order. */
export function rangeDates(range: DateRange): string[] {
	const out: string[] = [];
	for (let d = range.start; d <= range.end; d = addDays(d, 1)) out.push(d);
	return out;
}

export const rangeContains = (range: DateRange, date: string) => range.start <= date && date <= range.end;

/** Shifts a range by whole days (negative = earlier). */
export function shiftRange(range: DateRange, days: number): DateRange {
	return { start: addDays(range.start, days), end: addDays(range.end, days) };
}

/** Whole days from a to b (negative when b is earlier). */
export function dayDiff(a: string, b: string): number {
	return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Set of selected days (multi-select) plus the anchor used for Shift-extension.
 * `dates` is always sorted and free of duplicates.
 */
export interface Selection {
	dates: string[];
	anchor: string | null;
}

export const emptySelection: Selection = { dates: [], anchor: null };

const sortedUnique = (dates: string[]) => [...new Set(dates)].sort();

export function selectOne(date: string): Selection {
	return { dates: [date], anchor: date };
}

/** Shift-click: all days between the anchor and the date (the anchor stays). Without anchor the date alone. */
export function selectRangeTo(selection: Selection, date: string): Selection {
	const anchor = selection.anchor ?? date;
	return { dates: rangeDates(normalizeRange(anchor, date)), anchor };
}

/** Cmd/Ctrl-click: toggles a single day; the toggled day becomes the new anchor when it was added. */
export function toggleDate(selection: Selection, date: string): Selection {
	if (selection.dates.includes(date)) {
		const dates = selection.dates.filter((d) => d !== date);
		return { dates, anchor: selection.anchor === date ? (dates[dates.length - 1] ?? null) : selection.anchor };
	}
	return { dates: sortedUnique([...selection.dates, date]), anchor: date };
}

/** Adds a whole range (drag with Cmd/Ctrl keeps the existing selection). */
export function addRange(selection: Selection, range: DateRange): Selection {
	return { dates: sortedUnique([...selection.dates, ...rangeDates(range)]), anchor: range.start };
}

/** Contiguous runs of the selection, e.g. [Mon..Wed, Fri] -> two ranges. */
export function selectionRuns(dates: string[]): DateRange[] {
	const sorted = sortedUnique(dates);
	const runs: DateRange[] = [];
	for (const date of sorted) {
		const last = runs[runs.length - 1];
		if (last && addDays(last.end, 1) === date) last.end = date;
		else runs.push({ start: date, end: date });
	}
	return runs;
}

/** Outer bounds of a selection, null when empty. */
export function selectionBounds(dates: string[]): DateRange | null {
	if (dates.length === 0) return null;
	const sorted = sortedUnique(dates);
	return { start: sorted[0], end: sorted[sorted.length - 1] };
}

/** Keyboard cursor movement in the month/week grid. */
export type CursorMove = 'left' | 'right' | 'up' | 'down' | 'week-start' | 'week-end' | 'page-up' | 'page-down';

export function moveCursor(date: string, move: CursorMove): string {
	switch (move) {
		case 'left':
			return addDays(date, -1);
		case 'right':
			return addDays(date, 1);
		case 'up':
			return addDays(date, -7);
		case 'down':
			return addDays(date, 7);
		case 'week-start':
			return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
		case 'week-end':
			return addDays(date, 6 - ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
		case 'page-up':
		case 'page-down': {
			const delta = move === 'page-up' ? -1 : 1;
			const [y, m, d] = date.split('-').map(Number);
			const total = y * 12 + (m - 1) + delta;
			const year = Math.floor(total / 12);
			const month = (total % 12) + 1;
			const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
			return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, daysInMonth)).padStart(2, '0')}`;
		}
	}
}
