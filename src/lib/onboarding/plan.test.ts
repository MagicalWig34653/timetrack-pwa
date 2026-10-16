import { describe, expect, it } from 'vitest';
import type { ModuleStatus } from '#lib/api/types.js';
import { buildModelPlan, buildVacationPlan, dailyTargetSeconds, initialDraft, visibleSteps } from './plan';

const status = (key: ModuleStatus['key'], serverEnabled: boolean, effective = serverEnabled): ModuleStatus => ({ key, serverEnabled, accountEnabled: effective, effective, lockedByOperator: !serverEnabled });
const texts = { days: 'days', snapshot: 'snapshot' };

describe('onboarding plan', () => {
	it('prefills visible suggestions: rounding on with 15 minutes, no breaks, 30 days in DE-ST', () => {
		const draft = initialDraft('2026-10-16', 'Europe/Berlin', undefined, null);
		expect(draft.model).toMatchObject({ roundingEnabled: true, roundingMinutes: '15', fixedBreaks: [], workdays: [1, 2, 3, 4, 5], schoolThreshold: '3:00', schoolCredit: '' });
		expect(draft.vacation).toMatchObject({ days: '30', region: 'DE-ST' });
		expect(draft.skipped).toEqual({ model: false, breaks: false, school: false, vacation: false, modules: false });
	});

	it('derives the daily target from weekly hours and workdays', () => {
		expect(dailyTargetSeconds(38.5 * 3600, 5)).toBe(27720);
		expect(dailyTargetSeconds(40 * 3600, 4)).toBe(36000);
		expect(dailyTargetSeconds(null, 5)).toBeNull();
		expect(dailyTargetSeconds(3600, 0)).toBeNull();
	});

	it('builds a work model payload without inventing breaks', () => {
		const draft = initialDraft('2026-10-16', 'Europe/Berlin', undefined, null);
		const plan = buildModelPlan(draft.model);
		expect('input' in plan && plan.input).toMatchObject({ validFrom: '2026-10-16', weeklyTargetSeconds: 138600, roundingEnabled: true, roundingMinutes: 15, fixedBreaks: [], schoolFullDayThresholdSeconds: 10800, schoolCreditSeconds: null });
	});

	it('reports invalid model values', () => {
		const draft = initialDraft('2026-10-16', 'Europe/Berlin', undefined, null);
		draft.model.workdays = [];
		expect('errors' in buildModelPlan(draft.model)).toBe(true);
	});

	it('hides steps for modules the operator disabled', () => {
		expect(visibleSteps(null)).toEqual(['model', 'breaks', 'school', 'vacation', 'modules', 'summary']);
		expect(visibleSteps([status('planning', false)])).not.toContain('vacation');
		expect(visibleSteps([status('planning', true), status('reports', true)])).toContain('vacation');
		expect(visibleSteps([status('planning', false), status('reports', false)])).toEqual(['model', 'breaks', 'school', 'summary']);
	});

	it('turns days into half days and requires snapshot date and days together', () => {
		const draft = initialDraft('2026-10-16', 'Europe/Berlin', undefined, null);
		const ok = buildVacationPlan({ ...draft.vacation, days: '27,5' }, null, texts);
		expect(ok).toMatchObject({ settings: { annualEntitlementHalfDays: 55, region: 'DE-ST' }, snapshot: null });
		const snap = buildVacationPlan({ ...draft.vacation, snapshotDate: '2026-09-01', snapshotDays: '12,5' }, null, texts);
		expect(snap).toMatchObject({ snapshot: { date: '2026-09-01', remainingHalfDays: 25 } });
		expect(buildVacationPlan({ ...draft.vacation, snapshotDate: '2026-09-01' }, null, texts)).toEqual({ errors: { snapshot: 'snapshot' } });
		expect(buildVacationPlan({ ...draft.vacation, days: '30,3' }, null, texts)).toEqual({ errors: { days: 'days' } });
	});

	it('keeps existing carry-over rules when vacation settings are saved again', () => {
		const current = { configured: true, region: 'DE-SN', annualEntitlementHalfDays: 50, carryOverByYear: { '2026': 8 }, carryOverExpiry: '03-31' };
		const draft = initialDraft('2026-10-16', 'Europe/Berlin', undefined, current);
		expect(draft.vacation).toMatchObject({ days: '25', region: 'DE-SN' });
		expect(buildVacationPlan(draft.vacation, current, texts)).toMatchObject({ settings: { carryOverByYear: { '2026': 8 }, carryOverExpiry: '03-31' } });
	});
});
