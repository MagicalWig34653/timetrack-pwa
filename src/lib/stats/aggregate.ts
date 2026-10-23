import type { Absence, AbsenceKind, DayEvaluation, Segment } from '#lib/api/types.js';
import { addDays, isoWeekNumber, localMinutesOf, startOfWeek } from '#lib/time/dates.js';

/** Pure aggregation of day evaluations into statistic buckets (P12). The data layer in source.ts only fetches. */

export type Granularity = 'day' | 'week' | 'month';

export interface StatsPoint {
	/** first day of the bucket (YYYY-MM-DD) */
	key: string;
	/** last day of the bucket that is part of the range */
	end: string;
	label: string;
	/** number of elapsed days in the bucket */
	days: number;
	targetSeconds: number;
	actualSeconds: number;
	deltaSeconds: number;
	/** account balance at the end of the bucket (opening + cumulative deltas) */
	balanceSeconds: number;
	workSeconds: number;
	travelSeconds: number;
	schoolSeconds: number;
	breakSeconds: number;
	vacationDays: number;
	sickDays: number;
	otherAbsenceDays: number;
	/** average start/end as minutes since local midnight, null without any */
	avgStartMinutes: number | null;
	avgEndMinutes: number | null;
}

export interface StatsData {
	from: string;
	to: string;
	granularity: Granularity;
	rounded: boolean;
	points: StatsPoint[];
	totals: {
		targetSeconds: number;
		actualSeconds: number;
		deltaSeconds: number;
		breakSeconds: number;
		workSeconds: number;
		travelSeconds: number;
		schoolSeconds: number;
		absenceDays: number;
		avgStartMinutes: number | null;
		avgEndMinutes: number | null;
		/** days with any evaluated time or Soll */
		days: number;
	};
	/** account balance before the first day */
	openingBalanceSeconds: number;
	/** true when there is nothing to show (no Soll and no time) */
	empty: boolean;
	/** the same range per month, always present (absence chart) */
	monthly: StatsPoint[];
}

export interface AggregateInput {
	days: DayEvaluation[];
	absences: Absence[];
	openingBalanceSeconds: number;
	granularity: Granularity;
	rounded: boolean;
	today: string;
	timeZone: string;
}

const ACTIVE = ['planned', 'requested', 'approved', 'taken'];

export function bucketKey(date: string, granularity: Granularity): string {
	if (granularity === 'day') return date;
	if (granularity === 'week') return startOfWeek(date);
	return `${date.slice(0, 7)}-01`;
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function bucketLabel(key: string, granularity: Granularity): string {
	if (granularity === 'day') return `${key.slice(8)}.${key.slice(5, 7)}.`;
	if (granularity === 'week') return `KW ${isoWeekNumber(key)}`;
	return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
}

/** Seconds of the segments per kind, and the gaps between them (breaks). Open segments are ignored. */
export function segmentFigures(segments: Segment[]): { work: number; travel: number; school: number; gaps: number; first: string | null; last: string | null } {
	const done = segments.filter((s) => !s.voided && s.endedAt).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
	const out = { work: 0, travel: 0, school: 0, gaps: 0, first: null as string | null, last: null as string | null };
	let previousEnd: number | null = null;
	for (const s of done) {
		const start = Date.parse(s.startedAt);
		const end = Date.parse(s.endedAt!);
		out[s.kind] += Math.max(0, Math.floor((end - start) / 1000));
		if (previousEnd !== null && start > previousEnd) out.gaps += Math.floor((start - previousEnd) / 1000);
		previousEnd = Math.max(previousEnd ?? end, end);
		out.first ??= s.startedAt;
		out.last = new Date(Math.max(Date.parse(out.last ?? s.endedAt!), end)).toISOString();
	}
	return out;
}

function absenceKindOn(absences: Absence[], date: string): { kind: AbsenceKind; weight: number } | null {
	const hit = absences.find((a) => ACTIVE.includes(a.status) && a.startDate <= date && date <= a.endDate);
	if (!hit) return null;
	const half = (date === hit.startDate && hit.halfDayStart) || (date === hit.endDate && hit.halfDayEnd);
	return { kind: hit.kind, weight: half ? 0.5 : 1 };
}

const mean = (values: number[]) => (values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length));

export function aggregate(input: AggregateInput): StatsData {
	return { ...build(input), monthly: build({ ...input, granularity: 'month' }).points };
}

