import { describe, expect, it } from 'vitest';
import { emptyWorktimeForm, formFromWorktime, isWorktimeTemplate, modelStartHint, worktimeFromForm, worktimeIssues, worktimeMapping } from './worktime-flow';
import { DEFAULT_WORKTIME_RULES } from './worktime';

describe('worktime form', () => {
	it('builds options and a placeholder mapping for the profile', () => {
		const form = emptyWorktimeForm();
		expect(worktimeFromForm(form)).toEqual({ pauseMode: 'split', pauseMinutes: null, pauseStart: '12:00', roundToMinutes: true, holidayTimes: 'discard', partialCredit: 'work', rules: DEFAULT_WORKTIME_RULES });
		const mapping = worktimeMapping('2026', { ...form, pauseSource: 'override', pauseMinutes: '45', pauseMode: 'none' });
		expect(mapping).toMatchObject({ profile: 'worktime_workbook', sheet: '2026', headerRow: 0, worktime: { pauseMode: 'none', pauseMinutes: 45 } });
		expect(isWorktimeTemplate(mapping)).toBe(true);
		expect(isWorktimeTemplate({ ...mapping, profile: undefined })).toBe(false);
	});

	it('restores the form from a template and falls back to the default rules', () => {
		const restored = formFromWorktime({ pauseMode: 'none', pauseMinutes: 20, roundToMinutes: false }, [{ pattern: 'x', action: 'skip' }]);
		expect(restored).toMatchObject({ pauseMode: 'none', pauseSource: 'override', pauseMinutes: '20', roundToMinutes: false, rules: [{ pattern: 'x', action: 'skip' }] });
		expect(formFromWorktime({ rules: [{ pattern: 'a', action: 'work' }] }, DEFAULT_WORKTIME_RULES).rules).toEqual([{ pattern: 'a', action: 'work' }]);
	});

	it('stores holiday and partial-credit choices and restores them from a template (older templates get the defaults)', () => {
		const form = { ...emptyWorktimeForm(), holidayTimes: 'keep' as const, partialCredit: 'absence' as const };
		expect(worktimeFromForm(form)).toMatchObject({ holidayTimes: 'keep', partialCredit: 'absence' });
		expect(formFromWorktime({ holidayTimes: 'keep', partialCredit: 'absence' }, DEFAULT_WORKTIME_RULES)).toMatchObject({ holidayTimes: 'keep', partialCredit: 'absence' });
		expect(formFromWorktime({ pauseMode: 'none' }, DEFAULT_WORKTIME_RULES)).toMatchObject({ holidayTimes: 'discard', partialCredit: 'work' });
	});

	it('reports pause, pause start and rule problems', () => {
		const form = emptyWorktimeForm();
		expect(worktimeIssues(form)).toEqual([]);
		form.pauseSource = 'override';
		form.pauseMinutes = '241';
		form.pauseStart = '25:00';
		form.rules = [{ pattern: '', action: 'work' }];
		expect(worktimeIssues(form).map((i) => i.kind)).toEqual(['pause', 'pause_start', 'rule']);
	});
});

describe('modelStartHint', () => {
	// 2026-03-05 is a Thursday: Monday to Wednesday before it are empty
	const first = '2026-03-05';
	it('returns nothing without a first content day and "none" without models', () => {
		expect(modelStartHint(null, [])).toBeNull();
		expect(modelStartHint(first, [])).toEqual({ kind: 'none' });
	});
	it('counts the empty workdays before the first entry when the model starts earlier', () => {
		expect(modelStartHint(first, [{ validFrom: '2026-03-02' }])).toEqual({ kind: 'earlier', modelFrom: '2026-03-02', emptyDays: 3, beforeWeek: false });
		expect(modelStartHint(first, [{ validFrom: '2026-03-04' }])).toEqual({ kind: 'earlier', modelFrom: '2026-03-04', emptyDays: 1, beforeWeek: false });
		expect(modelStartHint(first, [{ validFrom: '2025-09-01' }])).toEqual({ kind: 'earlier', modelFrom: '2025-09-01', emptyDays: 3, beforeWeek: true });
	});
	it('is fine when the model starts on the first entry or the entry is a Monday in the model week', () => {
		expect(modelStartHint(first, [{ validFrom: first }])).toEqual({ kind: 'ok', modelFrom: first });
		expect(modelStartHint('2026-03-02', [{ validFrom: '2026-03-02' }])).toEqual({ kind: 'ok', modelFrom: '2026-03-02' });
	});
	it('reports a model that only starts after the first entry; closed models do not count', () => {
		expect(modelStartHint(first, [{ validFrom: '2026-04-01' }])).toEqual({ kind: 'late', modelFrom: '2026-04-01' });
		expect(modelStartHint(first, [{ validFrom: '2025-01-01', validTo: '2026-02-28' }, { validFrom: '2026-03-01' }])).toMatchObject({ kind: 'earlier', modelFrom: '2026-03-01', emptyDays: 3 });
	});
});
