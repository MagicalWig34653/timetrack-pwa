import { describe, expect, it } from 'vitest';
import type { Absence } from '#lib/api/types.js';
import { defaultStatusFor, hasApprovalWorkflow, isBookedAbsence, isOpenVacation, quickStatusesFor, STATUSES_BY_KIND, statusToSend } from './absence-status.js';
import { absenceStatusLabel } from './labels.js';

const entry = (kind: Absence['kind'], status: string) => ({ kind, status });

describe('absence status semantics (contract 0.36.0)', () => {
	it('only vacation has the approval workflow and starts as plan', () => {
		expect(hasApprovalWorkflow('vacation')).toBe(true);
		expect(['sick', 'excused', 'other'].some(hasApprovalWorkflow)).toBe(false);
		expect(defaultStatusFor('vacation')).toBe('planned');
		expect(defaultStatusFor('sick')).toBe('recorded');
		expect(defaultStatusFor('excused')).toBe('recorded');
	});

	it('offers no request or approval statuses for the other kinds', () => {
		for (const kind of ['sick', 'excused'] as const) {
			expect(STATUSES_BY_KIND[kind]).toEqual(['recorded', 'cancelled']);
			expect(quickStatusesFor(kind)).toEqual(['recorded', 'cancelled']);
		}
		expect(quickStatusesFor('other')).toEqual(['planned', 'recorded', 'cancelled']);
		expect(quickStatusesFor('vacation')).toContain('approved');
		expect(STATUSES_BY_KIND.vacation).not.toContain('recorded');
	});

	it('sends the selected status for vacation only; other kinds keep a valid stored one or omit it', () => {
		expect(statusToSend('vacation', 'requested', null)).toBe('requested');
		expect(statusToSend('vacation', 'recorded', null)).toBe('planned');
		expect(statusToSend('sick', 'planned', null)).toBeUndefined();
		expect(statusToSend('sick', 'planned', entry('sick', 'cancelled'))).toBe('cancelled');
		expect(statusToSend('sick', 'planned', entry('sick', 'approved'))).toBeUndefined();
		expect(statusToSend('sick', 'planned', entry('vacation', 'approved'))).toBeUndefined();
		expect(statusToSend('other', 'planned', entry('other', 'planned'))).toBe('planned');
	});

	it('classifies booked and open entries without assuming a workflow for sick leave', () => {
		expect(isBookedAbsence(entry('sick', 'recorded'))).toBe(true);
		expect(isBookedAbsence(entry('vacation', 'approved'))).toBe(true);
		expect(isBookedAbsence(entry('vacation', 'planned'))).toBe(false);
		expect(isOpenVacation(entry('vacation', 'requested'))).toBe(true);
		expect(isOpenVacation(entry('other', 'planned'))).toBe(false);
	});

	it('labels recorded as "Erfasst" and shows unknown values as received instead of crashing', () => {
		expect(absenceStatusLabel('recorded')).toBe('Erfasst');
		expect(absenceStatusLabel('on_hold')).toBe('on_hold');
		expect(absenceStatusLabel('')).toBe('–');
	});
});
