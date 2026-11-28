import type { DayMarkKind, Place, PlanDay, Segment, SegmentKind, TimeWeekDay } from '#lib/api/types.js';
import { t } from '#lib/i18n/index.js';
import { localDateOf, localTimeOf } from './dates.js';
import { formatDuration } from './format.js';
import { DAY_MARKS } from './labels.js';

/**
 * "Schultag buchen" as the one way to record school (docs/ux/schulzeit.md, Lino 26.11.2026): school is booked time of the
 * kind "Schule"; a plan or a place only pre-fills it. Pure helpers so the rules can be unit tested.
 */

export interface WallTimes {
	start: string;
	end: string;
}

const active = (segments: Segment[]) => segments.filter((s) => !s.voided);
const durationSeconds = (s: Segment) => (s.endedAt ? Math.max(0, (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : 0);

/** A plan says school when its mode is school or one of its blocks is a school block. */
export function isSchoolPlan(plan: PlanDay | null | undefined): boolean {
	if (!plan) return false;
	return plan.mode === 'school' || (plan.blocks ?? []).some((b) => b.kind === 'school');
}

/** Wall-clock span of the planned school time: the school blocks, else the planned window of a school plan; null without times. */
export function planSchoolTimes(plan: PlanDay | null | undefined): WallTimes | null {
	if (!plan) return null;
	const blocks = (plan.blocks ?? []).filter((b) => b.kind === 'school');
	if (blocks.length > 0) {
		return { start: blocks.map((b) => b.start).sort()[0], end: blocks.map((b) => b.end).sort().at(-1)! };
	}
	if (plan.mode === 'school' && plan.plannedStart && plan.plannedEnd) return { start: plan.plannedStart, end: plan.plannedEnd };
	return null;
}

/**
 * First start and last end of the latest day before `date` with finished school segments (Lino: times of the last school
 * day). When a day before every school day is filled in afterwards, the nearest later school day is used instead.
 */
export function lastSchoolTimes(segments: Segment[], date: string, timeZone: string): (WallTimes & { date: string }) | null {
	const school = active(segments).filter((s) => s.kind === 'school' && s.endedAt && localDateOf(s.startedAt, timeZone) !== date);
	if (school.length === 0) return null;
	const dates = [...new Set(school.map((s) => localDateOf(s.startedAt, timeZone)))].sort();
	const day = dates.filter((d) => d < date).at(-1) ?? dates.find((d) => d > date)!;
	const ofDay = school.filter((s) => localDateOf(s.startedAt, timeZone) === day).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
	const lastEnd = ofDay.map((s) => s.endedAt!).sort().at(-1)!;
	return { date: day, start: localTimeOf(ofDay[0].startedAt, timeZone), end: localTimeOf(lastEnd, timeZone) };
}

export type SchoolTimesSource = 'plan' | 'last' | 'none';

/** Pre-filled times of "Schultag buchen": the plan of the day, else the last school day, else empty (always editable). */
export function schoolDayDefaults(plan: PlanDay | null | undefined, last: WallTimes | null): WallTimes & { source: SchoolTimesSource } {
	const planned = isSchoolPlan(plan) ? planSchoolTimes(plan) : null;
	if (planned) return { ...planned, source: 'plan' };
	if (last) return { start: last.start, end: last.end, source: 'last' };
	return { start: '', end: '', source: 'none' };
}

export const schoolPlace = (places: Place[]): Place | null => places.find((p) => p.kind === 'school' && !p.archived) ?? null;

/** Marks offered in the day settings: "Schultag (Gutschrift)" only stays for a day that already carries it (Lino 26.11.2026). */
export function dayMarkOptions(current: DayMarkKind): DayMarkKind[] {
	return DAY_MARKS.filter((m) => m !== 'school_credit' || current === 'school_credit');
}

/** An old school-credit day without school times: the UI asks to add the times. */
export function needsSchoolTimes(mark: DayMarkKind | undefined, segments: Segment[]): boolean {
	return mark === 'school_credit' && !active(segments).some((s) => s.kind === 'school');
}

/** "Schule erfasst 5:30 → voller Schultag, angerechnet 7:42" instead of raw 0:00 plus credit; null without school time. */
export function schoolEvaluationText(evaluation: { mark?: DayMarkKind; creditSeconds: number }, segments: Segment[]): string | null {
	const seconds = active(segments).filter((s) => s.kind === 'school').reduce((sum, s) => sum + durationSeconds(s), 0);
	if (seconds <= 0) return null;
	const recorded = formatDuration(seconds);
	if (evaluation.creditSeconds > 0) return t('school.evaluation_full', { recorded, credited: formatDuration(evaluation.creditSeconds) });
	return t('school.evaluation_partial', { recorded });
}

const OFF_MARKS = new Set(['vacation', 'sick', 'holiday', 'excused', 'school', 'off']);

/** A past or current day planned as school without any school time: "Schule geplant, nichts gebucht". */
export function plannedSchoolWithoutBooking(day: TimeWeekDay): boolean {
	if (day.isFuture || OFF_MARKS.has(day.mark) || day.schoolSeconds > 0) return false;
	return day.planMode === 'school' || (day.planBlocks ?? []).some((b) => b.kind === 'school');
}

/** Today planned as school: the timer starts with kind school at the school place. */
export function timerPreset(plan: PlanDay | null | undefined, places: Place[]): { kind: SegmentKind; placeId: string } | null {
	if (!isSchoolPlan(plan)) return null;
	return { kind: 'school', placeId: schoolPlace(places)?.id ?? '' };
}

/** Work booked at a place of kind school is almost always a mistake: ask before starting. */
export const workAtSchoolPlace = (kind: SegmentKind, place: Place | undefined | null) => kind === 'work' && place?.kind === 'school';

export type SchoolCheckType = 'work_at_school' | 'planned_not_booked' | 'credit_without_times';

export interface SchoolCheckItem {
	/** stable key, also used to remember "Alles so lassen" */
	key: string;
	date: string;
	type: SchoolCheckType;
	segmentId?: string;
}

/**
 * "Schultage prüfen": earlier mis-bookings, newest day first. Nothing is changed here; every row needs a confirmation in the UI.
 * `marks` maps a date to its explicit day mark (only school-credit days matter).
 */
export function schoolCheckItems(days: TimeWeekDay[], marks: Partial<Record<string, DayMarkKind>>, segments: Segment[], places: Place[], timeZone: string): SchoolCheckItem[] {
	const items: SchoolCheckItem[] = [];
	const schoolIds = new Set(places.filter((p) => p.kind === 'school').map((p) => p.id));
	const schoolDates = new Set(active(segments).filter((s) => s.kind === 'school').map((s) => localDateOf(s.startedAt, timeZone)));
	for (const s of active(segments)) {
		if (s.kind === 'work' && s.placeId && schoolIds.has(s.placeId)) items.push({ key: `work:${s.id}`, date: localDateOf(s.startedAt, timeZone), type: 'work_at_school', segmentId: s.id });
	}
	for (const day of days) {
		if (plannedSchoolWithoutBooking(day) && !schoolDates.has(day.date)) items.push({ key: `plan:${day.date}`, date: day.date, type: 'planned_not_booked' });
		if (marks[day.date] === 'school_credit' && !day.isFuture && day.schoolSeconds === 0 && !schoolDates.has(day.date)) items.push({ key: `credit:${day.date}`, date: day.date, type: 'credit_without_times' });
	}
	return items.sort((a, b) => b.date.localeCompare(a.date));
}
