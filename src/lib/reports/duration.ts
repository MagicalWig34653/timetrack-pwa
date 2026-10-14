/** Parsing of the report duration input. The API stores whole seconds; the UI shows h:mm. */

export type DurationKind = 'empty' | 'clock' | 'decimal' | 'hours';

export interface ParsedDuration {
	seconds: number;
	kind: DurationKind;
}

export const MAX_ENTRY_SECONDS = 86_400;

/**
 * Accepts
 *  - "1:30", "01:30", "0:45"            h:mm (minutes 00-59)
 *  - "1,5", "1.5", "7,7", ",5"          decimal hours (German comma or dot); rounded to whole minutes
 *  - "2"                                whole hours
 *  - ""                                 empty = 0 (the duration is optional)
 * Returns null for anything else and for values above 24 h.
 * "7,7" is 7 h 42 min (7.7 h), not 7:07 - the form shows the parsed h:mm live for exactly that reason.
 */
export function parseReportDuration(input: string): ParsedDuration | null {
	const text = input.trim();
	if (text === '') return { seconds: 0, kind: 'empty' };

	const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
	if (clock) return within({ seconds: Number(clock[1]) * 3600 + Number(clock[2]) * 60, kind: 'clock' });

	const decimal = /^(\d{0,2})[,.](\d{1,2})$/.exec(text);
	if (decimal && (decimal[1] !== '' || decimal[2] !== '')) {
		const hours = Number(`${decimal[1] || '0'}.${decimal[2]}`);
		return within({ seconds: Math.round(hours * 60) * 60, kind: 'decimal' });
	}

	if (/^\d{1,2}$/.test(text)) return within({ seconds: Number(text) * 3600, kind: 'hours' });
	return null;
}

function within(parsed: ParsedDuration): ParsedDuration | null {
	return parsed.seconds <= MAX_ENTRY_SECONDS ? parsed : null;
}

/** Initial text for the input when editing: 5400 -> "1:30", 0 -> "". */
export function durationInputValue(seconds: number | undefined): string {
	if (!seconds) return '';
	const minutes = Math.round(seconds / 60);
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
