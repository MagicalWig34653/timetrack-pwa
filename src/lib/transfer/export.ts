import { MAX_DAYS_RANGE } from '../api/client';
import { addDays, compareDates, isValidDate } from '../time/dates';

export type ExportRangeError = 'invalid' | 'order' | 'too_long';

/** Inclusive number of days between two ISO dates. */
export function inclusiveDays(from: string, to: string): number {
	return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1;
}

/** Client-side check of the export period (contract: at most 366 days, else 400 range_too_large). */
export function validateExportRange(from: string, to: string): ExportRangeError | null {
	if (!isValidDate(from) || !isValidDate(to)) return 'invalid';
	if (compareDates(to, from) < 0) return 'order';
	if (inclusiveDays(from, to) > MAX_DAYS_RANGE) return 'too_long';
	return null;
}

/** First and last day of the month `offset` months away from the month of `today`. */
export function monthRange(today: string, offset = 0): { from: string; to: string } {
	const [y, m] = today.split('-').map(Number);
	const index = y * 12 + (m - 1) + offset;
	const year = Math.floor(index / 12);
	const month = (index % 12) + 1;
	const from = `${year}-${String(month).padStart(2, '0')}-01`;
	const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
	return { from, to: addDays(nextMonth, -1) };
}

/** Jan 1 until Dec 31 of the year of `today`. */
export function yearRange(today: string): { from: string; to: string } {
	const year = today.slice(0, 4);
	return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export const EXPORT_MIME: Record<'xlsx' | 'pdf' | 'csv', string> = {
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pdf: 'application/pdf',
	csv: 'text/csv'
};

/** Fallback when the server sends no Content-Disposition filename. */
export function fallbackExportName(from: string, to: string, format: string): string {
	return `Arbeitszeit_${from}_${to}.${format}`;
}

/** Hands a blob to the browser as a download (object URL + temporary anchor). */
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.style.display = 'none';
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
