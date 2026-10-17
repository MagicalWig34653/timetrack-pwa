import type { WorkModel, HolidayTimes, ImportMapping, PartialCredit, WorktimeOptions, WorktimeRemarkRule } from '../api/types';
import { addDays, isoWeekday } from '../time/dates';
import { DEFAULT_WORKTIME_RULES, ruleIssues, type RuleIssue } from './worktime';

/** Form state of the profile step; numbers stay strings while typing. */
export interface WorktimeForm {
	pauseMode: 'split' | 'none';
	pauseSource: 'table' | 'override';
	pauseMinutes: string;
	pauseStart: string;
	roundToMinutes: boolean;
	holidayTimes: HolidayTimes;
	partialCredit: PartialCredit;
	rules: WorktimeRemarkRule[];
}

export function emptyWorktimeForm(rules: WorktimeRemarkRule[] = DEFAULT_WORKTIME_RULES): WorktimeForm {
	return { pauseMode: 'split', pauseSource: 'table', pauseMinutes: '30', pauseStart: '12:00', roundToMinutes: true, holidayTimes: 'discard', partialCredit: 'work', rules: rules.map((r) => ({ ...r })) };
}

export type WorktimeFormIssue = { kind: 'pause' } | { kind: 'pause_start' } | { kind: 'rule'; index: number; issue: RuleIssue };

export function worktimeIssues(form: WorktimeForm): WorktimeFormIssue[] {
	const issues: WorktimeFormIssue[] = [];
	if (form.pauseSource === 'override') {
		const n = Number(form.pauseMinutes);
		if (!/^\d+$/.test(form.pauseMinutes.trim()) || n > 240) issues.push({ kind: 'pause' });
	}
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.pauseStart.trim())) issues.push({ kind: 'pause_start' });
	for (const i of ruleIssues(form.rules)) issues.push({ kind: 'rule', index: i.index, issue: i.issue });
	return issues;
}

export function worktimeFromForm(form: WorktimeForm): WorktimeOptions {
	return {
		pauseMode: form.pauseMode,
		pauseMinutes: form.pauseSource === 'override' ? Number(form.pauseMinutes.trim()) : null,
		pauseStart: form.pauseStart.trim(),
		roundToMinutes: form.roundToMinutes,
		holidayTimes: form.holidayTimes,
		partialCredit: form.partialCredit,
		rules: form.rules.map((r) => ({ pattern: r.pattern.trim(), action: r.action }))
	};
}

/** Restores the form from a saved template; empty or missing rules mean the standard rules. */
export function formFromWorktime(options: WorktimeOptions | undefined, defaults: WorktimeRemarkRule[]): WorktimeForm {
	const base = emptyWorktimeForm(options?.rules && options.rules.length > 0 ? options.rules : defaults);
	return {
		...base,
		pauseMode: options?.pauseMode ?? 'split',
		pauseSource: options?.pauseMinutes != null ? 'override' : 'table',
		pauseMinutes: options?.pauseMinutes != null ? String(options.pauseMinutes) : '30',
		pauseStart: options?.pauseStart ?? '12:00',
		roundToMinutes: options?.roundToMinutes ?? true,
		holidayTimes: options?.holidayTimes ?? 'discard',
		partialCredit: options?.partialCredit ?? 'work'
	};
}

/** Mapping body for profile worktime_workbook: sheet, header row, columns and formats are placeholders (contract v0.10.0). */
export function worktimeMapping(sheet: string, form: WorktimeForm): ImportMapping {
	return {
		profile: 'worktime_workbook',
		worktime: worktimeFromForm(form),
		sheet,
		headerRow: 0,
		timezone: 'Europe/Berlin',
		dateFormat: 'excel_serial',
		timeFormat: 'excel_fraction',
		columns: { date: 0 }
	};
}

export const isWorktimeTemplate = (mapping: ImportMapping) => mapping.profile === 'worktime_workbook';

export type ModelStartHint =
	| { kind: 'none' }
	/** the model valid on the first content day starts before it; the empty workdays in between count as missing time */
	| { kind: 'earlier'; modelFrom: string; emptyDays: number; beforeWeek: boolean }
	| { kind: 'ok'; modelFrom: string }
	/** the first content days lie before the first model */
	| { kind: 'late'; modelFrom: string };

