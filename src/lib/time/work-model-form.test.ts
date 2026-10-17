import { describe, expect, it } from 'vitest';
import { buildWorkModelInput, changedFieldLabels, correctionSupported, defaultWorkModelForm, formFromModel } from './work-model-form.js';

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

	const model = { id: 'a', createdAt: '', validFrom: '2026-01-01', validTo: '2026-06-30', weeklyTargetSeconds: 126000, workdays: [1, 2, 3, 4, 5], dailyTargetSeconds: { '5': 18000 }, version: 2 };

	it('sends validTo and keeps per-weekday targets only for a correction', () => {
		const form = formFromModel(model, model.validFrom, model.validTo);
		const correction = buildWorkModelInput(form, { withValidTo: true });
		expect('input' in correction && correction.input).toMatchObject({ validFrom: '2026-01-01', validTo: '2026-06-30', dailyTargetSeconds: { '5': 18000 } });
		const open = buildWorkModelInput({ ...form, validTo: '' }, { withValidTo: true });
		expect('input' in open && open.input.validTo).toBeNull();
		const created = buildWorkModelInput(form);
		expect('input' in created && 'validTo' in created.input).toBe(false);
		form.dailyTargetSeconds = undefined;
		const removed = buildWorkModelInput(form, { withValidTo: true });
		expect('input' in removed && 'dailyTargetSeconds' in removed.input).toBe(false);
	});

	it('rejects an end before the start when correcting', () => {
		const result = buildWorkModelInput({ ...formFromModel(model, '2026-05-01'), validTo: '2026-04-01' }, { withValidTo: true });
		expect('errors' in result && result.errors.validTo).toBe('Das Ende darf nicht vor dem Beginn liegen.');
	});

	it('supports corrections only when every version carries a version counter', () => {
		expect(correctionSupported([model])).toBe(true);
		expect(correctionSupported([model, { ...model, id: 'b', version: undefined }])).toBe(false);
		expect(correctionSupported([])).toBe(false);
		expect(changedFieldLabels(['weeklyTargetSeconds', 'unknown', 'fixedBreaks'])).toEqual(['Wochen-Soll', 'Feste Pausen']);
	});
});
