import { describe, expect, it } from 'vitest';
import type { Absence, CalendarDay, PlanDay } from '#lib/api/types.js';
import { findConflicts, hasBlocking, severityByDate, type ConflictContext } from './conflicts.js';

const absence = (over: Partial<Absence> = {}): Absence => ({
	id: 'a1',
	version: 1,
	kind: 'vacation',
	startDate: '2031-03-12',
	endDate: '2031-03-12',
	status: 'planned',
	countedHalfDays: 2,
	...over
});
const holiday: CalendarDay = { startDate: '2031-03-13', endDate: '2031-03-13', name: 'Testfeiertag', kind: 'holiday', source: 'builtin' };
const ctx = (over: Partial<ConflictContext> = {}): ConflictContext => ({ holidays: [], absences: [], plan: [], models: [], ...over });
// 2031-03-10 is a Monday
const week = ['2031-03-10', '2031-03-11', '2031-03-12', '2031-03-13', '2031-03-14', '2031-03-15', '2031-03-16'];

describe('findConflicts for absences', () => {
	it('blocks an overlap with another active absence but not with itself', () => {
		const c = ctx({ absences: [absence()] });
		const clash = findConflicts(['2031-03-12'], { type: 'absence', kind: 'sick' }, c);
		expect(clash).toEqual([{ date: '2031-03-12', kind: 'absence_overlap', severity: 'block', detail: 'vacation' }]);
		expect(hasBlocking(clash)).toBe(true);
		expect(findConflicts(['2031-03-12'], { type: 'absence', kind: 'vacation', ignoreAbsenceId: 'a1' }, c)).toEqual([]);
	});
	it('ignores cancelled and rejected absences', () => {
		const c = ctx({ absences: [absence({ status: 'cancelled' }), absence({ id: 'a2', status: 'rejected' })] });
		expect(findConflicts(['2031-03-12'], { type: 'absence', kind: 'sick' }, c)).toEqual([]);
	});
	it('warns about holidays and weekends, which are not counted as vacation', () => {
		const conflicts = findConflicts(week, { type: 'absence', kind: 'vacation' }, ctx({ holidays: [holiday] }));
		expect(conflicts.map((x) => [x.date, x.kind])).toEqual([
			['2031-03-13', 'holiday'],
			['2031-03-15', 'non_working'],
			['2031-03-16', 'non_working']
		]);
		expect(hasBlocking(conflicts)).toBe(false);
	});
	it('uses the work model for non-working days', () => {
		const models = [{ validFrom: '2030-01-01', validTo: null, workdays: [1, 2, 3, 4], dailyTargetSeconds: undefined }];
		const conflicts = findConflicts(['2031-03-14'], { type: 'absence', kind: 'vacation' }, ctx({ models }));
		expect(conflicts[0]?.kind).toBe('non_working');
	});
	it('notes a plan that the absence overrides as information only', () => {
		const plan: PlanDay[] = [{ date: '2031-03-11', mode: 'office' }];
		const conflicts = findConflicts(['2031-03-11'], { type: 'absence', kind: 'vacation' }, ctx({ plan }));
		expect(conflicts).toEqual([{ date: '2031-03-11', kind: 'plan_overridden', severity: 'info' }]);
	});
});

describe('findConflicts for plans', () => {
	it('warns when an absence overrides the plan and reports replaced plans as information', () => {
		const plan: PlanDay[] = [{ date: '2031-03-11', mode: 'office' }];
		const conflicts = findConflicts(['2031-03-11', '2031-03-12'], { type: 'plan', mode: 'home' }, ctx({ plan, absences: [absence()] }));
		expect(conflicts.map((x) => [x.date, x.kind, x.severity])).toEqual([
			['2031-03-11', 'plan_replaced', 'info'],
			['2031-03-12', 'plan_overridden', 'warn']
		]);
	});
	it('does not warn about a day off on a weekend', () => {
		expect(findConflicts(['2031-03-15'], { type: 'plan', mode: 'off' }, ctx())).toEqual([]);
		expect(findConflicts(['2031-03-15'], { type: 'plan', mode: 'office' }, ctx())[0]?.kind).toBe('non_working');
	});
});

describe('severityByDate', () => {
	it('keeps the highest severity per day', () => {
		const map = severityByDate([
			{ date: 'a', kind: 'plan_replaced', severity: 'info' },
			{ date: 'a', kind: 'holiday', severity: 'warn' },
			{ date: 'b', kind: 'absence_overlap', severity: 'block' },
			{ date: 'b', kind: 'holiday', severity: 'warn' }
		]);
		expect(map.get('a')).toBe('warn');
		expect(map.get('b')).toBe('block');
	});
});
