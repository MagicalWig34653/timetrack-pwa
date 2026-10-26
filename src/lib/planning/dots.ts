import type { DayInfo } from './calendar';

export type DotColor = 'holiday' | 'school_holiday' | 'vacation' | 'sick' | 'excused' | 'other' | 'office' | 'home' | 'customer' | 'school' | 'off' | 'worked';

export interface Dot {
	/** Same keys as the legend filter (holiday, school_holiday, vacation, sick, ..., plan, worked) */
	kind: string;
	color: DotColor;
	/** planned or requested vacation: drawn as a ring instead of a filled dot */
	hollow: boolean;
}

/** Text colour classes (the dot uses `bg-current`); `ring-current` draws the hollow variant. */
export const DOT_CLASSES: Record<DotColor, string> = {
	holiday: 'bg-amber-500 text-amber-500',
	school_holiday: 'bg-yellow-400 text-yellow-500',
	vacation: 'bg-sky-500 text-sky-500',
	sick: 'bg-rose-500 text-rose-500',
	excused: 'bg-teal-500 text-teal-500',
	other: 'bg-violet-500 text-violet-500',
	office: 'bg-emerald-500 text-emerald-500',
	home: 'bg-teal-400 text-teal-400',
	customer: 'bg-orange-500 text-orange-500',
	school: 'bg-indigo-500 text-indigo-500',
	off: 'bg-zinc-400 text-zinc-400',
	worked: 'bg-foreground/60 text-foreground/60'
};

/**
 * The coloured dots of one calendar day in the order holiday, school holiday, absences, plan, worked time. Filters from the
 * legend (`hidden`) apply as in the chip view. Colour is never the only signal: the cell's accessible name lists everything.
 */
export function dotsOf(info: DayInfo, hidden: Set<string> = new Set()): Dot[] {
	const dots: Dot[] = [];
	if (!hidden.has('holiday')) for (let i = 0; i < info.holidays.length; i++) dots.push({ kind: 'holiday', color: 'holiday', hollow: false });
	if (!hidden.has('school_holiday') && info.schoolHolidays.length > 0) dots.push({ kind: 'school_holiday', color: 'school_holiday', hollow: false });
	for (const absence of info.absences) {
		if (hidden.has(absence.kind)) continue;
		dots.push({ kind: absence.kind, color: absence.kind, hollow: absence.status === 'planned' || absence.status === 'requested' });
	}
	if (info.plan && !hidden.has('plan')) dots.push({ kind: 'plan', color: info.plan.mode, hollow: false });
	if (info.evaluation && info.evaluation.evaluatedWorkSeconds > 0 && !hidden.has('worked')) dots.push({ kind: 'worked', color: 'worked', hollow: false });
	return dots;
}
