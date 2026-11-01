import { describe, expect, it } from 'vitest';
import type { Absence } from '../api/types';
import { halfDaysWithStatus, splitPlanned } from './breakdown';

const absence = (id: string, status: Absence['status'], countedHalfDays: number, kind: Absence['kind'] = 'vacation'): Absence => ({
	id, version: 1, kind, status, countedHalfDays, startDate: '2026-08-03', endDate: '2026-08-07'
});

describe('vacation breakdown', () => {
	const absences = [absence('a', 'planned', 10), absence('b', 'requested', 4), absence('c', 'approved', 6), absence('d', 'planned', 2, 'sick'), absence('e', 'planned', 3)];
	it('sums only vacation with the status and can exclude one absence', () => {
		expect(halfDaysWithStatus(absences, 'planned')).toBe(13);
		expect(halfDaysWithStatus(absences, 'planned', 'a')).toBe(3);
		expect(halfDaysWithStatus(absences, 'requested')).toBe(4);
	});
	it('splits the balance figure so that both parts add up to it', () => {
		expect(splitPlanned({ plannedHalfDays: 17 }, absences)).toEqual({ unsubmittedHalfDays: 13, requestedHalfDays: 4 });
	});
	it('never reports more unsubmitted days than the balance holds', () => {
		expect(splitPlanned({ plannedHalfDays: 5 }, absences)).toEqual({ unsubmittedHalfDays: 5, requestedHalfDays: 0 });
		expect(splitPlanned({ plannedHalfDays: 0 }, [])).toEqual({ unsubmittedHalfDays: 0, requestedHalfDays: 0 });
	});
});
