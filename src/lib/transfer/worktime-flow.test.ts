import { describe, expect, it } from 'vitest';
import { canCreateModel, emptyWorktimeForm, formFromWorktime, isRecommended, isWorktimeTemplate, modelStartHint, weeksBetween, worktimeFacts, worktimeFromForm, worktimeIssues, worktimeMapping } from './worktime-flow';
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

describe('recognition facts and recommendation', () => {
	it('counts the calendar weeks touched by the range', () => {
		expect(weeksBetween('2026-03-02', '2026-03-06')).toBe(1);
		expect(weeksBetween('2026-03-06', '2026-03-09')).toBe(2);
		expect(weeksBetween('2024-08-01', '2024-08-01')).toBe(1);
		expect(weeksBetween(null, '2026-03-06')).toBe(0);
		expect(weeksBetween('2026-03-09', '2026-03-02')).toBe(0);
	});

	it('derives plain numbers from the preview and falls back to the day count for older servers', () => {
		const facts = worktimeFacts({ days: 9, firstDate: '2026-03-02', lastDate: '2026-03-13', firstContentDate: '2026-03-02', byAction: { work: 4, school: 2, vacation: 1, sick: 1, excused: 1 } }, 2);
		expect(facts).toMatchObject({ sheets: 2, weeks: 2, timeDays: 6, workDays: 4, schoolDays: 2, vacationDays: 1, sickDays: 1, excusedDays: 1, holidayDays: 0, firstDay: '2026-03-02' });
		expect(worktimeFacts({ days: 9 }, 1)).toMatchObject({ timeDays: 9, weeks: 0, firstDay: null });
	});

	it('knows whether any option differs from the recommendation', () => {
		const form = emptyWorktimeForm();
		expect(isRecommended(form, DEFAULT_WORKTIME_RULES)).toBe(true);
		expect(isRecommended({ ...form, holidayTimes: 'keep' }, DEFAULT_WORKTIME_RULES)).toBe(false);
		expect(isRecommended({ ...form, rules: [...form.rules, { pattern: 'x', action: 'work' }] }, DEFAULT_WORKTIME_RULES)).toBe(false);
	});

	it('creates a work model in one step only when no later version blocks it', () => {
		expect(canCreateModel({ kind: 'none' })).toBe(true);
		expect(canCreateModel({ kind: 'earlier', modelFrom: '2026-01-01', emptyDays: 0, beforeWeek: true })).toBe(true);
		expect(canCreateModel({ kind: 'ok', modelFrom: '2026-03-02' })).toBe(false);
		expect(canCreateModel({ kind: 'late', modelFrom: '2026-04-01' })).toBe(false);
		expect(canCreateModel(null)).toBe(false);
	});
});
