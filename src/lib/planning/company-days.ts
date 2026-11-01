import type { CalendarDay, CompanyDay, CompanyDayTreatment } from '#lib/api/types.js';
import { t } from '#lib/i18n/index.js';

/** Company days (N4, contract 0.32.0, ADR-0029): fixed month/day rules per account, e.g. 24.12. and 31.12. */

export const MAX_COMPANY_DAYS = 12;
export const COMPANY_NAME_MAX = 80;
export const TREATMENTS: CompanyDayTreatment[] = ['none', 'half', 'full'];

/** The two suggested rules; the server always lists them, the form also shows them for older servers without the field. */
export const SUGGESTED_COMPANY_DAYS: CompanyDay[] = [
	{ month: 12, day: 24, treatment: 'none', name: 'Heiligabend' },
	{ month: 12, day: 31, treatment: 'none', name: 'Silvester' }
];

export const treatmentLabel = (treatment: CompanyDayTreatment) => t(`company.treatment.${treatment}`);

/** Rules to edit: the server list, with the suggested 24.12./31.12. added when missing, sorted by date. */
export function withSuggested(days: CompanyDay[] | undefined): CompanyDay[] {
	const list = [...(days ?? [])];
	for (const suggested of SUGGESTED_COMPANY_DAYS) {
		if (!list.some((d) => d.month === suggested.month && d.day === suggested.day)) list.push({ ...suggested });
	}
	return list.sort((a, b) => a.month - b.month || a.day - b.day);
}

export interface CompanyDayRow {
	/** "24.12." style text typed by the user */
	date: string;
	treatment: CompanyDayTreatment;
	name: string;
}

export const toRow = (d: CompanyDay): CompanyDayRow => ({ date: `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.`, treatment: d.treatment, name: d.name ?? '' });

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "24.12." / "24.12" -> {month, day}; null for invalid dates and for 29.02. (the server rejects it, ADR-0029). */
export function parseFixedDate(input: string): { month: number; day: number } | null {
	const match = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(input.trim());
	if (!match) return null;
	const day = Number(match[1]);
	const month = Number(match[2]);
	if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
	return { month, day };
}

export interface CompanyDayValidation {
	days: CompanyDay[];
	/** error text per row index; empty when valid */
	errors: Record<number, string>;
	/** list-level error (too many rules) */
	listError: string;
}

/** Validates the edited rows like the server does (valid date, no 29.02., one rule per date, name up to 80 characters, at most 12 rules). */
export function validateRows(rows: CompanyDayRow[]): CompanyDayValidation {
	const errors: Record<number, string> = {};
	const days: CompanyDay[] = [];
	const seen = new Set<string>();
	rows.forEach((row, index) => {
		const date = parseFixedDate(row.date);
		const name = row.name.trim();
		if (!date) errors[index] = row.date.trim().startsWith('29.02') ? t('company.error_leap') : t('company.error_date');
		else if (seen.has(`${date.month}-${date.day}`)) errors[index] = t('company.error_duplicate');
		else if (name.length > COMPANY_NAME_MAX) errors[index] = t('company.error_name', { max: COMPANY_NAME_MAX });
		else {
			seen.add(`${date.month}-${date.day}`);
			days.push({ month: date.month, day: date.day, treatment: row.treatment, name: name || null });
		}
	});
	const listError = rows.length > MAX_COMPANY_DAYS ? t('company.error_max', { max: MAX_COMPANY_DAYS }) : '';
	return { days, errors, listError };
}

/** Tooltip/aria text of a holiday name; half days say that the target is halved (the mark alone stays "work"). */
export function holidayHint(name: string, treatment: 'half' | 'full' | null | undefined): string {
	if (treatment === 'half') return t('company.hint_half', { name });
	if (treatment === 'full') return t('company.hint_full', { name });
	return name;
}

/** Treatment of the company-day entry in a calendar list (builtin holiday with `companyTreatment`). */
export const treatmentOf = (day: Pick<CalendarDay, 'companyTreatment'>): 'half' | 'full' | null => day.companyTreatment ?? null;
