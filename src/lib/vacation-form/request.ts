import { api } from '../api/client';
import type { Absence, CalendarDay, VacationBalance, WorkModel } from '../api/types';
import { yearsOf } from '../planning/calendar';
import { countWorkingDays, freeDaysInSpan, mergeIntoRanges } from './days';
import { computeRemaining, splitVacationBlocks } from './remaining';
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
	/** The vacation absences of the balance year. Without them (null/undefined) earlier and later vacation cannot be told apart. */
	absences?: Absence[] | null;
	/** The absence the request is for; its own days are never counted as "other" vacation. */
	targetId?: string;
}

/**
 * Everything the data sources need, derived from the balance, the work models and the holidays.
 *
 * Remaining days as of the request = entitlement + carry-over + corrections - (taken + approved + requested + planned vacation
 * before the request's first day) - this request. Vacation after the request does not reduce that figure; it is shown
 * separately and in the year-end figure.
 */
export function buildRequestData(input: RequestInputs): RequestData {
	const { balance } = input;
	const workingDays = countWorkingDays(input.from, input.to, input.models, input.holidays, input.halfDayStart, input.halfDayEnd);
	const requestHalfDays = Math.round(workingDays * 2);
	// With a snapshot the stored remaining days replace entitlement and carry-over (balance semantics), so they stand in for the total.
	const base = balance.snapshotDate ? (balance.snapshotRemainingHalfDays ?? 0) : balance.entitlementHalfDays + balance.carryOverHalfDays;
	const total = base + balance.adjustmentHalfDays;
	const split = input.absences
		? splitVacationBlocks({
				from: input.from,
				to: input.to,
				halfDayStart: input.halfDayStart,
				halfDayEnd: input.halfDayEnd,
				targetId: input.targetId,
				absences: input.absences,
				models: input.models,
				holidays: input.holidays,
				year: Number(input.from.slice(0, 4)),
				snapshotDate: balance.snapshotDate
			})
		: null;
	const rest = computeRemaining({
		totalHalfDays: total,
		requestHalfDays,
		availableAfterPlannedHalfDays: balance.availableAfterPlannedHalfDays,
		inBalance: input.inBalance,
		bookedHalfDays: balance.bookedHalfDays,
		split
	});
	return {
		from: input.from,
		to: input.to,
		today: input.today,
		substitute: input.substitute ?? '',
		entitlementYearHalfDays: balance.snapshotDate ? (balance.snapshotRemainingHalfDays ?? 0) : balance.entitlementHalfDays,
		entitlementTotalHalfDays: total,
		carryOverHalfDays: balance.carryOverHalfDays,
		adjustmentHalfDays: balance.adjustmentHalfDays,
		restBeforeHalfDays: rest.restBeforeHalfDays,
		restAfterHalfDays: rest.restAfterHalfDays,
		restYearEndHalfDays: rest.restYearEndHalfDays,
		compensatedHalfDays: rest.consumedBeforeHalfDays,
		compensatedDecidedHalfDays: rest.consumedBeforeDecidedHalfDays,
		workingDays,
		breakdown: {
			entitlementTotalHalfDays: total,
			before: split?.before ?? [],
			later: split?.later ?? [],
			overlapping: split?.overlapping ?? [],
			consumedBeforeHalfDays: rest.consumedBeforeHalfDays,
			laterHalfDays: rest.laterHalfDays,
			requestHalfDays,
			restBeforeHalfDays: rest.restBeforeHalfDays,
			restAfterHalfDays: rest.restAfterHalfDays,
			restYearEndHalfDays: rest.restYearEndHalfDays,
			blocksKnown: rest.blocksKnown
		},
		freeRanges: mergeIntoRanges(freeDaysInSpan(input.from, input.to, input.models, input.holidays))
	};
}

export interface LoadedSources {
	balance: VacationBalance;
	models: WorkModel[];
	holidays: CalendarDay[];
	/** null when the list could not be loaded */
	absences: Absence[] | null;
}

/** Loads what a request needs from the existing endpoints (balance of the start year, work models, holidays of the span). */
export async function loadRequestSources(from: string, to: string): Promise<LoadedSources> {
	const year = Number(from.slice(0, 4));
	const [balance, models, holidayLists, absences] = await Promise.all([
		api.getVacationBalance(year),
		api.listWorkModels(),
		Promise.all(yearsOf(from, to).map((y) => api.listHolidays(y))),
		// Needed to tell vacation before the request from vacation after it; the form still works without it (e.g. planning module off).
		api.listAbsences(`${year}-01-01`, `${year}-12-31`).catch((): Absence[] | null => null)
	]);
	return { balance, models, holidays: holidayLists.flat(), absences };
}
