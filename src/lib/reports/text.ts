import { formatDateNumeric } from '../time/dates';
import { formatDuration } from '../time/format';
import { weekDates, type IsoWeek } from './weeks';

/**
 * Standard text format of ADR-0008 (`GET /reports/weeks/{year}/{week}/text`): per day lines
 * `<Lernfeld> | <h:mm> h | <Notiz>`, then the week total. The real server renders this; the mock and the tests use this port.
 * Layout details beyond the line format are an assumption (the ADR leaves the profile open):
 * a header line, one block per day that has entries, notes on one line, a blank line between blocks.
 */
export interface TextEntry {
	date: string;
	learningField: string;
	durationSeconds?: number;
	notes?: string;
}

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function formatWeekText(week: IsoWeek, entries: TextEntry[]): string {
	const dates = weekDates(week.year, week.week);
	const lines = [`Berichtsheft KW ${week.week}/${week.year} (${formatDateNumeric(dates[0])} – ${formatDateNumeric(dates[6])})`];
	let total = 0;
	dates.forEach((date, index) => {
		const ofDay = entries.filter((e) => e.date === date);
		if (ofDay.length === 0) return;
		lines.push('', `${WEEKDAYS[index]}, ${formatDateNumeric(date)}`);
		for (const e of ofDay) {
			const seconds = e.durationSeconds ?? 0;
			total += seconds;
			const note = (e.notes ?? '').replace(/\s+/g, ' ').trim();
			lines.push(`${e.learningField} | ${formatDuration(seconds)} h | ${note}`.trimEnd());
		}
	});
	lines.push('', `Wochensumme: ${formatDuration(total)} h`);
	return lines.join('\n') + '\n';
}
