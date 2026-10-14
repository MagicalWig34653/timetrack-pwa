/** Timezone-aware date helpers on top of Intl. Local days are "YYYY-MM-DD", instants are ISO-8601 strings / Dates. */

export const DEFAULT_TIMEZONE = 'Europe/Berlin';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		formatters.set(timeZone, f);
	}
	return f;
}

interface Wall {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function wallClock(ms: number, timeZone: string): Wall {
	const out: Record<string, number> = {};
	for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
		if (part.type !== 'literal') out[part.type] = Number(part.value);
	}
	return out as unknown as Wall;
}

/** Offset of the zone at the given instant in ms (wall clock interpreted as UTC minus the instant). */
function offsetMs(ms: number, timeZone: string): number {
	const w = wallClock(ms, timeZone);
	return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toMillis(instant: Date | string | number): number {
	return instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(instant);
}

/** Local calendar day of an instant in the zone. */
export function localDateOf(instant: Date | string | number, timeZone = DEFAULT_TIMEZONE): string {
	const w = wallClock(toMillis(instant), timeZone);
	return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Local wall-clock time "HH:mm" of an instant in the zone. */
export function localTimeOf(instant: Date | string | number, timeZone = DEFAULT_TIMEZONE): string {
	const w = wallClock(toMillis(instant), timeZone);
	return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** Minutes since local midnight (wall clock) of an instant. */
export function localMinutesOf(instant: Date | string | number, timeZone = DEFAULT_TIMEZONE): number {
	const w = wallClock(toMillis(instant), timeZone);
	return w.hour * 60 + w.minute;
}

/**
 * Converts a local date and wall-clock time to the matching instant. Times skipped by the spring-forward gap move forward;
 * ambiguous times in the autumn overlap resolve to the first occurrence.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone = DEFAULT_TIMEZONE): Date {
	const [y, m, d] = date.split('-').map(Number);
	const [hh, mm, ss = 0] = time.split(':').map(Number);
	const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
	let result = guess - offsetMs(guess - 3 * 3600_000, timeZone);
	const second = guess - offsetMs(result, timeZone);
	if (second !== result) {
		// Offset changed between the two probes: take the earlier valid instant (first occurrence / forward shift).
		const candidates = [result, second].sort((a, b) => a - b);
		const valid = candidates.filter((c) => wallClockEquals(c, [y, m, d, hh, mm], timeZone));
		result = valid.length > 0 ? valid[0] : candidates[1];
	}
	return new Date(result);
}

function wallClockEquals(ms: number, expected: number[], timeZone: string): boolean {
	const w = wallClock(ms, timeZone);
	return w.year === expected[0] && w.month === expected[1] && w.day === expected[2] && w.hour === expected[3] && w.minute === expected[4];
}

export function addDays(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number);
	const next = new Date(Date.UTC(y, m - 1, d + days));
	return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** ISO weekday of a local day: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return day === 0 ? 7 : day;
}

export function startOfWeek(date: string): string {
	return addDays(date, 1 - isoWeekday(date));
}

/** Instants bounding a local day: [start, end). */
export function dayBounds(date: string, timeZone = DEFAULT_TIMEZONE): { start: Date; end: Date } {
	return { start: zonedTimeToInstant(date, '00:00', timeZone), end: zonedTimeToInstant(addDays(date, 1), '00:00', timeZone) };
}

/** Real length of a local day in seconds: 82800 (23 h) on spring-forward, 90000 (25 h) on fall-back days. */
export function dayLengthSeconds(date: string, timeZone = DEFAULT_TIMEZONE): number {
	const { start, end } = dayBounds(date, timeZone);
	return (end.getTime() - start.getTime()) / 1000;
}

export function todayLocal(timeZone = DEFAULT_TIMEZONE, now: Date = new Date()): string {
	return localDateOf(now, timeZone);
}

export function compareDates(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function isValidDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	return addDays(value, 0) === value;
}

const longDay = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });

function asUtcDate(date: string): Date {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

/** "Mittwoch, 14.10.2026" */
export function formatDateLong(date: string): string {
	return longDay.format(asUtcDate(date));
}

/** "Mi., 14.10." */
export function formatDateShort(date: string): string {
	return shortDay.format(asUtcDate(date));
}

/** "14.10.2026" */
export function formatDateNumeric(date: string): string {
	const [y, m, d] = date.split('-');
	return `${d}.${m}.${y}`;
}

/** ISO date-time in the zone as the `datetime-local` input value "YYYY-MM-DDTHH:mm". */
export function toLocalInputValue(instant: Date | string, timeZone = DEFAULT_TIMEZONE): string {
	return `${localDateOf(instant, timeZone)}T${localTimeOf(instant, timeZone)}`;
}

/** Inverse of toLocalInputValue; null for empty/invalid input. */
export function fromLocalInputValue(value: string, timeZone = DEFAULT_TIMEZONE): Date | null {
	const match = /^(\d{4}-\d{2}-\d{2})T([0-2]\d:[0-5]\d)$/.exec(value);
	if (!match || !isValidDate(match[1])) return null;
	return zonedTimeToInstant(match[1], match[2], timeZone);
}
