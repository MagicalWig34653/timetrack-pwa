import { describe, expect, it } from 'vitest';
import { filenameFromDisposition } from '../api/client';
import { fallbackExportName, inclusiveDays, monthRange, validateExportRange, yearRange } from './export';

describe('export range', () => {
	it('computes month shortcuts including year borders and leap years', () => {
		expect(monthRange('2026-10-14', 0)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
		expect(monthRange('2026-10-14', -1)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
		expect(monthRange('2026-01-05', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
		expect(monthRange('2026-12-05', 1)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
		expect(monthRange('2028-02-10', 0).to).toBe('2028-02-29');
		expect(yearRange('2026-10-14')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
	});

	it('counts days inclusively and enforces 366 days', () => {
		expect(inclusiveDays('2026-10-01', '2026-10-31')).toBe(31);
		expect(validateExportRange('2026-01-01', '2026-12-31')).toBeNull();
		expect(validateExportRange('2028-01-01', '2028-12-31')).toBeNull(); // leap year = 366 days
		expect(validateExportRange('2026-01-01', '2027-01-02')).toBe('too_long');
		expect(validateExportRange('2026-10-02', '2026-10-01')).toBe('order');
		expect(validateExportRange('', '2026-10-01')).toBe('invalid');
		expect(validateExportRange('2026-02-30', '2026-03-01')).toBe('invalid');
	});

	it('takes the filename from Content-Disposition, preferring the UTF-8 form', () => {
		expect(filenameFromDisposition('attachment; filename="Arbeitszeit_2026-10-01.csv"')).toBe('Arbeitszeit_2026-10-01.csv');
		expect(filenameFromDisposition(`attachment; filename="a.csv"; filename*=UTF-8''Zeit%20%C3%A4.csv`)).toBe('Zeit ä.csv');
		expect(filenameFromDisposition('attachment; filename=plain.pdf')).toBe('plain.pdf');
		expect(filenameFromDisposition(null)).toBeNull();
		expect(fallbackExportName('2026-10-01', '2026-10-31', 'pdf')).toBe('Arbeitszeit_2026-10-01_2026-10-31.pdf');
	});
});
