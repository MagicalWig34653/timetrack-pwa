// Pure helpers of the vacation planner page: filter persistence, display filtering, vacation blocks to book, timeline cells.
import type { VacationConflictType, VacationSuggestion } from '#lib/api/types.js';
import { t } from '#lib/i18n/index.js';
import { addMonths } from '#lib/planning/calendar.js';
import { addDays, formatDateShort, isoWeekday, isValidDate } from '#lib/time/dates.js';

export const FILTER_STORAGE_KEY = 'timetrack.vacation-planner.filters';
/** Efficiency below this is a filler window (a few vacation days for hardly more days off) and hidden by default. */
export const DEFAULT_MIN_EFFICIENCY = 2;
/** The backend answers at most 100 suggestions; the page requests all of them and shows the best `count` after filtering. */
export const FETCH_LIMIT = 100;

export interface PlannerFilters {
	from: string;
	to: string;
	maxVacationDays: number;
	minDaysOff: number;
	minEfficiency: number;
	count: number;
}

export function defaultFilters(today: string): PlannerFilters {
	return { from: today, to: `${Number(today.slice(0, 4)) + 1}-12-31`, maxVacationDays: 10, minDaysOff: 4, minEfficiency: DEFAULT_MIN_EFFICIENCY, count: 10 };
}

const intIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** Backend rule: at most 18 months, `to` not before `from`. */
export function rangeValid(from: string, to: string): boolean {
	if (!isValidDate(from) || !isValidDate(to) || to < from) return false;
	return to <= addMonthsKeepDay(from, 18);
}

