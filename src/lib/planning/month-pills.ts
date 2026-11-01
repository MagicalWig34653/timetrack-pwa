import type { Absence, PlanMode } from '#lib/api/types.js';
import type { DayInfo } from './calendar.js';

/**
 * Pills of one month cell (U1): compact coloured labels for absences, holidays and the plan kind. Multi-day absences are
 * drawn as one continuous bar per calendar week: every cell of the run renders a segment that reaches over the cell edge
 * on the continuing side, only the first segment of a week carries the (truncated) label.
 */
export interface MonthPill {
	key: string;
	kind: 'absence' | 'holiday' | 'school_holiday' | 'plan';
	/** Visible label; empty for a continuation segment of a bar (the bar of the previous cell carries the text) */
	label: string;
	absence?: Absence;
	/** the bar continues into the previous / next cell of the same week row */
	continuesLeft: boolean;
	continuesRight: boolean;
	/** planned or requested vacation: hatched instead of solid */
	open: boolean;
	half: boolean;
	treatment?: string | null;
	planMode?: PlanMode;
	/** Accessible-name text for the visible label (half company days add the hint) */
	nameText: string;
}

export interface MonthPills {
	pills: MonthPill[];
	/** pills that did not fit; shown as "+n" */
	more: number;
	/** only one slot is free: the first pill stays visible and "+n" moves into the cell corner next to the day number */
	moreInCorner: boolean;
}

export interface PillLabels {
	absence: (a: Absence) => string;
	plan: (mode: PlanMode) => string;
	holidayHint: (name: string, treatment: string | null | undefined) => string;
}

/** Monday = 0 ... Sunday = 6 */
export function weekdayIndex(date: string): number {
	return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function monthPills(info: DayInfo, hidden: Set<string>, labels: PillLabels, max: number): MonthPills {
	const all: MonthPill[] = [];
	const weekday = weekdayIndex(info.date);
	const absences = [...info.absences].filter((a) => !hidden.has(a.kind)).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
	for (const a of absences) {
		const continuesLeft = a.startDate < info.date && weekday > 0;
		const continuesRight = a.endDate > info.date && weekday < 6;
		const label = continuesLeft ? '' : labels.absence(a);
		all.push({ key: `a-${a.id}`, kind: 'absence', label, absence: a, continuesLeft, continuesRight, open: a.status === 'planned' || a.status === 'requested', half: !!((a.halfDayStart && a.startDate === info.date) || (a.halfDayEnd && a.endDate === info.date)), nameText: label });
	}
	if (!hidden.has('holiday')) {
		for (const h of info.holidays) {
			const half = h.companyTreatment === 'half';
			all.push({ key: `h-${h.name}-${h.startDate}`, kind: 'holiday', label: h.name, continuesLeft: false, continuesRight: false, open: false, half, treatment: h.companyTreatment, nameText: half ? `${h.name} ½ ${labels.holidayHint(h.name, 'half')}`.replace(/\s+/g, ' ') : h.name });
		}
	}
	if (!hidden.has('school_holiday')) {
		for (const h of info.schoolHolidays) all.push({ key: `s-${h.name}-${h.startDate}`, kind: 'school_holiday', label: h.name, continuesLeft: false, continuesRight: false, open: false, half: false, nameText: h.name });
	}
	if (info.plan && !hidden.has('plan')) {
		const label = labels.plan(info.plan.mode);
		all.push({ key: 'plan', kind: 'plan', label, continuesLeft: false, continuesRight: false, open: false, half: false, planMode: info.plan.mode, nameText: label });
	}
	const slots = Math.max(1, max);
	if (all.length <= slots) return { pills: all, more: 0, moreInCorner: false };
	// One slot: the most important pill (absences come first) must stay visible; "+n" goes into the cell corner.
	if (slots === 1) return { pills: all.slice(0, 1), more: all.length - 1, moreInCorner: true };
	// otherwise the "+n" pill takes the last slot
	return { pills: all.slice(0, slots - 1), more: all.length - (slots - 1), moreInCorner: false };
}

/** Text of the cell that is visible: day number then the pill labels and the "+n" counter (accessible name must start with it, WCAG 2.5.3). */
export function visibleText(date: string, shown: MonthPill[], more = 0): string {
	return [String(Number(date.slice(8))), ...shown.map((p) => p.nameText).filter(Boolean), ...(more > 0 ? [`+${more}`] : [])].join(' ');
}
