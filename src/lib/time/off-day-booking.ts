import { t } from '#lib/i18n/index.js';

/**
 * Bookings on days marked vacation, sick, excused or holiday are allowed (ADR-0034): the backend evaluates the tracked
 * time in full against a target of 0 (or half the target), so it counts as overtime. The day keeps its mark. This only
 * derives an optional, quiet hint; nothing is blocked.
 */
export type OffDayMark = 'vacation' | 'sick' | 'excused' | 'holiday';

const OFF_DAY_MARKS: readonly string[] = ['vacation', 'sick', 'excused', 'holiday'];

/** The day carries an off-day mark and has tracked time (workSeconds, or segments for a running or zero-length booking). */
export function offDayBooking(day: { mark?: string | null; workSeconds?: number | null; rawWorkSeconds?: number | null; segmentsCount?: number | null }): OffDayMark | null {
	const mark = day.mark ?? 'none';
	if (!OFF_DAY_MARKS.includes(mark)) return null;
	const tracked = (day.workSeconds ?? 0) > 0 || (day.rawWorkSeconds ?? 0) > 0 || (day.segmentsCount ?? 0) > 0;
	return tracked ? (mark as OffDayMark) : null;
}

/** German hint text, or null when the day has no booking on an off day. */
export function offDayBookingHint(day: Parameters<typeof offDayBooking>[0]): string | null {
	const mark = offDayBooking(day);
	return mark === null ? null : t(`day.off_booking_${mark}`);
}
