import { describe, expect, it } from 'vitest';
import { offDayBooking, offDayBookingHint } from './off-day-booking.js';

describe('off-day booking hint (ADR-0034)', () => {
	it('flags tracked time on a vacation day and says it counts as overtime', () => {
		expect(offDayBooking({ mark: 'vacation', workSeconds: 3600 })).toBe('vacation');
		expect(offDayBookingHint({ mark: 'vacation', workSeconds: 3600 })).toBe('Buchung an Urlaubstag: Die gebuchte Zeit zählt als Überstunde.');
	});

	it('also flags a running or zero-length booking (segments) and the day evaluation shape', () => {
		expect(offDayBooking({ mark: 'vacation', workSeconds: 0, segmentsCount: 1 })).toBe('vacation');
		expect(offDayBooking({ mark: 'vacation', rawWorkSeconds: 600 })).toBe('vacation');
	});

	it('covers sick, excused and holiday days the same way', () => {
		expect(offDayBookingHint({ mark: 'sick', workSeconds: 60 })).toContain('Krankheitstag');
		expect(offDayBookingHint({ mark: 'excused', workSeconds: 60 })).toContain('Freistellungstag');
		expect(offDayBookingHint({ mark: 'holiday', workSeconds: 60 })).toContain('Feiertag');
	});

	it('stays silent without a booking or on normal days', () => {
		expect(offDayBookingHint({ mark: 'vacation', workSeconds: 0, segmentsCount: 0 })).toBeNull();
		expect(offDayBookingHint({ mark: 'work', workSeconds: 3600, segmentsCount: 1 })).toBeNull();
		expect(offDayBookingHint({ mark: 'none', rawWorkSeconds: 3600 })).toBeNull();
		expect(offDayBookingHint({ workSeconds: 3600 })).toBeNull();
	});
});
