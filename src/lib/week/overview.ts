import type { PlanMode, TimeWeekDay, TimeWeekSummary, WeekMark } from '#lib/api/types.js';
import { t, type MessageKey } from '#lib/i18n/index.js';
import { absenceKindLabel } from '#lib/planning/labels.js';
import { formatDateLong } from '#lib/time/dates.js';
import { absenceWarning, chipAbsences } from './absences.js';
import { vacationTooltip, type VacationEntry } from './vacation.js';
import { formatDelta, formatDuration } from '#lib/time/format.js';

/** Presentation rules of the week overview (K1, ADR-0021); pure so they can be unit tested. */

export const WEEK_MARKS: WeekMark[] = ['work', 'school', 'vacation', 'sick', 'holiday', 'excused', 'off'];

export const weekMarkLabel = (mark: WeekMark) => t(`weekview.mark.${mark}`);
export const planModeShort = (mode: PlanMode) => t(`plan.mode.${mode}`);

/** Soft chip colours per mark; the label text is always shown next to the icon (colour is never the only signal). */
export const MARK_CLASSES: Record<WeekMark, string> = {
	work: 'bg-ui-accent-soft text-ui-accent-ink',
	school: 'bg-indigo-500/15 text-indigo-900 dark:text-indigo-200',
	vacation: 'bg-sky-500/15 text-sky-900 dark:text-sky-200',
	sick: 'bg-rose-500/15 text-rose-900 dark:text-rose-200',
	holiday: 'bg-amber-500/20 text-amber-900 dark:text-amber-200',
	excused: 'bg-teal-500/15 text-teal-900 dark:text-teal-200',
	off: 'bg-muted text-muted-foreground'
};

/** Hours shown for a day: evaluated work plus credit (school credit, paid absence), like the Zeit page. */
export const dayHours = (day: TimeWeekDay) => day.workSeconds + day.creditSeconds;

/** Width in percent of the actual and the planned bar; both are relative to the larger of target, planned and actual. */
export function barShares(day: TimeWeekDay): { actual: number; planned: number; target: number } {
	const actual = dayHours(day);
	const planned = day.plannedSeconds ?? 0;
	const scale = Math.max(day.targetSeconds, planned, actual, 1);
	const pct = (value: number) => Math.min(100, Math.round((value / scale) * 1000) / 10);
	return { actual: pct(actual), planned: pct(planned), target: pct(day.targetSeconds) };
}

/** True for a week that has nothing to show: no work, no marks, no plan. */
export function isEmptyWeek(days: TimeWeekDay[]): boolean {
	return days.every((day) => day.segmentsCount === 0 && day.creditSeconds === 0 && day.plannedSeconds === null && (day.mark === 'work' || day.mark === 'off'));
}

/** Screen reader label of a day card, e.g. "Dienstag, 20.10.2026: 7:42 Stunden, Saldo plus 0:12, Büro". */
export function dayAriaLabel(day: TimeWeekDay, vacation: VacationEntry[] | null = null): string {
	const parts = [formatDateLong(day.date)];
	if (day.mark !== 'work') parts.push(weekMarkLabel(day.mark));
	for (const entry of vacation ?? []) parts.push(vacationTooltip(entry));
	for (const absence of chipAbsences(day, vacation !== null)) {
		const warning = absenceWarning(absence.status);
		parts.push(warning ? `${absenceKindLabel(absence.kind)}, ${warning}` : absenceKindLabel(absence.kind));
	}
	if (day.isFuture) {
		if (day.plannedSeconds !== null) parts.push(t('weekview.aria_planned', { time: formatDuration(day.plannedSeconds) }));
	} else {
		parts.push(t('weekview.aria_hours', { time: formatDuration(dayHours(day)) }));
		if (day.balanceSeconds !== null) {
			const sign = day.balanceSeconds > 0 ? 'plus ' : day.balanceSeconds < 0 ? 'minus ' : '';
			parts.push(t('weekview.aria_balance', { balance: sign + formatDuration(Math.abs(day.balanceSeconds)) }));
		}
	}
	if (day.planMode && !['vacation', 'sick', 'holiday', 'excused'].includes(day.mark)) parts.push(planModeShort(day.planMode));
	if (day.provisional && !day.isFuture) parts.push(t('weekview.provisional'));
	return parts.join(', ');
}

const plural = (count: number, one: MessageKey, other: MessageKey) => t(count === 1 ? one : other, { count: formatCount(count) });
const formatCount = (value: number) => String(value).replace('.', ',');

/** "1 Urlaubstag, 1 Feiertag" style list of the non-work days of the week; empty when there are none. */
export function noteworthyDays(summary: TimeWeekSummary): string[] {
	const items: string[] = [];
	if (summary.vacationDays > 0) items.push(plural(summary.vacationDays, 'weekview.sentence.vacation_one', 'weekview.sentence.vacation_other'));
	if (summary.sickDays > 0) items.push(plural(summary.sickDays, 'weekview.sentence.sick_one', 'weekview.sentence.sick_other'));
	if (summary.schoolDays > 0) items.push(plural(summary.schoolDays, 'weekview.sentence.school_one', 'weekview.sentence.school_other'));
	if (summary.holidayDays > 0) items.push(plural(summary.holidayDays, 'weekview.sentence.holiday_one', 'weekview.sentence.holiday_other'));
	return items;
}

/**
 * "Diese Woche: 31:15 Std. gearbeitet, 2:15 Std. unter Soll; 1 Urlaubstag, 1 Feiertag". Compares with the target up to
 * today (a running week has no deficit for days that have not happened).
 */
export function summarySentence(summary: TimeWeekSummary, current: boolean, weekNumber: number): string {
	const prefix = current ? t('weekview.sentence.this_week') : t('weekview.sentence.week_n', { week: weekNumber });
	const worked = formatDuration(summary.workSeconds + summary.creditSeconds);
	const diff = summary.balanceSeconds;
	let comparison: string;
	if (summary.targetToDateSeconds === 0 && diff === 0) comparison = '';
	else if (diff === 0) comparison = t('weekview.sentence.on_target');
	else comparison = t(diff < 0 ? 'weekview.sentence.under' : 'weekview.sentence.over', { time: formatDuration(Math.abs(diff)) });
	const head = t('weekview.sentence.worked', { prefix, time: worked }) + (comparison ? `, ${comparison}` : '');
	const extras = noteworthyDays(summary);
	return extras.length > 0 ? `${head}; ${extras.join(', ')}.` : `${head}.`;
}

export const balanceTone = (seconds: number | null): 'success' | 'warning' | 'neutral' =>
	seconds === null || seconds === 0 ? 'neutral' : seconds > 0 ? 'success' : 'warning';

export { formatDelta };
