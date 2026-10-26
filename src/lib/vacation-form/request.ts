import { api } from '../api/client';
import type { Absence, CalendarDay, VacationBalance, WorkModel } from '../api/types';
import { halfDaysWithStatus } from '../vacation/breakdown';
import { yearsOf } from '../planning/calendar';
import { countWorkingDays, freeDaysInSpan, mergeIntoRanges } from './days';
import type { RequestData } from './types';

export interface RequestInputs {
	from: string;
	to: string;
	halfDayStart?: boolean;
	halfDayEnd?: boolean;
	today: string;
	substitute?: string;
	balance: VacationBalance;
	models: WorkModel[];
	holidays: CalendarDay[];
	/** true when the absence already counts in the balance as planned or booked vacation */
	inBalance: boolean;
	/** The vacation absences of the balance year; lets planned (not submitted) vacation be told from requested vacation. */
	absences?: Absence[];
	/** The absence the request is for; its own days are never counted as "other" planned vacation. */
	targetId?: string;
}

/** Everything the data sources need, derived from the balance, the work models and the holidays. */
export function buildRequestData(input: RequestInputs): RequestData {
	const { balance } = input;
	const workingDays = countWorkingDays(input.from, input.to, input.models, input.holidays, input.halfDayStart, input.halfDayEnd);
	const requestHalfDays = Math.round(workingDays * 2);
	// With a snapshot the stored remaining days replace entitlement and carry-over (balance semantics), so they stand in for the total.
	const base = balance.snapshotDate ? (balance.snapshotRemainingHalfDays ?? 0) : balance.entitlementHalfDays + balance.carryOverHalfDays;
	const absences = input.absences ?? [];
	// The balance deducts planned AND requested vacation. Other plans that were not submitted yet are no claim on the
	// entitlement, so the form's "rest" leaves them out; the conservative figure (everything planned deducted) stays visible.
	const plannedOthers = halfDaysWithStatus(absences, 'planned', input.targetId);
	const restBeforeIncl = balance.availableAfterPlannedHalfDays + (input.inBalance ? requestHalfDays : 0);
	const restBefore = restBeforeIncl + plannedOthers;
	const requestedOthers = Math.max(0, balance.plannedHalfDays - plannedOthers - (input.inBalance ? requestHalfDays : 0));
	return {
		from: input.from,
		to: input.to,
		today: input.today,
		substitute: input.substitute ?? '',
		entitlementYearHalfDays: balance.snapshotDate ? (balance.snapshotRemainingHalfDays ?? 0) : balance.entitlementHalfDays,
		entitlementTotalHalfDays: base + balance.adjustmentHalfDays,
		carryOverHalfDays: balance.carryOverHalfDays,
		adjustmentHalfDays: balance.adjustmentHalfDays,
		restBeforeHalfDays: restBefore,
		restAfterHalfDays: restBefore - requestHalfDays,
		workingDays,
		breakdown: {
			entitlementTotalHalfDays: base + balance.adjustmentHalfDays,
			bookedHalfDays: balance.bookedHalfDays,
			requestedOthersHalfDays: requestedOthers,
			plannedOthersHalfDays: plannedOthers,
			requestHalfDays,
			restBeforeHalfDays: restBefore,
			restAfterHalfDays: restBefore - requestHalfDays,
			restBeforeInclPlannedHalfDays: restBeforeIncl,
			restAfterInclPlannedHalfDays: restBeforeIncl - requestHalfDays
		},
		freeRanges: mergeIntoRanges(freeDaysInSpan(input.from, input.to, input.models, input.holidays))
	};
}

export interface LoadedSources {
	balance: VacationBalance;
	models: WorkModel[];
	holidays: CalendarDay[];
	absences: Absence[];
}

/** Loads what a request needs from the existing endpoints (balance of the start year, work models, holidays of the span). */
export async function loadRequestSources(from: string, to: string): Promise<LoadedSources> {
	const year = Number(from.slice(0, 4));
	const [balance, models, holidayLists, absences] = await Promise.all([
		api.getVacationBalance(year),
		api.listWorkModels(),
		Promise.all(yearsOf(from, to).map((y) => api.listHolidays(y))),
		// Only used to split planned from requested vacation; the form still works without it (e.g. planning module off).
		api.listAbsences(`${year}-01-01`, `${year}-12-31`).catch((): Absence[] => [])
	]);
	return { balance, models, holidays: holidayLists.flat(), absences };
}
