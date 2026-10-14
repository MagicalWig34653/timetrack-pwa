import { describe, expect, it } from 'vitest';
import { buildWorkModelInput, defaultWorkModelForm, formFromModel } from './work-model-form.js';

describe('work model form', () => {
	it('builds the payload for the default 38:30 h week', () => {
		const result = buildWorkModelInput(defaultWorkModelForm('2026-10-14', 'Europe/Berlin'));
		expect('input' in result).toBe(true);
		if ('input' in result) {
			expect(result.input).toMatchObject({
				validFrom: '2026-10-14',
				weeklyTargetSeconds: 138600,
				workdays: [1, 2, 3, 4, 5],
				roundingEnabled: true,
				roundingMinutes: 15,
				schoolFullDayThresholdSeconds: 10800,
				schoolCreditSeconds: null,
				dayBoundaryMinutes: 0
			});
		}
	});

	it('reports German errors per field', () => {
		const values = {
			...defaultWorkModelForm('2026-10-14', 'Europe/Berlin'),
			validFrom: '2026-13-01',
			weeklyTarget: '38,5',
			workdays: [],
			roundingMinutes: '0',
			dayBoundaryMinutes: '900',
			fixedBreaks: [{ start: '12:30', end: '12:00' }],
			timezone: 'Mars/Base'
		};
		const result = buildWorkModelInput(values);
		expect('errors' in result).toBe(true);
		if ('errors' in result) {
			expect(Object.keys(result.errors).sort()).toEqual(
				['dayBoundaryMinutes', 'fixedBreaks', 'roundingMinutes', 'timezone', 'validFrom', 'weeklyTarget', 'workdays'].sort()
			);
			expect(result.errors.weeklyTarget).toMatch(/h:mm/);
		}
	});

	it('prefills a new version from an existing one with credit "empty = daily target"', () => {
		const form = formFromModel(
			{ id: 'x', createdAt: '', validFrom: '2026-01-01', weeklyTargetSeconds: 138600, workdays: [1, 2, 3, 4, 5], schoolCreditSeconds: null, fixedBreaks: [{ start: '12:00', end: '12:30' }] },
			'2026-11-01'
		);
		expect(form.weeklyTarget).toBe('38:30');
		expect(form.schoolCredit).toBe('');
		expect(form.fixedBreaks).toEqual([{ start: '12:00', end: '12:30' }]);
		expect(form.validFrom).toBe('2026-11-01');
	});
});
