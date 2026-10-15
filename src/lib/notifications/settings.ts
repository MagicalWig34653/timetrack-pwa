import { NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationCategorySettings, type NotificationSettings } from '../api/types';

export const THRESHOLD_MIN = 30;
export const THRESHOLD_MAX = 1440;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const isTime = (value: string): boolean => TIME.test(value);

/** Editable form model: quiet hours are on/off plus two times so a half-filled pair cannot be submitted. */
export interface SettingsForm {
	categories: Record<NotificationCategory, { inApp: boolean; push: boolean }>;
	thresholdMinutes: string;
	weekday: number;
	time: string;
	quietEnabled: boolean;
	quietStart: string;
	quietEnd: string;
}

export const DEFAULT_FORM: SettingsForm = {
	categories: {
		running_timer: { inApp: true, push: true },
		pending_suggestions: { inApp: true, push: true },
		report_gap: { inApp: true, push: true },
		document_submission: { inApp: true, push: true }
	},
	thresholdMinutes: '600',
	weekday: 5,
	time: '15:00',
	quietEnabled: true,
	quietStart: '22:00',
	quietEnd: '07:00'
};

export function formFromSettings(settings: NotificationSettings): SettingsForm {
	const form: SettingsForm = structuredClone(DEFAULT_FORM);
	for (const kind of NOTIFICATION_CATEGORIES) {
		const entry = settings.categories?.[kind];
		if (entry) form.categories[kind] = { inApp: entry.inApp, push: entry.push };
	}
	const timer = settings.categories?.running_timer;
	if (timer?.thresholdMinutes !== undefined) form.thresholdMinutes = String(timer.thresholdMinutes);
	const gap = settings.categories?.report_gap;
	if (gap?.weekday !== undefined) form.weekday = gap.weekday;
	if (gap?.time) form.time = gap.time;
	form.quietEnabled = !!(settings.quietStart && settings.quietEnd);
	if (settings.quietStart) form.quietStart = settings.quietStart;
	if (settings.quietEnd) form.quietEnd = settings.quietEnd;
	return form;
}

export type FormErrors = Partial<Record<'thresholdMinutes' | 'time' | 'quiet', true>>;

export function validateForm(form: SettingsForm): FormErrors {
	const errors: FormErrors = {};
	const minutes = Number(form.thresholdMinutes);
	if (!/^\d+$/.test(form.thresholdMinutes.trim()) || minutes < THRESHOLD_MIN || minutes > THRESHOLD_MAX) errors.thresholdMinutes = true;
	if (!isTime(form.time)) errors.time = true;
	if (form.quietEnabled && (!isTime(form.quietStart) || !isTime(form.quietEnd))) errors.quiet = true;
	return errors;
}

/** Builds the PUT body (the server replaces the whole document). Call only when `validateForm` reports no errors. */
export function settingsFromForm(form: SettingsForm): NotificationSettings {
	const categories: Partial<Record<NotificationCategory, NotificationCategorySettings>> = {};
	for (const kind of NOTIFICATION_CATEGORIES) categories[kind] = { ...form.categories[kind] };
	categories.running_timer!.thresholdMinutes = Number(form.thresholdMinutes.trim());
	categories.report_gap!.weekday = form.weekday;
	categories.report_gap!.time = form.time;
	return {
		categories,
		quietStart: form.quietEnabled ? form.quietStart : null,
		quietEnd: form.quietEnabled ? form.quietEnd : null
	};
}
