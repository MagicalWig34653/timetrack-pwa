import { describe, expect, it } from 'vitest';
import {
	addDays,
	dayBounds,
	dayLengthSeconds,
	fromLocalInputValue,
	isoWeekday,
	localDateOf,
	localTimeOf,
	startOfWeek,
	toLocalInputValue,
	zonedTimeToInstant
} from './dates.js';

describe('local date helpers (Europe/Berlin)', () => {
	it('maps instants to local days around midnight', () => {
		expect(localDateOf('2026-10-14T21:59:59Z')).toBe('2026-10-14'); // 23:59:59 CEST
		expect(localDateOf('2026-10-14T22:00:00Z')).toBe('2026-10-15'); // 00:00 CEST
		expect(localTimeOf('2026-01-15T07:07:00Z')).toBe('08:07'); // CET
	});

	it('adds days and computes weeks across month and year ends', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(isoWeekday('2026-10-14')).toBe(3); // Wednesday
		expect(isoWeekday('2026-10-18')).toBe(7);
		expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
	});

	it('converts local wall-clock times to instants', () => {
		expect(zonedTimeToInstant('2026-07-01', '08:00').toISOString()).toBe('2026-07-01T06:00:00.000Z');
		expect(zonedTimeToInstant('2026-01-15', '08:00').toISOString()).toBe('2026-01-15T07:00:00.000Z');
	});
});

describe('daylight saving days', () => {
	it('has 23 hours on the spring-forward day', () => {
		expect(dayLengthSeconds('2026-03-29')).toBe(23 * 3600);
	});

	it('has 25 hours on the fall-back day', () => {
		expect(dayLengthSeconds('2026-10-25')).toBe(25 * 3600);
	});

	it('has 24 hours on ordinary days', () => {
		expect(dayLengthSeconds('2026-10-14')).toBe(24 * 3600);
	});

	it('bounds the fall-back day at the right UTC instants', () => {
		const { start, end } = dayBounds('2026-10-25');
		expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
		expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
	});

	it('moves a time inside the spring gap forward and resolves the autumn overlap to the first occurrence', () => {
		expect(zonedTimeToInstant('2026-03-29', '02:30').toISOString()).toBe('2026-03-29T01:30:00.000Z');
		expect(zonedTimeToInstant('2026-10-25', '02:30').toISOString()).toBe('2026-10-25T00:30:00.000Z');
	});
});

describe('datetime-local conversion', () => {
	it('round-trips', () => {
		const instant = new Date('2026-10-14T06:07:00Z');
		const value = toLocalInputValue(instant);
		expect(value).toBe('2026-10-14T08:07');
		expect(fromLocalInputValue(value)?.toISOString()).toBe(instant.toISOString());
	});

	it('rejects invalid input', () => {
		expect(fromLocalInputValue('')).toBeNull();
		expect(fromLocalInputValue('2026-02-30T10:00')).toBeNull();
	});
});
