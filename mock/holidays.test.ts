import { describe, expect, it } from 'vitest';
import { easterSunday, holidaysFor } from './holidays.ts';

const dates = (year: number, region?: string) => Object.fromEntries(holidaysFor(year, region).map((h) => [h.name, h.startDate]));

describe('holiday calculator', () => {
	it('computes Easter Sunday', () => {
		expect(easterSunday(2026)).toBe('2026-04-05');
		expect(easterSunday(2025)).toBe('2025-04-20');
		expect(easterSunday(2027)).toBe('2027-03-28');
	});

	it('returns the DE-ST holidays of 2026', () => {
		const d = dates(2026, 'DE-ST');
		expect(d['Neujahr']).toBe('2026-01-01');
		expect(d['Heilige Drei Könige']).toBe('2026-01-06');
		expect(d['Karfreitag']).toBe('2026-04-03');
		expect(d['Ostermontag']).toBe('2026-04-06');
		expect(d['Tag der Arbeit']).toBe('2026-05-01');
		expect(d['Christi Himmelfahrt']).toBe('2026-05-14');
		expect(d['Pfingstmontag']).toBe('2026-05-25');
		expect(d['Tag der Deutschen Einheit']).toBe('2026-10-03');
		expect(d['Reformationstag']).toBe('2026-10-31');
		expect(d['1. Weihnachtstag']).toBe('2026-12-25');
		expect(d['2. Weihnachtstag']).toBe('2026-12-26');
		expect(holidaysFor(2026, 'DE-ST')).toHaveLength(11);
	});

	it('knows the Saxon Buß- und Bettag and omits state specifics elsewhere', () => {
		expect(dates(2026, 'DE-SN')['Buß- und Bettag']).toBe('2026-11-18');
		expect(dates(2026, 'DE-ST')['Buß- und Bettag']).toBeUndefined();
		expect(dates(2026, 'DE')['Reformationstag']).toBeUndefined();
	});

	it('marks them as builtin without ids', () => {
		for (const h of holidaysFor(2026)) {
			expect(h.source).toBe('builtin');
			expect(h.id).toBeNull();
			expect(h.kind).toBe('holiday');
		}
	});
});
