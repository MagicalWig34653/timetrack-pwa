import { describe, expect, it } from 'vitest';
import { DEFAULT_FORM, formFromSettings, settingsFromForm, validateForm } from './settings';
import { relativeTime } from './relative-time';

describe('settings form', () => {
	it('round-trips the server document including quiet hours off', () => {
		const form = formFromSettings({
			categories: {
				running_timer: { inApp: false, push: true, thresholdMinutes: 90 },
				report_gap: { inApp: true, push: false, weekday: 4, time: '16:30' }
			},
			quietStart: null,
			quietEnd: null
		});
		expect(form.categories.running_timer).toEqual({ inApp: false, push: true });
		expect(form.categories.pending_suggestions).toEqual({ inApp: true, push: true });
		expect(form.thresholdMinutes).toBe('90');
		expect(form.quietEnabled).toBe(false);
		const body = settingsFromForm(form);
		expect(body.quietStart).toBeNull();
		expect(body.quietEnd).toBeNull();
		expect(body.categories.running_timer).toEqual({ inApp: false, push: true, thresholdMinutes: 90 });
		expect(body.categories.report_gap).toEqual({ inApp: true, push: false, weekday: 4, time: '16:30' });
		expect(body.categories.pending_suggestions).toEqual({ inApp: true, push: true });
	});

	it('validates threshold, time and quiet hours', () => {
		expect(validateForm(DEFAULT_FORM)).toEqual({});
		expect(validateForm({ ...DEFAULT_FORM, thresholdMinutes: '29' }).thresholdMinutes).toBe(true);
		expect(validateForm({ ...DEFAULT_FORM, thresholdMinutes: '1441' }).thresholdMinutes).toBe(true);
		expect(validateForm({ ...DEFAULT_FORM, thresholdMinutes: '12.5' }).thresholdMinutes).toBe(true);
		expect(validateForm({ ...DEFAULT_FORM, thresholdMinutes: '' }).thresholdMinutes).toBe(true);
		expect(validateForm({ ...DEFAULT_FORM, thresholdMinutes: '30' })).toEqual({});
		expect(validateForm({ ...DEFAULT_FORM, thresholdMinutes: '1440' })).toEqual({});
		expect(validateForm({ ...DEFAULT_FORM, time: '24:00' }).time).toBe(true);
		expect(validateForm({ ...DEFAULT_FORM, time: '' }).time).toBe(true);
		expect(validateForm({ ...DEFAULT_FORM, quietStart: '' }).quiet).toBe(true);
		expect(validateForm({ ...DEFAULT_FORM, quietEnabled: false, quietStart: '' })).toEqual({});
	});
});

describe('relative time', () => {
	const now = Date.parse('2026-10-15T12:00:00Z');
	const ago = (ms: number) => new Date(now - ms).toISOString();
	it('formats German relative labels', () => {
		expect(relativeTime(ago(10_000), now)).toBe('gerade eben');
		expect(relativeTime(ago(5 * 60_000), now)).toBe('vor 5 Min.');
		expect(relativeTime(ago(3 * 3_600_000), now)).toBe('vor 3 Std.');
		expect(relativeTime(ago(30 * 3_600_000), now)).toBe('gestern');
		expect(relativeTime(ago(4 * 86_400_000), now)).toBe('vor 4 Tagen');
		expect(relativeTime(ago(40 * 86_400_000), now)).toMatch(/2026/);
	});
});
