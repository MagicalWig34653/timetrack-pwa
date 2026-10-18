// Pure mock of the vacation suggestion engine (contract v0.22.0, ADR-0025 in the backend repo). Simplified compared to the Swift
// engine but shaped alike: free blocks (weekends, holidays, non-work days) are chained with the work days between them; the ranking is
// efficiency, then total days off, then start. Suggestions never overlap and already-booked vacation is never suggested again.
import { isoWeekday } from '../src/lib/time/dates.ts';
import type { VacationSuggestion, VacationSuggestionConflict } from '../src/lib/api/types.ts';
import { daysBetween } from './evaluate.ts';

export interface SuggestionInput {
	from: string;
	to: string;
	maxVacationDays: number;
	minDaysOff: number;
	limit: number;
	/** ISO weekdays (1 = Monday) that are work days of the model */
	workdays: (date: string) => number[];
	holidays: Map<string, string>;
	schoolHolidays: { startDate: string; endDate: string; name: string }[];
	/** vacation days that are already booked or planned (never suggested again) */
	vacationDates: Set<string>;
	/** other absences (sick, excused, other) */
	absenceDates: Set<string>;
	planDates: Map<string, string>;
	/** remaining days per calendar year (after planned vacation) */
	remainingOfYear: (year: number) => number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function suggestVacation(input: SuggestionInput): VacationSuggestion[] {
	const days = daysBetween(input.from, input.to);
	if (days.length === 0) return [];
	const isFree = (date: string) => input.holidays.has(date) || !input.workdays(date).includes(isoWeekday(date));
	// Free blocks inside the range as [startIndex, endIndex].
	const blocks: [number, number][] = [];
	for (let i = 0; i < days.length; i++) {
		if (!isFree(days[i])) continue;
		const start = i;
		while (i + 1 < days.length && isFree(days[i + 1])) i++;
		blocks.push([start, i]);
	}
	interface Candidate extends VacationSuggestion {
		startIndex: number;
		endIndex: number;
	}
	const candidates: Candidate[] = [];
	for (let a = 0; a < blocks.length; a++) {
		let cost = 0;
		for (let b = a + 1; b < blocks.length; b++) {
			const gap = days.slice(blocks[b - 1][1] + 1, blocks[b][0]);
			cost += gap.filter((d) => !input.vacationDates.has(d)).length;
			if (cost > input.maxVacationDays) break;
			// Already-booked gaps cost nothing, but a window that needs no vacation day at all is not a suggestion.
			if (cost === 0) continue;
			const startIndex = blocks[a][0];
			const endIndex = blocks[b][1];
			const window = days.slice(startIndex, endIndex + 1);
			if (window.length < input.minDaysOff) continue;
			const vacationDates = window.filter((d) => !isFree(d) && !input.vacationDates.has(d));
			const holidays = window.filter((d) => input.holidays.has(d)).map((date) => ({ date, name: input.holidays.get(date)! }));
			const schoolHolidays = input.schoolHolidays.filter((s) => s.startDate <= window[window.length - 1] && s.endDate >= window[0]);
			const conflicts: VacationSuggestionConflict[] = [];
			for (const date of window) {
				if (input.vacationDates.has(date) && !isFree(date)) conflicts.push({ date, type: 'already_vacation' });
				if (isFree(date)) continue;
				if (input.absenceDates.has(date)) conflicts.push({ date, type: 'absence' });
				const mode = input.planDates.get(date);
				if (mode === 'school') conflicts.push({ date, type: 'school_day' });
				else if (mode && mode !== 'off') conflicts.push({ date, type: 'plan' });
			}
			const kind = schoolHolidays.length > 0 ? 'school_holiday_extension' : holidays.length === 0 ? 'long_break' : vacationDates.length <= 2 ? 'bridge' : 'holiday_cluster';
			const needed = vacationDates.length;
			const startYear = Number(window[0].slice(0, 4));
			const perYear = new Map<number, number>();
			for (const d of vacationDates) perYear.set(Number(d.slice(0, 4)), (perYear.get(Number(d.slice(0, 4))) ?? 0) + 1);
			const fitsBudget = [...perYear].every(([year, used]) => used <= input.remainingOfYear(year));
			candidates.push({
				id: hashId(window[0], window[window.length - 1], vacationDates),
				kind,
				start: window[0],
				end: window[window.length - 1],
				vacationDates,
				vacationDaysNeeded: needed,
				totalDaysOff: window.length,
				efficiency: round2(window.length / needed),
				holidays,
				schoolHolidays,
				conflicts,
				fitsBudget,
				remainingAfter: input.remainingOfYear(startYear) - (perYear.get(startYear) ?? 0),
				startIndex,
				endIndex
			});
		}
	}
	candidates.sort((x, y) => y.efficiency - x.efficiency || y.totalDaysOff - x.totalDaysOff || x.start.localeCompare(y.start));
	const taken: Candidate[] = [];
	for (const c of candidates) {
		if (taken.length >= input.limit) break;
		if (taken.some((t) => t.startIndex <= c.endIndex && c.startIndex <= t.endIndex)) continue;
		taken.push(c);
	}
	return taken.map(({ startIndex: _s, endIndex: _e, ...suggestion }) => suggestion);
}

/** Stable 16 hex characters from start, end and vacation dates (FNV-1a twice, no crypto needed in the mock). */
function hashId(start: string, end: string, dates: string[]): string {
	const text = [start, end, ...dates].join('|');
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < text.length; i++) {
		h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193);
		h2 = Math.imul(h2 + text.charCodeAt(i), 0x85ebca6b) ^ (h2 >>> 13);
	}
	return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
}
