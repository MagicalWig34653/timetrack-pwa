// Small TypeScript port of the evaluation rules in ADR-0004 (backend repo) for the mock API only.
// The real engine is the Swift `TimeEngine`; this port exists so the PWA can show realistic numbers without it.
// Assumptions beyond the ADR text are marked "assumption" and listed in docs/handoffs/L4.md.
import { addDays, DEFAULT_TIMEZONE, isoWeekday, localDateOf, localMinutesOf, zonedTimeToInstant } from '../src/lib/time/dates.ts';
import type { BreakHintCode, DayEvaluation, DayMarkKind, SegmentKind, WorkModel } from '../src/lib/api/types.ts';

export interface EvalSegment {
	id: string;
	kind: SegmentKind;
	/** effective (possibly corrected) times, epoch ms; endedAt null = running */
	startedAt: number;
	endedAt: number | null;
}

/** Effect of absences/holidays on a day (ADR-0005, derived by the planning mock). An explicit mark always wins. */
export interface DerivedDayContext {
	mark: 'holiday' | 'vacation' | 'sick';
	/** half vacation day: the target is halved */
	halfTarget?: boolean;
}

export interface DayPrefs {
	mark?: DayMarkKind;
	creditSeconds?: number | null;
	skipFixedBreaks?: boolean;
	/** explicit target override (contract v0.3.0); only used together with a holiday/vacation/sick mark */
	targetOverrideSeconds?: number | null;
}

const MINUTE = 60_000;
const SECOND = 1000;

/** Model valid on the given local day (validFrom <= date <= validTo or open ended). */
export function modelForDate(models: WorkModel[], date: string): WorkModel | null {
	return models.find((m) => m.validFrom <= date && (!m.validTo || m.validTo >= date)) ?? null;
}

/** Daily target in seconds: explicit weekday value wins, otherwise the weekly target spread evenly over the workdays. */
export function dailyTarget(model: WorkModel, date: string): number {
	const weekday = isoWeekday(date);
	const explicit = model.dailyTargetSeconds?.[String(weekday)];
	if (explicit !== undefined) return explicit;
	if (!model.workdays.includes(weekday)) return 0;
	return Math.round(model.weeklyTargetSeconds / model.workdays.length);
}

/** Work day of a segment: local date of its start shifted back by dayBoundaryMinutes. */
export function workDayOf(startedAt: number, model: Pick<WorkModel, 'timezone' | 'dayBoundaryMinutes'> | null): string {
	const zone = model?.timezone ?? DEFAULT_TIMEZONE;
	return localDateOf(startedAt - (model?.dayBoundaryMinutes ?? 0) * MINUTE, zone);
}

interface Interval {
	start: number;
	end: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
	const sorted = [...intervals].sort((a, b) => a.start - b.start);
	const merged: Interval[] = [];
	for (const i of sorted) {
		const last = merged.at(-1);
		if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
		else merged.push({ ...i });
	}
	return merged;
}

