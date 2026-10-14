import { describe, expect, it } from 'vitest';
import { formatHalfDays, formatHalfDaysSigned, halfDaysToInput, parseDaysInput } from './halfdays.js';

describe('formatHalfDays', () => {
	it('derives days with halves from integer half days', () => {
		expect(formatHalfDays(60)).toBe('30 Tage');
		expect(formatHalfDays(25)).toBe('12,5 Tage');
		expect(formatHalfDays(2)).toBe('1 Tag');
		expect(formatHalfDays(1)).toBe('0,5 Tage');
		expect(formatHalfDays(0)).toBe('0 Tage');
		expect(formatHalfDays(3)).toBe('1,5 Tage');
	});
	it('keeps the sign for negative values', () => {
		expect(formatHalfDays(-3)).toBe('-1,5 Tage');
		expect(formatHalfDaysSigned(4)).toBe('+2 Tage');
		expect(formatHalfDaysSigned(-2)).toBe('-1 Tag');
		expect(formatHalfDaysSigned(0)).toBe('0 Tage');
	});
	it('formats input values', () => {
		expect(halfDaysToInput(61)).toBe('30,5');
		expect(halfDaysToInput(60)).toBe('30');
	});
});

describe('parseDaysInput', () => {
	it('accepts whole and half days with comma or dot', () => {
		expect(parseDaysInput('30')).toBe(60);
		expect(parseDaysInput('12,5')).toBe(25);
		expect(parseDaysInput('12.5')).toBe(25);
		expect(parseDaysInput(' 0,5 ')).toBe(1);
	});
	it('rejects other fractions, text and (by default) negatives', () => {
		expect(parseDaysInput('12,3')).toBeNull();
		expect(parseDaysInput('abc')).toBeNull();
		expect(parseDaysInput('')).toBeNull();
		expect(parseDaysInput('-1')).toBeNull();
		expect(parseDaysInput('-1,5', { allowNegative: true })).toBe(-3);
	});
});
