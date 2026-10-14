/** Vacation amounts travel as integer half days (30 days = 60); the UI shows days with halves ("12,5 Tage"). */

function plural(whole: number, half: boolean): string {
	return whole === 1 && !half ? 'Tag' : 'Tage';
}

/** 25 -> "12,5 Tage"; 2 -> "1 Tag"; 1 -> "0,5 Tage"; -3 -> "-1,5 Tage". */
export function formatHalfDays(halfDays: number): string {
	const sign = halfDays < 0 ? '-' : '';
	const abs = Math.abs(Math.trunc(halfDays));
	const whole = Math.floor(abs / 2);
	const half = abs % 2 === 1;
	return `${sign}${whole}${half ? ',5' : ''} ${plural(whole, half)}`;
}

/** Like formatHalfDays but with an explicit "+" for positive values (adjustments). */
export function formatHalfDaysSigned(halfDays: number): string {
	return halfDays > 0 ? `+${formatHalfDays(halfDays)}` : formatHalfDays(halfDays);
}

/** Number part only: 25 -> "12,5" (for input fields). */
export function halfDaysToInput(halfDays: number): string {
	const sign = halfDays < 0 ? '-' : '';
	const abs = Math.abs(Math.trunc(halfDays));
	return `${sign}${Math.floor(abs / 2)}${abs % 2 === 1 ? ',5' : ''}`;
}

/** "12,5" / "12.5" / "12" / "-1,5" -> half days; null for anything that is not a multiple of 0,5. */
export function parseDaysInput(input: string, options: { allowNegative?: boolean } = {}): number | null {
	const match = /^([+-])?(\d{1,4})(?:[.,]([05]))?$/.exec(input.trim());
	if (!match) return null;
	if (match[1] === '-' && !options.allowNegative) return null;
	const halfDays = Number(match[2]) * 2 + (match[3] === '5' ? 1 : 0);
	return match[1] === '-' ? -halfDays : halfDays;
}