/**
 * Hint for the start of the work model (C23 firstContentDate). Empty workdays (Mon-Fri) before the first content day within its week
 * count as missing time when the model already applies there; a model older than that week affects the earlier weeks as well.
 */
export function modelStartHint(firstContentDate: string | null | undefined, models: Pick<WorkModel, 'validFrom' | 'validTo'>[]): ModelStartHint | null {
	if (!firstContentDate) return null;
	if (models.length === 0) return { kind: 'none' };
	const valid = models.find((m) => m.validFrom <= firstContentDate && (!m.validTo || m.validTo >= firstContentDate));
	if (!valid) {
		const next = [...models].sort((a, b) => a.validFrom.localeCompare(b.validFrom)).find((m) => m.validFrom > firstContentDate);
		return next ? { kind: 'late', modelFrom: next.validFrom } : null;
	}
	if (valid.validFrom === firstContentDate) return { kind: 'ok', modelFrom: valid.validFrom };
	const monday = addDays(firstContentDate, -(isoWeekday(firstContentDate) - 1));
	let emptyDays = 0;
	for (let d = valid.validFrom > monday ? valid.validFrom : monday; d < firstContentDate; d = addDays(d, 1)) if (isoWeekday(d) <= 5) emptyDays++;
	const beforeWeek = valid.validFrom < monday;
	if (!beforeWeek && emptyDays === 0) return { kind: 'ok', modelFrom: valid.validFrom };
	return { kind: 'earlier', modelFrom: valid.validFrom, emptyDays, beforeWeek };
}

/** True when all options (including the remark rules) equal the recommendation. */
export function isRecommended(form: WorktimeForm, defaults: WorktimeRemarkRule[]): boolean {
	return JSON.stringify(worktimeFromForm(form)) === JSON.stringify(worktimeFromForm(emptyWorktimeForm(defaults)));
}

export interface WorktimeFacts {
	sheets: number;
	weeks: number;
	/** days with working or school times */
	timeDays: number;
	workDays: number;
	schoolDays: number;
	vacationDays: number;
	sickDays: number;
	excusedDays: number;
	holidayDays: number;
	firstDay: string | null;
}

/** Whole calendar weeks (Monday to Sunday) touched by the range first..last. */
export function weeksBetween(first: string | null | undefined, last: string | null | undefined): number {
	if (!first || !last || last < first) return 0;
	const monday = (d: string) => addDays(d, -(isoWeekday(d) - 1));
	const days = Math.round((Date.parse(monday(last) + 'T00:00:00Z') - Date.parse(monday(first) + 'T00:00:00Z')) / 86_400_000);
	return days / 7 + 1;
}

/** Plain numbers of a worktime preview for the recognition card and the summary. `byAction` counts days by meaning. */
export function worktimeFacts(worktime: { days?: number; firstDate?: string | null; lastDate?: string | null; firstContentDate?: string | null; byAction?: Record<string, number> } | undefined, sheetCount: number): WorktimeFacts {
	const by = worktime?.byAction ?? {};
	const workDays = by.work ?? 0;
	const schoolDays = by.school ?? 0;
	return {
		sheets: sheetCount,
		weeks: weeksBetween(worktime?.firstDate, worktime?.lastDate),
		timeDays: by.work !== undefined || by.school !== undefined ? workDays + schoolDays : (worktime?.days ?? 0),
		workDays,
		schoolDays,
		vacationDays: by.vacation ?? 0,
		sickDays: by.sick ?? 0,
		excusedDays: by.excused ?? 0,
		holidayDays: by.holiday ?? 0,
		firstDay: worktime?.firstContentDate ?? worktime?.firstDate ?? null
	};
}

/** Whether a new model version starting at the first content day can be created in one step (see `modelStartHint`). */
export function canCreateModel(hint: ModelStartHint | null): boolean {
	return hint !== null && (hint.kind === 'none' || hint.kind === 'earlier');
}
