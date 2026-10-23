import type { DayEvaluation } from '#lib/api/types.js';

/**
 * Hour difference of one calendar week against its weekly Soll (P12), shown under the KW label of the calendar.
 *
 * - `done`: the week lies completely before today; the difference is final (Ist minus Soll).
 * - `open`: the week is running or in the future; the difference is neutral information ("noch X offen" while the
 *   Soll is not reached, "+X" once it is exceeded). It is never an alarm: days that have not happened are no deficit.
 */
export interface WeekBalance {
	state: 'done' | 'open';
	/** Soll of the whole week */
	targetSeconds: number;
	/** worked and credited time of the whole week (evaluated, with credits) */
	actualSeconds: number;
	/** Ist minus Soll of the whole week (negative = still missing) */
	deltaSeconds: number;
}

/** The balance of the week given by its dates, or null when the evaluations do not cover it or it has no Soll and no time. */
export function weekBalance(dates: string[], days: DayEvaluation[], today: string): WeekBalance | null {
	if (dates.length === 0) return null;
	const byDate = new Map(days.map((d) => [d.date, d]));
	const covered = dates.map((d) => byDate.get(d)).filter((d): d is DayEvaluation => !!d);
	if (covered.length < dates.length) return null;
	const target = covered.reduce((sum, d) => sum + d.targetSeconds, 0);
	const actual = covered.reduce((sum, d) => sum + d.evaluatedWorkSeconds + d.creditSeconds, 0);
	if (target === 0 && actual === 0) return null;
	return { state: dates[dates.length - 1] < today ? 'done' : 'open', targetSeconds: target, actualSeconds: actual, deltaSeconds: actual - target };
}

export type WeekBalanceTone = 'positive' | 'neutral' | 'warning';

/** Subtle colour: over Soll = positive; under Soll = warning only for completed weeks; open weeks stay neutral. */
export function weekBalanceTone(balance: WeekBalance): WeekBalanceTone {
	if (balance.deltaSeconds > 0) return 'positive';
	if (balance.deltaSeconds < 0 && balance.state === 'done') return 'warning';
	return 'neutral';
}