function overlapMs(a: Interval, b: Interval): number {
	return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function evaluateDay(input: {
	date: string;
	models: WorkModel[];
	/** non-voided segments belonging to the day */
	segments: EvalSegment[];
	prefs?: DayPrefs;
	/** absence/holiday effect from the planning data; ignored when the user set an explicit mark */
	derived?: DerivedDayContext | null;
	now: number;
}): DayEvaluation {
	const { date, models, prefs = {}, now } = input;
	const model = modelForDate(models, date);
	const zone = model?.timezone ?? DEFAULT_TIMEZONE;
	const explicit = prefs.mark !== undefined && prefs.mark !== 'none';
	const derived = explicit ? null : (input.derived ?? null);
	const mark: DayMarkKind = explicit ? prefs.mark! : (derived?.mark ?? 'none');
	const baseTarget = model ? dailyTarget(model, date) : 0;
	const segments = [...input.segments].sort((a, b) => a.startedAt - b.startedAt);
	const provisional = segments.some((s) => s.endedAt === null) || date === localDateOf(now, zone);

	const intervals = segments
		.map((s) => ({ ...s, interval: { start: s.startedAt, end: Math.max(s.startedAt, s.endedAt ?? now) } }))
		.filter((s) => s.interval.end > s.interval.start);

	// School rule: enough school time on the day replaces the segment sum by the credit (assumption: it replaces all segments).
	const schoolSeconds = intervals.filter((s) => s.kind === 'school').reduce((sum, s) => sum + (s.interval.end - s.interval.start) / SECOND, 0);
	const threshold = model?.schoolFullDayThresholdSeconds ?? 10800;
	const schoolCredit = model ? (model.schoolCreditSeconds ?? baseTarget) : 0;
	const schoolRule = !!model && schoolSeconds > 0 && schoolSeconds >= threshold;
	const markCreditsSchool = mark === 'school_credit';

	let target = baseTarget;
	let credit = 0;
	if (mark === 'holiday' || mark === 'vacation' || mark === 'sick') {
		const halved = derived?.halfTarget ? Math.round(baseTarget / 2) : 0;
		target = prefs.targetOverrideSeconds ?? halved;
		credit = prefs.creditSeconds ?? 0;
	} else if (markCreditsSchool) {
		credit = prefs.creditSeconds ?? schoolCredit;
	} else if (schoolRule) {
		credit = schoolCredit;
	}
	const creditReplacesSegments = (schoolRule && mark === 'none') || markCreditsSchool;

	const counting = creditReplacesSegments
		? []
		: intervals.filter((s) => s.kind === 'work' || s.kind === 'school' || (s.kind === 'travel' && (model?.travelCountsAsWork ?? true)));
	const countingIntervals = counting.map((s) => s.interval);

	const rawWorkSeconds = Math.round(countingIntervals.reduce((sum, i) => sum + (i.end - i.start), 0) / SECOND);

	// Fixed breaks only remove the part lying inside counting segments.
	let breakDeductionSeconds = 0;
	if (model && !prefs.skipFixedBreaks) {
		for (const fixed of model.fixedBreaks ?? []) {
			const window: Interval = {
				start: zonedTimeToInstant(date, fixed.start, zone).getTime(),
				end: zonedTimeToInstant(date, fixed.end, zone).getTime()
			};
			const merged = mergeIntervals(countingIntervals);
			breakDeductionSeconds += Math.round(merged.reduce((sum, i) => sum + overlapMs(i, window), 0) / SECOND);
		}
	}

	// Rounding: first start down, last end up; inner boundaries and gaps stay untouched.
	let startAdjustSeconds = 0;
	let endAdjustSeconds = 0;
	let evaluatedStart: number | null = null;
	let evaluatedEnd: number | null = null;
	if (countingIntervals.length > 0) {
		const first = Math.min(...countingIntervals.map((i) => i.start));
		const last = Math.max(...countingIntervals.map((i) => i.end));
		evaluatedStart = first;
		evaluatedEnd = last;
		if (model?.roundingEnabled ?? false) {
			const step = (model?.roundingMinutes ?? 15) * MINUTE;
			evaluatedStart = Math.floor(first / step) * step;
			evaluatedEnd = Math.ceil(last / step) * step;
			startAdjustSeconds = Math.round((first - evaluatedStart) / SECOND);
			endAdjustSeconds = Math.round((evaluatedEnd - last) / SECOND);
		}
	}

	const evaluatedWorkSeconds = rawWorkSeconds - breakDeductionSeconds + startAdjustSeconds + endAdjustSeconds;
	return {
		date,
		modelId: model?.id ?? null,
		mark,
		skipFixedBreaks: !!prefs.skipFixedBreaks,
		targetSeconds: target,
		rawWorkSeconds,
		breakDeductionSeconds,
		startAdjustSeconds,
		endAdjustSeconds,
		evaluatedWorkSeconds,
		creditSeconds: credit,
		deltaSeconds: evaluatedWorkSeconds + credit - target,
		evaluatedStart: evaluatedStart === null ? null : new Date(evaluatedStart).toISOString(),
		evaluatedEnd: evaluatedEnd === null ? null : new Date(evaluatedEnd).toISOString(),
		provisional,
		segmentIds: segments.map((s) => s.id),
		breakHints: breakHints(countingIntervals, breakDeductionSeconds)
	};
}

/**
 * Hints only, based on actual (unrounded) times; no breaks are invented.
 * Assumptions: gaps shorter than 15 min do not count as break; a deducted fixed break counts as break time.
 */
export function breakHints(countingIntervals: Interval[], fixedBreakSeconds = 0): { code: BreakHintCode }[] {
	if (countingIntervals.length === 0) return [];
	const merged = mergeIntervals(countingIntervals);
	const workSeconds = merged.reduce((sum, i) => sum + (i.end - i.start), 0) / SECOND;
	const gaps = merged.slice(1).map((m, index) => (m.start - merged[index].end) / SECOND);
	const countedBreak = gaps.filter((g) => g >= 15 * 60).reduce((a, b) => a + b, 0) + fixedBreakSeconds;
	const hints: BreakHintCode[] = [];
	if (workSeconds > 9 * 3600 && countedBreak < 45 * 60) hints.push('break_missing_45');
	else if (workSeconds > 6 * 3600 && countedBreak < 30 * 60) hints.push('break_missing_30');
	if (workSeconds > 6 * 3600 && gaps.some((g) => g > 0 && g < 15 * 60)) hints.push('break_part_too_short');
	if (merged.some((i) => (i.end - i.start) / SECOND > 6 * 3600)) hints.push('work_over_6h_without_break');
	return hints.map((code) => ({ code }));
}

/** Helper used by the account balance: all local days in [from, to]. */
export function daysBetween(from: string, to: string): string[] {
	const days: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
	return days;
}

export { localMinutesOf };
