import type { ImportMapping, WorktimeOptions, WorktimeRemarkRule } from '../api/types';
import { DEFAULT_WORKTIME_RULES, ruleIssues, type RuleIssue } from './worktime';

/** Form state of the profile step; numbers stay strings while typing. */
export interface WorktimeForm {
	pauseMode: 'split' | 'none';
	pauseSource: 'table' | 'override';
	pauseMinutes: string;
	pauseStart: string;
	roundToMinutes: boolean;
	rules: WorktimeRemarkRule[];
}

export function emptyWorktimeForm(rules: WorktimeRemarkRule[] = DEFAULT_WORKTIME_RULES): WorktimeForm {
	return { pauseMode: 'split', pauseSource: 'table', pauseMinutes: '30', pauseStart: '12:00', roundToMinutes: true, rules: rules.map((r) => ({ ...r })) };
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
		roundToMinutes: options?.roundToMinutes ?? true
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
