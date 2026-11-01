import type { Absence, AbsenceStatus, CalendarDay, WorkModel } from '../api/types';
import { addDays } from '../time/dates';
import { countWorkingDays } from './days';

/** Statuses that consume entitlement: the backend balance counts booked (approved, taken) and planned (planned, requested). */
const COUNTED: readonly AbsenceStatus[] = ['planned', 'requested', 'approved', 'taken'];
/** Decided = already granted or taken; the rest is still open. */
const DECIDED: readonly AbsenceStatus[] = ['approved', 'taken'];

export const isCountedStatus = (status: AbsenceStatus) => COUNTED.includes(status);
export const isDecidedStatus = (status: AbsenceStatus) => DECIDED.includes(status);

/** One other vacation block (or the part of it) on one side of the request, in half days. */
export interface VacationBlock {
	id: string;
	/** the whole absence, for display */
	from: string;
	to: string;
	status: AbsenceStatus;
	/** half days of the part that lies on this side of the request (inside the entitlement year) */
	halfDays: number;
	/** the absence reaches beyond this side (request period, year boundary or snapshot date) */
	partial: boolean;
}

export interface BlockSplit {
	/** vacation lying before the first day of the request: consumed before it */
	before: VacationBlock[];
	/** vacation lying after the last day of the request */
	later: VacationBlock[];
	/** other vacation overlapping the request period; its days in the period belong to the request and are not counted twice */
	overlapping: VacationBlock[];
}

export interface SplitInput {
	from: string;
	to: string;
	halfDayStart?: boolean;
	halfDayEnd?: boolean;
	/** the absence the request is for; never an "other" block */
	targetId?: string;
	absences: Absence[];
	models: WorkModel[];
	holidays: CalendarDay[];
	/** Entitlement year of the request (balance year = year of its first day). */
	year: number;
	/** A balance snapshot replaces everything before its date, so earlier vacation does not count. */
	snapshotDate?: string | null;
}

const byStart = (a: VacationBlock, b: VacationBlock) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to);

/**
 * Sorts the other vacation of the entitlement year into "before", "later" and "overlapping" relative to the request.
 * Works on days, not on whole absences: a block that starts before the request and runs into it counts only with its days
 * before the first request day; the part after the last request day is "later"; days inside the request period are the
 * request itself. Half days at the edges of absences are kept; two half days that meet on one day (previous block ends
 * with half a day on the first request day, and the request starts with half a day) both count.
 */
export function splitVacationBlocks(input: SplitInput): BlockSplit {
	const yearStart = input.snapshotDate && input.snapshotDate.startsWith(String(input.year)) ? input.snapshotDate : `${input.year}-01-01`;
	const yearEnd = `${input.year}-12-31`;
	const result: BlockSplit = { before: [], later: [], overlapping: [] };

	const part = (absence: Absence, lo: string, hi: string): { halfDays: number; partial: boolean } | null => {
		const start = absence.startDate > lo ? absence.startDate : lo;
		const end = absence.endDate < hi ? absence.endDate : hi;
		if (start > end) return null;
		const whole = start === absence.startDate && end === absence.endDate;
		// The server's own count is authoritative for a block that lies completely inside the window.
		const halfDays = whole
			? absence.countedHalfDays
			: Math.round(countWorkingDays(start, end, input.models, input.holidays, absence.halfDayStart === true && start === absence.startDate, absence.halfDayEnd === true && end === absence.endDate) * 2);
		return halfDays > 0 ? { halfDays, partial: !whole } : null;
	};

	for (const absence of input.absences) {
		if (absence.kind !== 'vacation' || !isCountedStatus(absence.status) || absence.id === input.targetId) continue;
		const block = (p: { halfDays: number; partial: boolean }): VacationBlock => ({ id: absence.id, from: absence.startDate, to: absence.endDate, status: absence.status, ...p });

		// A half day on the shared edge day stays on its side when the request leaves the other half free.
		const beforeHi = absence.endDate === input.from && absence.halfDayEnd === true && input.halfDayStart === true ? input.from : addDays(input.from, -1);
		const laterLo = absence.startDate === input.to && absence.halfDayStart === true && input.halfDayEnd === true ? input.to : addDays(input.to, 1);
		const before = part(absence, yearStart, beforeHi);
		const later = part(absence, laterLo, yearEnd);
		if (before) result.before.push(block({ ...before, partial: before.partial || absence.endDate > beforeHi }));
		if (later) result.later.push(block({ ...later, partial: later.partial || absence.startDate < laterLo }));
		if (absence.startDate < laterLo && absence.endDate > beforeHi) result.overlapping.push(block({ halfDays: 0, partial: true }));
	}
	result.before.sort(byStart);
	result.later.sort(byStart);
	result.overlapping.sort(byStart);
	return result;
}

