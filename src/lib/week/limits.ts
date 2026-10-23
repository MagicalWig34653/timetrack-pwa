import type { PlanWeekDay } from '#lib/api/types.js';
import { rangeOf } from './grid-edit.js';
import type { DayDraft } from './plan-draft.js';

/**
 * Hints about a planned week against the working-time limits of the only legal profile that exists in the backend
 * (`arbzg-adult-de`, Arbeitszeitgesetz for adults). They are hints for planning, not legal advice; the profile itself is
 * not readable through the API yet, so the thresholds are mirrored here as constants (see docs/handoffs/P11.md).
 */
export type IssueKind = 'daily_max' | 'break_short' | 'rest_short' | 'non_working';
export type IssueSeverity = 'warn' | 'info';

export interface DayIssue {
	date: string;
	kind: IssueKind;
	severity: IssueSeverity;
	/** Minutes: planned net time, missing break, or rest, depending on the kind. */
	value?: number;
}

export const LEGAL_PROFILE = 'arbzg-adult-de';
export const MAX_DAILY_MINUTES = 10 * 60;
export const MIN_REST_MINUTES = 11 * 60;
/** Gross span above which a break of at least this many minutes is needed (ArbZG section 4). */
export const BREAK_RULES: { overMinutes: number; breakMinutes: number }[] = [
	{ overMinutes: 9 * 60, breakMinutes: 45 },
	{ overMinutes: 6 * 60, breakMinutes: 30 }
];

export function requiredBreak(grossMinutes: number): number {
	return BREAK_RULES.find((rule) => grossMinutes > rule.overMinutes)?.breakMinutes ?? 0;
}

/** Issues of the planned week; blocked days are ignored (their stored plan does not count). */
export function weekIssues(days: PlanWeekDay[], drafts: DayDraft[]): DayIssue[] {
	const issues: DayIssue[] = [];
	let previousEnd: number | null = null;
	drafts.forEach((draft, index) => {
		const day = days[index];
		const range = day.blockedBy === null ? rangeOf(draft) : null;
		if (!range) {
			previousEnd = null;
			return;
		}
		const gross = range.end - range.start;
		const net = gross - Math.max(0, draft.breakMinutes);
		if (net > MAX_DAILY_MINUTES) issues.push({ date: draft.date, kind: 'daily_max', severity: 'warn', value: net });
		const need = requiredBreak(gross);
		if (need > draft.breakMinutes) issues.push({ date: draft.date, kind: 'break_short', severity: 'warn', value: need - draft.breakMinutes });
		if (previousEnd !== null) {
			const rest = range.start + 24 * 60 - previousEnd;
			if (rest < MIN_REST_MINUTES) issues.push({ date: draft.date, kind: 'rest_short', severity: 'warn', value: rest });
		}
		if (day.targetSeconds === 0 && draft.mode !== 'school') issues.push({ date: draft.date, kind: 'non_working', severity: 'info' });
		previousEnd = range.end;
	});
	return issues;
}

export function issuesByDate(issues: DayIssue[]): Map<string, DayIssue[]> {
	const map = new Map<string, DayIssue[]>();
	for (const issue of issues) map.set(issue.date, [...(map.get(issue.date) ?? []), issue]);
	return map;
}