function addMonthsKeepDay(date: string, months: number): string {
	const first = addMonths(`${date.slice(0, 7)}-01`, months);
	const day = Math.min(Number(date.slice(8, 10)), Number(addDays(addMonths(first, 1), -1).slice(8, 10)));
	return `${first.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

export function filtersValid(f: PlannerFilters): boolean {
	return (
		rangeValid(f.from, f.to) &&
		intIn(f.maxVacationDays, 1, 60) &&
		intIn(f.minDaysOff, 1, 60) &&
		intIn(f.count, 1, 100) &&
		typeof f.minEfficiency === 'number' &&
		f.minEfficiency >= 1 &&
		f.minEfficiency <= 10
	);
}

/** Reads the remembered filters; anything broken or a range that already ended falls back to the defaults. Never throws. */
export function loadFilters(today: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): PlannerFilters {
	const fallback = defaultFilters(today);
	try {
		const raw = storage?.getItem(FILTER_STORAGE_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as Partial<PlannerFilters>;
		const merged: PlannerFilters = { ...fallback, ...pick(parsed) };
		if (merged.to < today) {
			merged.from = fallback.from;
			merged.to = fallback.to;
		} else if (merged.from < today) merged.from = today;
		return filtersValid(merged) ? merged : fallback;
	} catch {
		return fallback;
	}
}

function pick(raw: Partial<PlannerFilters>): Partial<PlannerFilters> {
	const out: Partial<PlannerFilters> = {};
	if (typeof raw.from === 'string') out.from = raw.from;
	if (typeof raw.to === 'string') out.to = raw.to;
	for (const key of ['maxVacationDays', 'minDaysOff', 'minEfficiency', 'count'] as const) if (typeof raw[key] === 'number') out[key] = raw[key];
	return out;
}

export function saveFilters(filters: PlannerFilters, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
	try {
		storage?.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
	} catch {
		/* private window or blocked storage: the filters just are not remembered */
	}
}

export function clearFilters(storage: Pick<Storage, 'removeItem'> | null = safeStorage()): void {
	try {
		storage?.removeItem(FILTER_STORAGE_KEY);
	} catch {
		/* ignore */
	}
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** Best `count` suggestions with at least `minEfficiency`; `hidden` is the number of suggestions removed by the efficiency filter. */
export function visibleSuggestions(all: VacationSuggestion[], minEfficiency: number, count: number): { shown: VacationSuggestion[]; hidden: number } {
	const kept = all.filter((s) => s.efficiency >= minEfficiency);
	return { shown: kept.slice(0, count), hidden: all.length - kept.length };
}

/**
 * Vacation blocks to book for a suggestion: consecutive vacation dates form one block as long as only weekends, holidays or other
 * free days lie between them. A day that is already booked as vacation splits the block (one absence must not overlap another).
 * The absence covers the first to the last vacation date of the block; the server books work days only.
 */
export function vacationBlocks(suggestion: Pick<VacationSuggestion, 'vacationDates' | 'conflicts'>): { start: string; end: string; dates: string[] }[] {
	const booked = new Set(suggestion.conflicts.filter((c) => c.type === 'already_vacation').map((c) => c.date));
	const dates = [...suggestion.vacationDates].sort();
	const blocks: { start: string; end: string; dates: string[] }[] = [];
	for (const date of dates) {
		const last = blocks[blocks.length - 1];
		if (last && !spansBooked(last.end, date, booked)) {
			last.end = date;
			last.dates.push(date);
		} else blocks.push({ start: date, end: date, dates: [date] });
	}
	return blocks;
}

function spansBooked(from: string, to: string, booked: Set<string>): boolean {
	for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) if (booked.has(d)) return true;
	return false;
}

export type TimelineKind = 'vacation' | 'holiday' | 'weekend' | 'booked' | 'free';

export interface TimelineCell {
	date: string;
	kind: TimelineKind;
	/** weekday letter, Monday first */
	weekday: string;
	day: number;
	label: string;
	conflict: VacationConflictType | null;
}

const WEEKDAY_LETTERS = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

export function conflictLabel(type: VacationConflictType): string {
	return t(`planner.conflict.${type}`);
}

/** One cell per calendar day from start to end for the mini-calendar strip. */
export function timelineCells(s: VacationSuggestion): TimelineCell[] {
	const vacation = new Set(s.vacationDates);
	const holidays = new Map(s.holidays.map((h) => [h.date, h.name]));
	const conflictOf = new Map<string, VacationConflictType>();
	for (const c of s.conflicts) if (c.type !== 'already_vacation' || !conflictOf.has(c.date)) conflictOf.set(c.date, c.type);
	const booked = new Set(s.conflicts.filter((c) => c.type === 'already_vacation').map((c) => c.date));
	const cells: TimelineCell[] = [];
	for (let date = s.start; date <= s.end; date = addDays(date, 1)) {
		const weekday = isoWeekday(date);
		let kind: TimelineKind;
		let label: string;
		if (holidays.has(date)) [kind, label] = ['holiday', t('planner.day_holiday', { name: holidays.get(date)! })];
		else if (vacation.has(date)) [kind, label] = ['vacation', t('planner.day_vacation')];
		else if (booked.has(date)) [kind, label] = ['booked', t('planner.day_booked')];
		else if (weekday >= 6) [kind, label] = ['weekend', t('planner.day_weekend')];
		else [kind, label] = ['free', t('planner.day_weekend')];
		const conflict = conflictOf.get(date) ?? null;
		cells.push({
			date,
			kind,
			weekday: WEEKDAY_LETTERS[weekday - 1],
			day: Number(date.slice(8, 10)),
			label: `${formatDateShort(date)}: ${label}${conflict && conflict !== 'already_vacation' ? `. ${t('planner.day_conflict', { label: conflictLabel(conflict) })}` : ''}`,
			conflict: conflict && conflict !== 'already_vacation' ? conflict : null
		});
	}
	return cells;
}

const deNumber = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** 2.75 -> "2,8"; 4 -> "4". */
export function formatFactor(value: number): string {
	return deNumber.format(value);
}

/** Whole or half days: 1 -> "1 Tag", 12.5 -> "12,5 Tage", -0.5 -> "-0,5 Tage". */
export function formatDays(days: number): string {
	return `${deNumber.format(days)} ${days === 1 ? 'Tag' : 'Tage'}`;
}

export function vacationDaysText(count: number): string {
	return count === 1 ? t('planner.vacation_days_one') : t('planner.vacation_days', { count });
}

export function offDaysText(count: number): string {
	return count === 1 ? t('planner.off_days_one') : t('planner.off_days', { count });
}
