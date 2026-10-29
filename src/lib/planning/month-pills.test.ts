import { describe, expect, it } from 'vitest';
import type { Absence } from '#lib/api/types.js';
import type { DayInfo } from './calendar';
import { monthPills, visibleText, weekdayIndex } from './month-pills';

const labels = { absence: (a: Absence) => (a.kind === 'vacation' ? 'Urlaub' : 'Krank'), plan: () => 'Büro', holidayHint: () => 'halber Tag' };
const absence = (extra: Partial<Absence>): Absence => ({ id: 'a', kind: 'vacation', status: 'approved', startDate: '2026-10-13', endDate: '2026-10-16', halfDayStart: false, halfDayEnd: false, ...extra }) as Absence;
const info = (date: string, extra: Partial<DayInfo> = {}): DayInfo => ({ date, holidays: [], schoolHolidays: [], absences: [absence({})], plan: null, evaluation: null, ...extra });

describe('monthPills', () => {
	it('numbers weekdays from Monday', () => {
		expect(weekdayIndex('2026-10-12')).toBe(0);
		expect(weekdayIndex('2026-10-18')).toBe(6);
	});
	it('draws a multi-day absence as one bar: label on the first cell only, continuation on both sides', () => {
		const first = monthPills(info('2026-10-13'), new Set(), labels, 3).pills[0];
		const middle = monthPills(info('2026-10-14'), new Set(), labels, 3).pills[0];
		const last = monthPills(info('2026-10-16'), new Set(), labels, 3).pills[0];
		expect([first.label, first.continuesLeft, first.continuesRight]).toEqual(['Urlaub', false, true]);
		expect([middle.label, middle.continuesLeft, middle.continuesRight]).toEqual(['', true, true]);
		expect([last.label, last.continuesLeft, last.continuesRight]).toEqual(['', true, false]);
	});
	it('starts a new labelled segment on Monday and breaks the bar on Sunday', () => {
		const run = absence({ startDate: '2026-10-15', endDate: '2026-10-21' });
		const sunday = monthPills(info('2026-10-18', { absences: [run] }), new Set(), labels, 3).pills[0];
		const monday = monthPills(info('2026-10-19', { absences: [run] }), new Set(), labels, 3).pills[0];
		expect([sunday.continuesRight, sunday.label]).toEqual([false, '']);
		expect([monday.continuesLeft, monday.label]).toEqual([false, 'Urlaub']);
	});
	it('puts absences before holidays and the plan, hides filtered kinds and marks open vacation', () => {
		const holiday = { startDate: '2026-10-13', endDate: '2026-10-13', name: 'Feiertag', kind: 'holiday', companyTreatment: null } as DayInfo['holidays'][number];
		const plan = { mode: 'office' } as DayInfo['plan'];
		const result = monthPills(info('2026-10-13', { holidays: [holiday], plan, absences: [absence({ status: 'planned' })] }), new Set(), labels, 5);
		expect(result.pills.map((p) => p.kind)).toEqual(['absence', 'holiday', 'plan']);
		expect(result.pills[0].open).toBe(true);
		expect(monthPills(info('2026-10-13', { holidays: [holiday], plan }), new Set(['vacation', 'holiday']), labels, 5).pills.map((p) => p.kind)).toEqual(['plan']);
	});
	it('truncates to the slots and reports the rest, the "+n" taking the last slot', () => {
		const many = info('2026-10-13', { plan: { mode: 'home' } as DayInfo['plan'], absences: [absence({ id: '1' }), absence({ id: '2', kind: 'sick' })] });
		const result = monthPills(many, new Set(), labels, 2);
		expect(result.pills).toHaveLength(1);
		expect(result.more).toBe(2);
		expect(monthPills(many, new Set(), labels, 3).more).toBe(0);
	});
	it('builds the visible text with day number and labels', () => {
		const shown = monthPills(info('2026-10-13'), new Set(), labels, 3).pills;
		expect(visibleText('2026-10-13', shown)).toBe('13 Urlaub');
		expect(visibleText('2026-10-14', monthPills(info('2026-10-14'), new Set(), labels, 3).pills)).toBe('14');
	});
});
