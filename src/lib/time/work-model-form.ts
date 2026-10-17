import type { FixedBreak, WorkModel, WorkModelInput } from '#lib/api/types.js';
import { t } from '#lib/i18n/index.js';
import { isValidDate } from './dates.js';
import { formatDuration, parseDuration } from './format.js';

export interface WorkModelFormValues {
	validFrom: string;
	/** '' = open-ended; only sent when correcting a version */
	validTo: string;
	timezone: string;
	weeklyTarget: string;
	workdays: number[];
	travelCountsAsWork: boolean;
	roundingEnabled: boolean;
	roundingMinutes: string;
	schoolThreshold: string;
	schoolCredit: string;
	dayBoundaryMinutes: string;
	fixedBreaks: FixedBreak[];
	/** Per-weekday targets are not editable here; they are carried over unchanged so a correction does not drop them. */
	dailyTargetSeconds?: Record<string, number>;
}

export type WorkModelFormErrors = Partial<Record<'validFrom' | 'validTo' | 'timezone' | 'weeklyTarget' | 'workdays' | 'roundingMinutes' | 'schoolThreshold' | 'schoolCredit' | 'dayBoundaryMinutes' | 'fixedBreaks', string>>;

export function defaultWorkModelForm(today: string, timezone: string): WorkModelFormValues {
	return {
		validFrom: today,
		validTo: '',
		timezone,
		weeklyTarget: '38:30',
		workdays: [1, 2, 3, 4, 5],
		travelCountsAsWork: true,
		roundingEnabled: true,
		roundingMinutes: '15',
		schoolThreshold: '3:00',
		schoolCredit: '',
		dayBoundaryMinutes: '0',
		fixedBreaks: []
	};
}

/** Prefills a new version from an existing one (validFrom stays editable and defaults to `validFrom`). */
export function formFromModel(model: WorkModel, validFrom: string, validTo: string = ''): WorkModelFormValues {
	return {
		validFrom,
		validTo,
		...(model.dailyTargetSeconds && Object.keys(model.dailyTargetSeconds).length > 0 ? { dailyTargetSeconds: { ...model.dailyTargetSeconds } } : {}),
		timezone: model.timezone ?? 'Europe/Berlin',
		weeklyTarget: formatDuration(model.weeklyTargetSeconds),
		workdays: [...model.workdays],
		travelCountsAsWork: model.travelCountsAsWork ?? true,
		roundingEnabled: model.roundingEnabled ?? true,
		roundingMinutes: String(model.roundingMinutes ?? 15),
		schoolThreshold: formatDuration(model.schoolFullDayThresholdSeconds ?? 10800),
		schoolCredit: model.schoolCreditSeconds == null ? '' : formatDuration(model.schoolCreditSeconds),
		dayBoundaryMinutes: String(model.dayBoundaryMinutes ?? 0),
		fixedBreaks: (model.fixedBreaks ?? []).map((b) => ({ ...b }))
	};
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** Validates the form and builds the API payload; errors are German user texts keyed by field. */
export function buildWorkModelInput(
	values: WorkModelFormValues,
	options: { withValidTo?: boolean } = {}
): { input: WorkModelInput } | { errors: WorkModelFormErrors } {
	const errors: WorkModelFormErrors = {};
	if (!isValidDate(values.validFrom)) errors.validFrom = t('work_model.error_valid_from');
	if (options.withValidTo && values.validTo) {
		if (!isValidDate(values.validTo)) errors.validTo = t('work_model.error_valid_from');
		else if (isValidDate(values.validFrom) && values.validTo < values.validFrom) errors.validTo = t('work_model.error_valid_to');
	}
	if (!values.timezone.trim() || !validZone(values.timezone.trim())) errors.timezone = t('work_model.error_timezone');

	const weekly = parseDuration(values.weeklyTarget);
	if (weekly === null || weekly < 0 || weekly > 168 * 3600) errors.weeklyTarget = t('work_model.error_duration');
	if (values.workdays.length === 0) errors.workdays = t('work_model.error_workdays');

	const minutes = Number(values.roundingMinutes);
	if (values.roundingEnabled && (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)) {
		errors.roundingMinutes = t('work_model.error_rounding');
	}

	const threshold = parseDuration(values.schoolThreshold);
	if (threshold === null || threshold < 0) errors.schoolThreshold = t('work_model.error_duration');
	let credit: number | null = null;
	if (values.schoolCredit.trim()) {
		credit = parseDuration(values.schoolCredit);
		if (credit === null || credit < 0) errors.schoolCredit = t('work_model.error_duration');
	}

	const boundary = Number(values.dayBoundaryMinutes);
	if (!Number.isInteger(boundary) || boundary < 0 || boundary > 719) errors.dayBoundaryMinutes = t('work_model.error_boundary');

	if (values.fixedBreaks.some((b) => !TIME.test(b.start) || !TIME.test(b.end) || b.start >= b.end)) {
		errors.fixedBreaks = t('work_model.error_breaks');
	}

	if (Object.keys(errors).length > 0) return { errors };
	return {
		input: {
			validFrom: values.validFrom,
			...(options.withValidTo ? { validTo: values.validTo || null } : {}),
			...(values.dailyTargetSeconds ? { dailyTargetSeconds: { ...values.dailyTargetSeconds } } : {}),
			timezone: values.timezone.trim(),
			weeklyTargetSeconds: weekly!,
			workdays: [...values.workdays].sort((a, b) => a - b),
			travelCountsAsWork: values.travelCountsAsWork,
			roundingEnabled: values.roundingEnabled,
			roundingMinutes: values.roundingEnabled ? minutes : Number(values.roundingMinutes) || 15,
			schoolFullDayThresholdSeconds: threshold!,
			schoolCreditSeconds: credit,
			dayBoundaryMinutes: boundary,
			fixedBreaks: values.fixedBreaks.map((b) => ({ ...b }))
		}
	};
}

/** Older backends (before contract v0.16.0) send no `version`; they can only create new versions. */
export function correctionSupported(models: WorkModel[]): boolean {
	return models.length > 0 && models.every((m) => typeof m.version === 'number');
}

/** Plain-German names of the changed fields reported by the preview (unknown names are skipped). */
const FIELD_LABELS: Record<string, string> = {
	validFrom: 'Gültig ab',
	validTo: 'Gültig bis',
	timezone: 'Zeitzone',
	weeklyTargetSeconds: 'Wochen-Soll',
	workdays: 'Arbeitstage',
	dailyTargetSeconds: 'Tages-Soll',
	travelCountsAsWork: 'Fahrtzeiten',
	roundingEnabled: 'Rundung',
	roundingMinutes: 'Rundung in Minuten',
	schoolFullDayThresholdSeconds: 'Schulschwelle',
	schoolCreditSeconds: 'Schulgutschrift',
	dayBoundaryMinutes: 'Tagesgrenze',
	fixedBreaks: 'Feste Pausen'
};
export function changedFieldLabels(fields: string[]): string[] {
	return fields.map((f) => FIELD_LABELS[f]).filter((x): x is string => Boolean(x));
}
