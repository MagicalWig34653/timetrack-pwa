/** Duration helpers. The API uses whole seconds; the UI always shows h:mm (never decimal hours). */

/** 27720 -> "7:42"; negative values keep the sign: -1080 -> "-0:18". Sub-minute remainders are truncated. */
export function formatDuration(seconds: number): string {
	const totalMinutes = Math.floor(Math.abs(seconds) / 60);
	const sign = seconds < 0 && totalMinutes > 0 ? '-' : '';
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

/** Like formatDuration but with an explicit "+" for positive values (balances and deltas). */
export function formatDelta(seconds: number): string {
	const text = formatDuration(seconds);
	return seconds > 0 && !text.startsWith('-') ? `+${text}` : text;
}

/**
 * Parses "7:42", "-0:18", "+1:05", "0:30" or a bare minute count ("45"). Returns whole seconds or null if invalid.
 * Decimal hours ("7,7") are deliberately rejected.
 */
export function parseDuration(input: string): number | null {
	const text = input.trim();
	const match = /^([+-])?(\d{1,4}):([0-5]\d)$/.exec(text) ?? /^([+-])?(\d{1,5})()$/.exec(text);
	if (!match) return null;
	const sign = match[1] === '-' ? -1 : 1;
	const hasHours = match[3] !== '';
	const seconds = hasHours ? Number(match[2]) * 3600 + Number(match[3]) * 60 : Number(match[2]) * 60;
	return sign * seconds;
}
