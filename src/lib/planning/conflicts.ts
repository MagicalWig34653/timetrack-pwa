import type { Absence, AbsenceKind, CalendarDay, PlanDay, PlanMode } from '#lib/api/types.js';
import { isoWeekday } from '#lib/time/dates.js';
import { covers, isActiveAbsence, modelOn } from './calendar.js';

export type ConflictKind = 'absence_overlap' | 'holiday' | 'non_working' | 'plan_replaced' | 'plan_overridden';
/** `block`: the server would reject it; `warn`: allowed but probably not intended; `info`: a harmless side effect. */
export type ConflictSeverity = 'block' | 'warn' | 'info';

export interface Conflict {
	date: string;
	kind: ConflictKind;
	severity: ConflictSeverity;
	/** Holiday name or kind of the other absence, for the message. */
	detail?: string;
}

export interface ConflictContext {
	holidays: CalendarDay[];
	absences: Absence[];
	plan: PlanDay[];
	models: Parameters<typeof modelOn>[1];
}

export type PlannedAction = { type: 'absence'; kind: AbsenceKind; ignoreAbsenceId?: string } | { type: 'plan'; mode: PlanMode };

export function isWorkday(date: string, models: ConflictContext['models']): boolean {
	const weekday = isoWeekday(date);
	const model = modelOn(date, models);
	if (!(model ? model.workdays : [1, 2, 3, 4, 5]).includes(weekday)) return false;
	return model?.dailyTargetSeconds?.[String(weekday)] !== 0;
}

/**
 * Conflicts of applying an action to the given days. Pure: the same rules drive the drag ghost, the dialog hint
 * and the confirmation. The server stays the authority (absence overlaps answer 409).
 */
export function findConflicts(dates: string[], action: PlannedAction, ctx: ConflictContext): Conflict[] {
	const out: Conflict[] = [];
	for (const date of dates) {
		const holiday = ctx.holidays.find((h) => h.kind === 'holiday' && covers(h, date));
		const others = ctx.absences.filter((a) => isActiveAbsence(a) && covers(a, date));
		if (action.type === 'absence') {
			const clash = others.find((a) => a.id !== action.ignoreAbsenceId);
			if (clash) out.push({ date, kind: 'absence_overlap', severity: 'block', detail: clash.kind });
			if (holiday) out.push({ date, kind: 'holiday', severity: 'warn', detail: holiday.name });
			else if (!isWorkday(date, ctx.models)) out.push({ date, kind: 'non_working', severity: 'warn' });
			if (ctx.plan.some((p) => p.date === date)) out.push({ date, kind: 'plan_overridden', severity: 'info' });
		} else {
			if (others.length > 0) out.push({ date, kind: 'plan_overridden', severity: 'warn', detail: others[0].kind });
			if (holiday) out.push({ date, kind: 'holiday', severity: 'warn', detail: holiday.name });
			else if (!isWorkday(date, ctx.models) && action.mode !== 'off') out.push({ date, kind: 'non_working', severity: 'warn' });
			if (ctx.plan.some((p) => p.date === date)) out.push({ date, kind: 'plan_replaced', severity: 'info' });
		}
	}
	return out;
}

export const hasBlocking = (conflicts: Conflict[]) => conflicts.some((c) => c.severity === 'block');

/** Highest severity per date, for marking the tiles of the ghost. */
export function severityByDate(conflicts: Conflict[]): Map<string, ConflictSeverity> {
	const rank: Record<ConflictSeverity, number> = { info: 0, warn: 1, block: 2 };
	const map = new Map<string, ConflictSeverity>();
	for (const c of conflicts) {
		const current = map.get(c.date);
		if (!current || rank[c.severity] > rank[current]) map.set(c.date, c.severity);
	}
	return map;
}
