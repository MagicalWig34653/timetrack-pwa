import { describe, expect, it } from 'vitest';
import { emptyWorktimeForm, formFromWorktime, isWorktimeTemplate, worktimeFromForm, worktimeIssues, worktimeMapping } from './worktime-flow';
import { DEFAULT_WORKTIME_RULES } from './worktime';

describe('worktime form', () => {
	it('builds options and a placeholder mapping for the profile', () => {
		const form = emptyWorktimeForm();
		expect(worktimeFromForm(form)).toEqual({ pauseMode: 'split', pauseMinutes: null, pauseStart: '12:00', roundToMinutes: true, rules: DEFAULT_WORKTIME_RULES });
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
