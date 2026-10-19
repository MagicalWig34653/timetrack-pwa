export type DateFormatId = 'dd.MM.yyyy' | 'd.M.yy' | 'iso';

export const DATE_FORMATS: readonly DateFormatId[] = ['dd.MM.yyyy', 'd.M.yy', 'iso'];

/** Formats an ISO date (`2026-07-06`) in one of the supported form styles; unparsable input is returned unchanged. */
export function formatFormDate(iso: string, format: DateFormatId): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return iso;
	const [, year, month, day] = match;
	if (format === 'iso') return iso;
	if (format === 'd.M.yy') return `${Number(day)}.${Number(month)}.${year.slice(2)}`;
	return `${day}.${month}.${year}`;
}

/** Day amounts as German decimals in half-day steps: 30 -> "30", 4.5 -> "4,5". */
export function formatDaysDe(days: number): string {
	const rounded = Math.round(days * 2) / 2;
	return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
}

export const halfDaysToDays = (halfDays: number) => halfDays / 2;