function build(input: AggregateInput): Omit<StatsData, 'monthly'> {
	const { granularity, rounded, today, timeZone } = input;
	const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
	const from = days[0]?.date ?? today;
	const to = days.at(-1)?.date ?? today;
	const buckets = new Map<string, { point: StatsPoint; starts: number[]; ends: number[] }>();
	let running = input.openingBalanceSeconds;
	const allStarts: number[] = [];
	const allEnds: number[] = [];
	const totals = { targetSeconds: 0, actualSeconds: 0, deltaSeconds: 0, breakSeconds: 0, workSeconds: 0, travelSeconds: 0, schoolSeconds: 0, absenceDays: 0, days: 0 };

	for (const day of days) {
		const key = bucketKey(day.date, granularity);
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = {
				point: { key, end: day.date, label: bucketLabel(key, granularity), days: 0, targetSeconds: 0, actualSeconds: 0, deltaSeconds: 0, balanceSeconds: running, workSeconds: 0, travelSeconds: 0, schoolSeconds: 0, breakSeconds: 0, vacationDays: 0, sickDays: 0, otherAbsenceDays: 0, avgStartMinutes: null, avgEndMinutes: null },
				starts: [],
				ends: []
			};
			buckets.set(key, bucket);
		}
		const p = bucket.point;
		p.end = day.date;
		// A day that has not happened yet is no deficit: it neither counts towards the Soll nor the balance.
		if (day.date > today) continue;
		p.days += 1;
		const figures = segmentFigures(day.segments ?? []);
		const actual = (rounded ? day.evaluatedWorkSeconds : day.rawWorkSeconds) + day.creditSeconds;
		const delta = actual - day.targetSeconds;
		p.targetSeconds += day.targetSeconds;
		p.actualSeconds += actual;
		p.deltaSeconds += delta;
		running += delta;
		p.balanceSeconds = running;
		p.workSeconds += figures.work;
		p.travelSeconds += figures.travel;
		p.schoolSeconds += figures.school;
		p.breakSeconds += figures.gaps;
		const startInstant = rounded ? (day.evaluatedStart ?? figures.first) : figures.first;
		const endInstant = rounded ? (day.evaluatedEnd ?? figures.last) : figures.last;
		if (startInstant) bucket.starts.push(localMinutesOf(startInstant, timeZone));
		if (endInstant) bucket.ends.push(localMinutesOf(endInstant, timeZone));
		const absence = absenceKindOn(input.absences, day.date);
		if (absence && (day.targetSeconds > 0 || ['vacation', 'sick', 'excused'].includes(day.mark ?? 'none'))) {
			if (absence.kind === 'vacation') p.vacationDays += absence.weight;
			else if (absence.kind === 'sick') p.sickDays += absence.weight;
			else p.otherAbsenceDays += absence.weight;
			totals.absenceDays += absence.weight;
		}
		if (day.targetSeconds > 0 || actual > 0) totals.days += 1;
		totals.targetSeconds += day.targetSeconds;
		totals.actualSeconds += actual;
		totals.deltaSeconds += delta;
		totals.breakSeconds += figures.gaps;
		totals.workSeconds += figures.work;
		totals.travelSeconds += figures.travel;
		totals.schoolSeconds += figures.school;
		if (startInstant) allStarts.push(localMinutesOf(startInstant, timeZone));
		if (endInstant) allEnds.push(localMinutesOf(endInstant, timeZone));
	}

	const points = [...buckets.values()].map(({ point, starts, ends }) => ({ ...point, avgStartMinutes: mean(starts), avgEndMinutes: mean(ends) }));
	// buckets entirely in the future carry no figures and would only draw empty columns
	const elapsed = points.filter((p) => p.days > 0);
	return {
		from,
		to,
		granularity,
		rounded,
		points: elapsed,
		totals: { ...totals, avgStartMinutes: mean(allStarts), avgEndMinutes: mean(allEnds) },
		openingBalanceSeconds: input.openingBalanceSeconds,
		empty: totals.targetSeconds === 0 && totals.actualSeconds === 0
	};
}

/** Range presets of the statistics page. */
export type RangePreset = 'w4' | 'w12' | 'w26' | 'w52' | 'year' | 'custom';

export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): { from: string; to: string } {
	if (preset === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
	const weeks = Number(preset.slice(1));
	return { from: addDays(startOfWeek(today), -7 * (weeks - 1)), to: today };
}

/** "9:05" style clock text for minutes since midnight. */
export function clockText(minutes: number): string {
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