export const sumHalfDays = (blocks: VacationBlock[]) => blocks.reduce((sum, block) => sum + block.halfDays, 0);

export interface Remaining {
	/** entitlement + carry-over (or snapshot remainder) + corrections */
	totalHalfDays: number;
	/** every block before the request, whatever its status */
	consumedBeforeHalfDays: number;
	/** the part of that which is approved or taken */
	consumedBeforeDecidedHalfDays: number;
	/** total - everything before the request */
	restBeforeHalfDays: number;
	/** restBefore - request */
	restAfterHalfDays: number;
	/** total - every other block (before and later) - request; authoritative from the server balance */
	restYearEndHalfDays: number;
	/** what lies after the request period */
	laterHalfDays: number;
	/** false when the absence list could not be loaded: before/later are then unknown and everything counts as "before" */
	blocksKnown: boolean;
}

export interface RemainingInput {
	totalHalfDays: number;
	requestHalfDays: number;
	/** `availableAfterPlannedHalfDays` of the balance: total minus approved/taken minus planned/requested, own absence included if in the balance */
	availableAfterPlannedHalfDays: number;
	/** the request's own absence is part of the balance figures */
	inBalance: boolean;
	/** booked (approved/taken) half days of the balance, used when the block list is missing */
	bookedHalfDays: number;
	split: BlockSplit | null;
}

/**
 * Remaining days as of the request: total - (taken + approved + requested + planned vacation before the request's first day)
 * - the request. Vacation after the request does not reduce it; the year-end figure subtracts everything.
 */
export function computeRemaining(input: RemainingInput): Remaining {
	const restYearEnd = input.availableAfterPlannedHalfDays - (input.inBalance ? 0 : input.requestHalfDays);
	if (!input.split) {
		// Without the block list nothing can be told apart: stay conservative and treat all other vacation as earlier.
		const restBefore = restYearEnd + input.requestHalfDays;
		return {
			totalHalfDays: input.totalHalfDays,
			consumedBeforeHalfDays: input.totalHalfDays - restBefore,
			consumedBeforeDecidedHalfDays: Math.min(input.bookedHalfDays, input.totalHalfDays - restBefore),
			restBeforeHalfDays: restBefore,
			restAfterHalfDays: restYearEnd,
			restYearEndHalfDays: restYearEnd,
			laterHalfDays: 0,
			blocksKnown: false
		};
	}
	const consumed = sumHalfDays(input.split.before);
	const decided = sumHalfDays(input.split.before.filter((block) => isDecidedStatus(block.status)));
	const restBefore = input.totalHalfDays - consumed;
	const restAfter = restBefore - input.requestHalfDays;
	return {
		totalHalfDays: input.totalHalfDays,
		consumedBeforeHalfDays: consumed,
		consumedBeforeDecidedHalfDays: decided,
		restBeforeHalfDays: restBefore,
		restAfterHalfDays: restAfter,
		restYearEndHalfDays: restYearEnd,
		laterHalfDays: Math.max(0, restAfter - restYearEnd),
		blocksKnown: true
	};
}
