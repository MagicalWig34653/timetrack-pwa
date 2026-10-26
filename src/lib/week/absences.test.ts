import { describe, expect, it } from 'vitest';
import { absenceRuns, absenceWarning, chipAbsences, hasOpenAbsence } from './absences.js';

const abs = (kind: 'vacation' | 'sick' | 'other', status: 'planned' | 'requested' | 'approved' | 'taken', halfDay = false) => ({ kind, status, halfDay });

describe('absence warnings', () => {
	it('warns for planned and requested, not for decided ones', () => {
		expect(absenceWarning('planned')).toBe('noch nicht beantragt');
		expect(absenceWarning('requested')).toBe('beantragt, noch nicht genehmigt');
		expect(absenceWarning('approved')).toBeNull();
		expect(absenceWarning('taken')).toBeNull();
	});
});

describe('chipAbsences', () => {
	it('always shows open absences, even when the mark says vacation', () => {
		expect(chipAbsences({ mark: 'vacation', absences: [abs('vacation', 'planned')] })).toHaveLength(1);
	});
	it('hides decided absences the mark already shows', () => {
		expect(chipAbsences({ mark: 'vacation', absences: [abs('vacation', 'approved')] })).toHaveLength(0);
		expect(chipAbsences({ mark: 'sick', absences: [abs('sick', 'taken')] })).toHaveLength(0);
	});
	it('keeps kinds without a mark', () => {
		expect(chipAbsences({ mark: 'work', absences: [abs('other', 'approved')] })).toHaveLength(1);
	});
});

describe('absenceRuns', () => {
	it('merges consecutive days of one kind and status and counts half days', () => {
		const runs = absenceRuns([
			{ date: '2026-10-19', absences: [abs('vacation', 'planned')] },
			{ date: '2026-10-20', absences: [abs('vacation', 'planned')] },
			{ date: '2026-10-21', absences: [abs('vacation', 'planned', true)] },
			{ date: '2026-10-22', absences: [abs('vacation', 'approved')] },
			{ date: '2026-10-24', absences: [abs('vacation', 'approved')] }
		]);
		expect(runs).toEqual([
			{ kind: 'vacation', status: 'planned', from: '2026-10-19', to: '2026-10-21', days: 3, counted: 2.5 },
			{ kind: 'vacation', status: 'approved', from: '2026-10-22', to: '2026-10-22', days: 1, counted: 1 },
			{ kind: 'vacation', status: 'approved', from: '2026-10-24', to: '2026-10-24', days: 1, counted: 1 }
		]);
	});
	it('detects open absences', () => {
		expect(hasOpenAbsence([{ absences: [abs('vacation', 'requested')] }])).toBe(true);
		expect(hasOpenAbsence([{ absences: [abs('vacation', 'approved')] }])).toBe(false);
	});
});

describe('chipAbsences on free days and with a vacation list', () => {
	it('shows nothing on free days', () => {
		expect(chipAbsences({ mark: 'off', absences: [abs('vacation', 'planned')] })).toHaveLength(0);
		expect(chipAbsences({ mark: 'holiday', absences: [abs('other', 'planned')] })).toHaveLength(0);
	});
	it('leaves vacation to the vacation chips when the list is loaded', () => {
		expect(chipAbsences({ mark: 'work', absences: [abs('vacation', 'planned'), abs('other', 'approved')] }, true)).toHaveLength(1);
	});
});
