import type { Absence, VacationBalance } from '../api/types';

/**
 * The backend balance (contract 0.30.x) reports `plannedHalfDays` as ONE figure for status `planned` OR `requested`
 * (`availableAfterPlannedHalfDays` already deducts both). To tell vacation that is only planned (not submitted) from
 * vacation that was requested, the absence list of the year is used: `countedHalfDays` per absence with its status.
 */
export interface PlannedSplit {
	/** status `planned`: not submitted, so not a claim on the entitlement yet */
	unsubmittedHalfDays: number;
	/** status `requested`: submitted, decision pending */
	requestedHalfDays: number;
}

const isVacation = (absence: Absence) => absence.kind === 'vacation';

/** Half days of vacation absences with the given status, optionally without one absence (the one being requested). */
export function halfDaysWithStatus(absences: Absence[], status: Absence['status'], excludeId?: string): number {
	return absences.filter((absence) => isVacation(absence) && absence.status === status && absence.id !== excludeId).reduce((sum, absence) => sum + absence.countedHalfDays, 0);
}

/**
 * Splits the planned figure of the balance. `requestedHalfDays` is what the balance holds beyond the unsubmitted plans, so the
 * two always add up to `plannedHalfDays` (never negative, never more than the balance reports).
 */
export function splitPlanned(balance: Pick<VacationBalance, 'plannedHalfDays'>, absences: Absence[]): PlannedSplit {
	const unsubmitted = Math.min(Math.max(0, halfDaysWithStatus(absences, 'planned')), balance.plannedHalfDays);
	return { unsubmittedHalfDays: unsubmitted, requestedHalfDays: balance.plannedHalfDays - unsubmitted };
}
