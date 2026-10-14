// Small TypeScript holiday calculator for the mock API only (the real backend has its own built-in calculation, ADR-0005).
// Covers the federal holidays plus the state specifics for the regions the PWA offers; unknown regions fall back to federal.
import { addDays, isoWeekday } from '../src/lib/time/dates.ts';
import type { CalendarDay } from '../src/lib/api/types.ts';

/** Easter Sunday (Gauss/Anonymous Gregorian algorithm) as ISO date. */
export function easterSunday(year: number): string {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Wednesday before 23 November (Buß- und Bettag, Saxony). */
function repentanceDay(year: number): string {
	const nov23 = `${year}-11-23`;
	const offset = ((isoWeekday(nov23) - 3 + 7) % 7) || 7;
	return addDays(nov23, -offset);
}

export const REGIONS: { code: string; name: string }[] = [
	{ code: 'DE-ST', name: 'Sachsen-Anhalt' },
	{ code: 'DE-SN', name: 'Sachsen' },
	{ code: 'DE-BE', name: 'Berlin' },
	{ code: 'DE-BY', name: 'Bayern' },
	{ code: 'DE-BW', name: 'Baden-Württemberg' },
	{ code: 'DE-NW', name: 'Nordrhein-Westfalen' },
	{ code: 'DE', name: 'Bundesweit' }
];

/** Built-in statutory holidays of a region in a year. */
export function holidaysFor(year: number, region = 'DE-ST'): CalendarDay[] {
	const easter = easterSunday(year);
	const day = (date: string, name: string): CalendarDay => ({ id: null, startDate: date, endDate: date, name, kind: 'holiday', source: 'builtin' });
	const list: CalendarDay[] = [
		day(`${year}-01-01`, 'Neujahr'),
		day(addDays(easter, -2), 'Karfreitag'),
		day(addDays(easter, 1), 'Ostermontag'),
		day(`${year}-05-01`, 'Tag der Arbeit'),
		day(addDays(easter, 39), 'Christi Himmelfahrt'),
		day(addDays(easter, 50), 'Pfingstmontag'),
		day(`${year}-10-03`, 'Tag der Deutschen Einheit'),
		day(`${year}-12-25`, '1. Weihnachtstag'),
		day(`${year}-12-26`, '2. Weihnachtstag')
	];
	if (['DE-ST', 'DE-BW', 'DE-BY'].includes(region)) list.push(day(`${year}-01-06`, 'Heilige Drei Könige'));
	if (region === 'DE-BE') list.push(day(`${year}-03-08`, 'Internationaler Frauentag'));
	if (['DE-ST', 'DE-SN'].includes(region)) list.push(day(`${year}-10-31`, 'Reformationstag'));
	if (['DE-BW', 'DE-BY', 'DE-NW'].includes(region)) {
		list.push(day(addDays(easter, 60), 'Fronleichnam'));
		list.push(day(`${year}-11-01`, 'Allerheiligen'));
	}
	if (region === 'DE-BY') list.push(day(`${year}-08-15`, 'Mariä Himmelfahrt'));
	if (region === 'DE-SN') list.push(day(repentanceDay(year), 'Buß- und Bettag'));
	return list.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
