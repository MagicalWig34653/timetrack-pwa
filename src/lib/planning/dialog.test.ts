import { describe, expect, it } from 'vitest';
import type { Absence, CalendarDay } from '#lib/api/types.js';
import { buildResult, formFromSeed, planDates, previewOf, type DialogForm } from './dialog.js';
import type { ConflictContext } from './conflicts.js';

const ctx: ConflictContext = { holidays: [{ startDate: '2031-03-13', endDate: '2031-03-13', name: 'F', kind: 'holiday', source: 'builtin' } as CalendarDay], absences: [], plan: [], models: [] };
// Monday 2031-03-10 .. Sunday 2031-03-16
const form = (over: Partial<DialogForm> = {}): DialogForm => ({ ...formFromSeed({ start: '2031-03-10', end: '2031-03-16' }), ...over });

describe('formFromSeed', () => {
	it('defaults to a plan, working days only for multi-day ranges', () => {
		expect(formFromSeed({ start: '2031-03-10', end: '2031-03-10' })).toMatchObject({ kind: 'plan', onlyWorkdays: false, mode: 'office' });
		expect(formFromSeed({ start: '2031-03-10', end: '2031-03-12' }).onlyWorkdays).toBe(true);
	});
	it('takes dates, kind and half days from an absence to edit', () => {
		const absence = { id: 'a', version: 1, kind: 'sick', startDate: '2031-03-11', endDate: '2031-03-12', status: 'approved', halfDayEnd: true, note: 'n', countedHalfDays: 0 } as Absence;
		expect(formFromSeed({ start: '2031-03-11', end: '2031-03-11', absence })).toMatchObject({ kind: 'sick', end: '2031-03-12', halfDayEnd: true, status: 'approved', note: 'n', onlyWorkdays: false });
	});
	it('loads times and break from a plan', () => {
		const f = formFromSeed({ start: '2031-03-10', end: '2031-03-10', plan: { date: '2031-03-10', mode: 'home', plannedStart: '08:00', plannedEnd: '16:30', plannedBreakMinutes: 30 } });
		expect(f).toMatchObject({ mode: 'home', plannedStart: '08:00', plannedEnd: '16:30', breakMinutes: '30' });
	});
});

describe('planDates', () => {
	it('keeps all days or only working days without holidays', () => {
		expect(planDates(form({ onlyWorkdays: false }), ctx)).toHaveLength(7);
		expect(planDates(form({ onlyWorkdays: true }), ctx)).toEqual(['2031-03-10', '2031-03-11', '2031-03-12', '2031-03-14']);
	});
	it('does not filter days off and uses explicit selections', () => {
		expect(planDates(form({ mode: 'off', onlyWorkdays: true }), ctx)).toHaveLength(7);
		expect(planDates(form({ days: ['2031-03-12', '2031-03-10'], onlyWorkdays: false }), ctx)).toEqual(['2031-03-10', '2031-03-12']);
	});
	it('is empty for an invalid range', () => {
		expect(planDates(form({ end: '2031-03-01' }), ctx)).toEqual([]);
	});
});

describe('buildResult', () => {
	it('builds a plan with times and break', () => {
		const r = buildResult(form({ onlyWorkdays: true, plannedStart: '08:00', plannedEnd: '16:00', breakMinutes: '45', note: ' x ' }), ctx, null);
		expect(r).toMatchObject({ ok: true, result: { type: 'plan', input: { mode: 'office', plannedStart: '08:00', plannedEnd: '16:00', plannedBreakMinutes: 45, note: 'x', placeId: null } } });
	});
	it('accepts a break bound as a number by the input', () => {
		const r = buildResult(form({ plannedStart: '08:00', plannedEnd: '16:00', breakMinutes: 30 as unknown as string }), ctx, null);
		expect(r).toMatchObject({ ok: true, result: { input: { plannedBreakMinutes: 30 } } });
	});
	it('rejects half-filled or reversed times and breaks without times', () => {
		expect(buildResult(form({ plannedStart: '08:00' }), ctx, null)).toMatchObject({ ok: false, errors: { time: 'pd.error_time' } });
		expect(buildResult(form({ plannedStart: '17:00', plannedEnd: '08:00' }), ctx, null)).toMatchObject({ ok: false, errors: { time: 'pd.error_time' } });
		expect(buildResult(form({ breakMinutes: '30' }), ctx, null)).toMatchObject({ ok: false, errors: { break: 'pd.error_break' } });
		expect(buildResult(form({ plannedStart: '08:00', plannedEnd: '16:00', breakMinutes: '700' }), ctx, null)).toMatchObject({ ok: false, errors: { break: 'pd.error_break' } });
	});
	it('drops times for mode off', () => {
		const r = buildResult(form({ mode: 'off', plannedStart: '08:00', plannedEnd: '16:00' }), ctx, null);
		expect(r).toMatchObject({ ok: true });
		if (r.ok && r.result.type === 'plan') expect(r.result.input.plannedStart).toBeUndefined();
	});
	it('reports a range without any plannable day', () => {
		expect(buildResult(form({ start: '2031-03-15', end: '2031-03-16', onlyWorkdays: true }), ctx, null)).toMatchObject({ ok: false, errors: { days: 'pd.error_no_days' } });
	});
	it('validates dates', () => {
		expect(buildResult(form({ start: '', end: '2031-03-10' }), ctx, null)).toMatchObject({ ok: false, errors: { start: 'pd.error_date' } });
		expect(buildResult(form({ end: '2031-03-01' }), ctx, null)).toMatchObject({ ok: false, errors: { end: 'pd.error_end_before_start' } });
	});
	it('builds absences, one run per contiguous block of a multi-selection', () => {
		const r = buildResult(form({ kind: 'vacation', days: ['2031-03-10', '2031-03-11', '2031-03-14'], halfDayEnd: true }), ctx, null);
		expect(r).toMatchObject({ ok: true, result: { type: 'absence', runs: [{ start: '2031-03-10', end: '2031-03-11' }, { start: '2031-03-14', end: '2031-03-14' }], template: { kind: 'vacation', halfDayEnd: true } } });
	});
	it('keeps stored document fields when editing an absence', () => {
		const editing = { id: 'a', version: 2, kind: 'sick', startDate: '2031-03-10', endDate: '2031-03-12', status: 'taken', documentStatus: 'submitted', documentSubmittedOn: '2031-03-11', countedHalfDays: 0 } as Absence;
		const r = buildResult(formFromSeed({ start: '2031-03-10', end: '2031-03-10', absence: editing }), ctx, editing);
		expect(r).toMatchObject({ ok: true, result: { editing, template: { documentStatus: 'submitted', documentSubmittedOn: '2031-03-11' } } });
	});
});

describe('previewOf', () => {
	it('ignores the edited absence for conflicts', () => {
		const editing = { id: 'a' } as Absence;
		expect(previewOf(form({ kind: 'sick' }), ctx, editing).action).toEqual({ type: 'absence', kind: 'sick', ignoreAbsenceId: 'a' });
		expect(previewOf(form({ kind: 'sick' }), ctx, null).dates).toHaveLength(7);
	});
});
