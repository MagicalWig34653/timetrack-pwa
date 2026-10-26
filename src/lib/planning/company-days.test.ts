import { describe, expect, it } from 'vitest';
import { holidayHint, parseFixedDate, validateRows, withSuggested } from './company-days';

describe('parseFixedDate', () => {
	it('accepts day.month with or without trailing dot', () => {
		expect(parseFixedDate('24.12.')).toEqual({ month: 12, day: 24 });
		expect(parseFixedDate(' 1.6 ')).toEqual({ month: 6, day: 1 });
	});
	it('rejects invalid dates and 29.02.', () => {
		for (const bad of ['', '31.04.', '0.1.', '32.1.', '12.13.', '29.02.', 'abc']) expect(parseFixedDate(bad)).toBeNull();
	});
});

describe('withSuggested', () => {
	it('adds 24.12. and 31.12. with none when the server omits them and sorts by date', () => {
		const list = withSuggested([{ month: 6, day: 12, treatment: 'full', name: 'Betriebsausflug' }]);
		expect(list.map((d) => `${d.day}.${d.month}.${d.treatment}`)).toEqual(['12.6.full', '24.12.none', '31.12.none']);
	});
	it('keeps server rules', () => {
		expect(withSuggested([{ month: 12, day: 24, treatment: 'half', name: 'Heiligabend' }]).find((d) => d.day === 24)?.treatment).toBe('half');
	});
});

describe('validateRows', () => {
	it('builds rules and drops empty names to null', () => {
		const result = validateRows([{ date: '12.06.', treatment: 'full', name: ' Ausflug ' }, { date: '1.7.', treatment: 'half', name: '' }]);
		expect(result.errors).toEqual({});
		expect(result.days).toEqual([
			{ month: 6, day: 12, treatment: 'full', name: 'Ausflug' },
			{ month: 7, day: 1, treatment: 'half', name: null }
		]);
	});
	it('reports invalid, leap-day, duplicate and too long names per row', () => {
		const result = validateRows([
			{ date: 'x', treatment: 'full', name: '' },
			{ date: '29.02.', treatment: 'full', name: '' },
			{ date: '12.06.', treatment: 'full', name: '' },
			{ date: '12.6.', treatment: 'half', name: '' },
			{ date: '13.06.', treatment: 'full', name: 'a'.repeat(81) }
		]);
		expect(Object.keys(result.errors)).toEqual(['0', '1', '3', '4']);
		expect(result.errors[1]).toContain('29.02.');
		expect(result.errors[3]).toContain('schon eine Regel');
	});
	it('limits the list to 12 rules', () => {
		const rows = Array.from({ length: 13 }, (_, i) => ({ date: `${i + 1}.01.`, treatment: 'full' as const, name: '' }));
		expect(validateRows(rows).listError).toContain('12');
		expect(validateRows(rows.slice(0, 12)).listError).toBe('');
	});
});

describe('holidayHint', () => {
	it('says that a half day halves the target', () => expect(holidayHint('Heiligabend', 'half')).toBe('Heiligabend – halber Betriebstag, Soll halbiert'));
	it('keeps plain names plain', () => expect(holidayHint('Neujahr', null)).toBe('Neujahr'));
});
