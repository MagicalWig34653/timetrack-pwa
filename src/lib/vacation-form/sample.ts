import type { FormMapping, RequestData } from './types';

/** Neutral example values for the settings preview (never real data). */
export const SAMPLE_REQUEST: RequestData = {
	from: '2026-07-06',
	to: '2026-07-17',
	today: '2026-06-01',
	substitute: 'Erika Beispiel',
	entitlementYearHalfDays: 60,
	entitlementTotalHalfDays: 68,
	carryOverHalfDays: 8,
	adjustmentHalfDays: 0,
	restBeforeHalfDays: 44,
	restAfterHalfDays: 24,
	workingDays: 10,
	freeRanges: [
		{ from: '2026-07-11', to: '2026-07-12' },
		{ from: '2026-07-18', to: '2026-07-19' }
	]
};

/** Preview uses example text for empty person values so every mapped field shows something. */
export function previewMapping(mapping: FormMapping): FormMapping {
	const fallback = { lastName: 'Mustermann', firstName: 'Max', personnelNo: '12345', department: 'Technik', place: 'Musterstadt' };
	const person = { ...mapping.person };
	for (const key of Object.keys(fallback) as (keyof typeof fallback)[]) if (!person[key].trim()) person[key] = fallback[key];
	return { ...mapping, person, flatten: true };
}
