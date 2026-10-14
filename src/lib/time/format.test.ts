import { describe, expect, it } from 'vitest';
import { formatDelta, formatDuration, parseDuration } from './format.js';

describe('formatDuration', () => {
	it('formats seconds as h:mm', () => {
		expect(formatDuration(27720)).toBe('7:42');
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(60 * 5)).toBe('0:05');
		expect(formatDuration(38.5 * 3600)).toBe('38:30');
		expect(formatDuration(36000 + 59 * 60 + 59)).toBe('10:59');
	});

	it('keeps the sign for negative values', () => {
		expect(formatDuration(-1080)).toBe('-0:18');
		expect(formatDuration(-27720)).toBe('-7:42');
		expect(formatDuration(-30)).toBe('0:00');
	});

	it('never produces decimals', () => {
		expect(formatDuration(27000)).not.toMatch(/[.,]/);
	});
});

describe('formatDelta', () => {
	it('adds an explicit plus sign', () => {
		expect(formatDelta(900)).toBe('+0:15');
		expect(formatDelta(0)).toBe('0:00');
		expect(formatDelta(-900)).toBe('-0:15');
	});
});

describe('parseDuration', () => {
	it('parses h:mm and minute counts', () => {
		expect(parseDuration('7:42')).toBe(27720);
		expect(parseDuration(' 38:30 ')).toBe(138600);
		expect(parseDuration('-0:18')).toBe(-1080);
		expect(parseDuration('+1:05')).toBe(3900);
		expect(parseDuration('45')).toBe(2700);
	});

	it('rejects decimal hours and garbage', () => {
		expect(parseDuration('7,7')).toBeNull();
		expect(parseDuration('7.5')).toBeNull();
		expect(parseDuration('7:75')).toBeNull();
		expect(parseDuration('')).toBeNull();
		expect(parseDuration('abc')).toBeNull();
	});
});
