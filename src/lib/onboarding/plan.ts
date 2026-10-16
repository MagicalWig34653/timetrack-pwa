import type { ModuleKey, ModuleStatus, VacationSettings, WorkModel, WorkModelInput } from '#lib/api/types.js';
import { SUGGESTED_SETTINGS } from '#lib/planning/regions.js';
import { buildWorkModelInput, defaultWorkModelForm, formFromModel, type WorkModelFormErrors, type WorkModelFormValues } from '#lib/time/work-model-form.js';
import { parseDaysInput } from '#lib/vacation/halfdays.js';
import { isValidDate } from '#lib/time/dates.js';

/** The steps of the guided setup in order; `vacation` and `modules` can be hidden (see `visibleSteps`). */
export type StepId = 'model' | 'breaks' | 'school' | 'vacation' | 'modules' | 'summary';
export const ALL_STEPS: StepId[] = ['model', 'breaks', 'school', 'vacation', 'modules', 'summary'];

export interface VacationFormValues {
	days: string;
	region: string;
	snapshotDate: string;
	snapshotDays: string;
}

export interface SetupDraft {
	model: WorkModelFormValues;
	vacation: VacationFormValues;
	/** modules the user wants switched off (only modules the server offers) */
	modulesOff: ModuleKey[];
	/** sections the user skipped explicitly */
	skipped: { model: boolean; breaks: boolean; school: boolean; vacation: boolean; modules: boolean };
}

/** Prefilled values: repo defaults (ADR-0005 suggestions), or the current values when the account already has settings. */
export function initialDraft(today: string, zone: string, newest: WorkModel | undefined, vacation: VacationSettings | null): SetupDraft {
	return {
		model: newest ? formFromModel(newest, today) : defaultWorkModelForm(today, zone),
		vacation: {
			days: vacation?.configured ? String(vacation.annualEntitlementHalfDays / 2).replace('.', ',') : String(SUGGESTED_SETTINGS.annualEntitlementHalfDays / 2),
			region: vacation?.configured ? vacation.region : SUGGESTED_SETTINGS.region,
			snapshotDate: '',
			snapshotDays: ''
		},
		modulesOff: [],
		skipped: { model: false, breaks: false, school: false, vacation: false, modules: false }
	};
}

/** Daily target in seconds derived from weekly hours and the number of workdays; null while the inputs are invalid. */
export function dailyTargetSeconds(weeklySeconds: number | null, workdays: number): number | null {
	return weeklySeconds !== null && workdays > 0 ? Math.round(weeklySeconds / workdays) : null;
}

/** Steps shown for this account: planning off hides the vacation step, a server that offers no switchable module hides that step. */
export function visibleSteps(statuses: ModuleStatus[] | null): StepId[] {
	const planningOn = statuses ? (statuses.find((s) => s.key === 'planning')?.effective ?? true) : true;
	const switchable = statuses ? statuses.some((s) => s.serverEnabled) : true;
	return ALL_STEPS.filter((step) => (step !== 'vacation' || planningOn) && (step !== 'modules' || switchable));
}

export type VacationPlan =
	| { settings: VacationSettings; snapshot: { date: string; remainingHalfDays: number } | null }
	| { errors: Partial<Record<'days' | 'snapshot', string>> };

/** Validates the vacation step. Messages are German user texts supplied by the caller. */
export function buildVacationPlan(values: VacationFormValues, current: VacationSettings | null, texts: { days: string; snapshot: string }): VacationPlan {
	const errors: Partial<Record<'days' | 'snapshot', string>> = {};
	const halfDays = parseDaysInput(values.days);
	if (halfDays === null) errors.days = texts.days;
	const hasDate = values.snapshotDate.trim() !== '';
	const hasDays = values.snapshotDays.trim() !== '';
	const snapshotHalfDays = hasDays ? parseDaysInput(values.snapshotDays) : null;
	if (hasDate !== hasDays || (hasDate && !isValidDate(values.snapshotDate)) || (hasDays && snapshotHalfDays === null)) errors.snapshot = texts.snapshot;
	if (Object.keys(errors).length > 0) return { errors };
	return {
		settings: {
			region: values.region,
			annualEntitlementHalfDays: halfDays!,
			// existing carry-over rules stay untouched
			carryOverByYear: current?.carryOverByYear ?? {},
			carryOverExpiry: current?.carryOverExpiry ?? null
		},
		snapshot: hasDate ? { date: values.snapshotDate, remainingHalfDays: snapshotHalfDays! } : null
	};
}

export function buildModelPlan(values: WorkModelFormValues): { input: WorkModelInput } | { errors: WorkModelFormErrors } {
	return buildWorkModelInput(values);
}
