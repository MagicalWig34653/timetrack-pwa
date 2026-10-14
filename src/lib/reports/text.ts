import { formatDateNumeric } from '../time/dates.ts';
import { formatDuration } from '../time/format.ts';
import { weekDates, type IsoWeek } from './weeks.ts';

/**
 * Port of the real server rendering (C15 `ReportText.render`, `GET /reports/weeks/{year}/{week}/text`), used by the mock and tests only:
 * header, blank line, one block per day with entries (`<Wochentag>, <TT.MM.JJJJ>` and lines `<Lernfeld> | <h:mm> h | <Notiz>`),
 * a blank line after every block, `Summe: <h:mm> h`, trailing newline. An empty note omits the last ` | ` part; line breaks
 * (LF, CR, CRLF, NEL, U+2028/2029) in notes and field names become ` / `, empty lines are dropped. Minutes are truncated.
 */
export interface TextEntry {
	date: string;
	learningField: string;
	durationSeconds?: number;
	notes?: string;
}

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Mirrors `ReportText.singleLine`: split at line breaks, trim blanks, drop empty lines, join with ` / `. */
export function singleLine(text: string): string {
	return text
		.split(/\r\n|[\n\r\u0085\u2028\u2029]/)
		.map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ''))
		.filter((line) => line !== '')
		.join(' / ');
}

export function formatWeekText(week: IsoWeek, entries: TextEntry[]): string {
	const dates = weekDates(week.year, week.week);
	const lines = [`Berichtsheft KW ${week.week}/${week.year} (${formatDateNumeric(dates[0])} – ${formatDateNumeric(dates[6])})`, ''];
	let total = 0;
	dates.forEach((date, index) => {
		const ofDay = entries.filter((e) => e.date === date);
		if (ofDay.length === 0) return;
		lines.push(`${WEEKDAYS[index]}, ${formatDateNumeric(date)}`);
		for (const e of ofDay) {
			const seconds = e.durationSeconds ?? 0;
			total += seconds;
			const note = singleLine(e.notes ?? '');
			lines.push(`${singleLine(e.learningField)} | ${formatDuration(seconds)} h${note ? ` | ${note}` : ''}`);
		}
		lines.push('');
	});
	lines.push(`Summe: ${formatDuration(total)} h`);
	return lines.join('\n') + '\n';
}
