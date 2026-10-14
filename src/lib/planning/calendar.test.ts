import { describe, expect, it } from 'vitest';
import type { Absence } from '#lib/api/types.js';
import { addMonths, dayInfo, formatDayMonth, lastOfMonth, monthGrid, parseDayMonth, yearsOf } from './calendar.js';

const absence = (extra: Partial<Absence>): Absence => ({ id: 'a', version: 1, countedHalfDays: 2, kind: 'vacation', startDate: '2026-10-05', endDate: '2026-10-07', status: 'approved', ...extra });

describe('month grid', () => {
	it('starts on Monday and covers the whole month', () => {
		const grid = monthGrid('2026-10-14');
		expect(grid[0][0]).toBe('2026-09-28');
		expect(grid.at(-1)![6]).toBe('2026-11-01');
		expect(grid).toHaveLength(5);
		expect(grid.every((w) => w.length === 7)).toBe(true);
	});
	it('handles month arithmetic across years', () => {
		expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
		expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
		expect(lastOfMonth('2028-02-10')).toBe('2028-02-29');
		expect(yearsOf('2026-12-28', '2027-01-03')).toEqual([2026, 2027]);
	});
});

describe('dayInfo', () => {
	const data = {
		holidays: [
			{ startDate: '2026-10-31', endDate: '2026-10-31', name: 'Reformationstag', kind: 'holiday' as const, source: 'builtin' as const },
			{ id: 'x', startDate: '2026-10-05', endDate: '2026-10-09', name: 'Ferien', kind: 'school_holiday' as const, source: 'custom' as const }
		],
		absences: [absence({}), absence({ id: 'b', status: 'cancelled', startDate: '2026-10-06', endDate: '2026-10-06' })],
		plan: [{ date: '2026-10-06', mode: 'home' as const }],
		days: []
	};
	it('collects holidays, school holidays, active absences and plan for a date', () => {
		const info = dayInfo('2026-10-06', data);
		expect(info.schoolHolidays.map((h) => h.name)).toEqual(['Ferien']);
		expect(info.absences.map((a) => a.id)).toEqual(['a']); // cancelled ignored
		expect(info.plan?.mode).toBe('home');
		expect(dayInfo('2026-10-31', data).holidays[0].name).toBe('Reformationstag');
		expect(dayInfo('2026-10-20', data).absences).toEqual([]);
	});
});

describe('day/month input', () => {
	it('formats and parses', () => {
		expect(formatDayMonth('03-31')).toBe('31.03.');
		expect(formatDayMonth('2026-04-03')).toBe('03.04.');
		expect(parseDayMonth('31.03.')).toBe('03-31');
		expect(parseDayMonth('1.4')).toBe('04-01');
		expect(parseDayMonth('31.04.')).toBeNull();
		expect(parseDayMonth('x')).toBeNull();
	});
});
