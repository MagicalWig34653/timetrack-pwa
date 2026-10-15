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
