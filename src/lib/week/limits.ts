import type { LegalProfile, PlanWeekDay } from '#lib/api/types.js';
import { breakMinutesOf, type DayDraft, plannedSecondsOf, spanOf, validRanges } from './plan-draft.js';

/** Planning hints use the profile active on each date; actual warnings come from the server. */
export type IssueKind = 'daily_max' | 'weekly_max' | 'five_day_week' | 'weekend_work' | 'break_short' | 'rest_short' | 'non_working';
export type IssueSeverity = 'warn' | 'info';

export interface DayIssue {
	date: string;
	kind: IssueKind;
	severity: IssueSeverity;
	value?: number;
}

export const ADULT_PROFILE: LegalProfile = {
	id: 'arbzg-adult-de', name: 'Arbeitszeitgesetz', maxDailySeconds: 36000, maxWeeklySeconds: null,
	maxWorkdaysPerWeek: null, breakRules: [{ afterSeconds: 32400, requiredSeconds: 2700 }, { afterSeconds: 21600, requiredSeconds: 1800 }],
	minimumBreakPartSeconds: 900, maximumContinuousSeconds: 21600, minimumRestSeconds: 39600,
	restrictedWeekdays: [], sources: [], informationalOnly: true
};

export function requiredBreak(grossMinutes: number, profile: LegalProfile = ADULT_PROFILE): number {
	return Math.max(0, ...profile.breakRules.filter((rule) => grossMinutes * 60 > rule.afterSeconds).map((rule) => rule.requiredSeconds)) / 60;
}

/**
 * Hints per planned day. With block lists (`multi`) breaks are the gaps between blocks and school time is no working time;
 * the adult profile's break rule is then covered by the planning hints of the plan itself (`planHintsOf`), so only other
 * profiles get a `break_short` issue here.
 */
export function weekIssues(days: PlanWeekDay[], drafts: DayDraft[], profileForDate: (date: string) => LegalProfile = () => ADULT_PROFILE, multi = false): DayIssue[] {
	const issues: DayIssue[] = [];
	let previousEnd: number | null = null;
	let weekMinutes = 0;
	let workdays = 0;
	drafts.forEach((draft, index) => {
		const day = days[index];
		const profile = profileForDate(draft.date);
		const span = day.blockedBy === null ? spanOf(draft) : null;
		if (!span) {
			previousEnd = null;
			return;
		}
		const net = Math.round((plannedSecondsOf(draft) ?? 0) / 60);
		weekMinutes += net;
		workdays++;
		if (profile.maxDailySeconds !== null && net * 60 > profile.maxDailySeconds) issues.push({ date: draft.date, kind: 'daily_max', severity: 'warn', value: net });
		if (profile.maxWeeklySeconds !== null && weekMinutes * 60 > profile.maxWeeklySeconds) issues.push({ date: draft.date, kind: 'weekly_max', severity: 'warn', value: weekMinutes });
		if (profile.maxWorkdaysPerWeek !== null && workdays > profile.maxWorkdaysPerWeek) issues.push({ date: draft.date, kind: 'five_day_week', severity: 'warn', value: workdays });
		const onlySchool = validRanges(draft.blocks).every((r) => r.block.kind === 'school');
		if (!onlySchool && profile.restrictedWeekdays.includes(day.weekday)) issues.push({ date: draft.date, kind: 'weekend_work', severity: 'warn' });
		if (!multi || profile.id !== ADULT_PROFILE.id) {
			const gross = multi ? validRanges(draft.blocks).filter((r) => r.block.kind !== 'school').reduce((sum, r) => sum + (r.end - r.start), 0) + breakMinutesOf(draft) : span.end - span.start;
			const need = requiredBreak(gross, profile);
			const given = breakMinutesOf(draft);
			if (need > given) issues.push({ date: draft.date, kind: 'break_short', severity: 'warn', value: need - given });
		}
		if (previousEnd !== null && profile.minimumRestSeconds !== null) {
			const rest = span.start + 24 * 60 - previousEnd;
			if (rest * 60 < profile.minimumRestSeconds) issues.push({ date: draft.date, kind: 'rest_short', severity: 'warn', value: rest });
		}
		if (day.targetSeconds === 0 && !onlySchool) issues.push({ date: draft.date, kind: 'non_working', severity: 'info' });
		previousEnd = span.end;
	});
	return issues;
}

export function issuesByDate(issues: DayIssue[]): Map<string, DayIssue[]> {
	const map = new Map<string, DayIssue[]>();
	for (const issue of issues) map.set(issue.date, [...(map.get(issue.date) ?? []), issue]);
	return map;
}
