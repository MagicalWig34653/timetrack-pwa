import { api } from '../api/client';
import type { CalendarDay, VacationBalance, WorkModel } from '../api/types';
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
}

/** Everything the data sources need, derived from the balance, the work models and the holidays. */
export function buildRequestData(input: RequestInputs): RequestData {
	const { balance } = input;
	const workingDays = countWorkingDays(input.from, input.to, input.models, input.holidays, input.halfDayStart, input.halfDayEnd);
	const requestHalfDays = Math.round(workingDays * 2);
	// With a snapshot the stored remaining days replace entitlement and carry-over (balance semantics), so they stand in for the total.
	const base = balance.snapshotDate ? (balance.snapshotRemainingHalfDays ?? 0) : balance.entitlementHalfDays + balance.carryOverHalfDays;
	const restBefore = balance.availableAfterPlannedHalfDays + (input.inBalance ? requestHalfDays : 0);
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
		freeRanges: mergeIntoRanges(freeDaysInSpan(input.from, input.to, input.models, input.holidays))
	};
}

export interface LoadedSources {
	balance: VacationBalance;
	models: WorkModel[];
	holidays: CalendarDay[];
}

/** Loads what a request needs from the existing endpoints (balance of the start year, work models, holidays of the span). */
export async function loadRequestSources(from: string, to: string): Promise<LoadedSources> {
	const [balance, models, holidayLists] = await Promise.all([
		api.getVacationBalance(Number(from.slice(0, 4))),
		api.listWorkModels(),
		Promise.all(yearsOf(from, to).map((year) => api.listHolidays(year)))
	]);
	return { balance, models, holidays: holidayLists.flat() };
}
