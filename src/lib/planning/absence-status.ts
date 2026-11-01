// Status semantics per absence kind (contract 0.36.0, ADR-0032). Only vacation has the request workflow; sick and excused
// leave are merely recorded, "other" is a plain entry. Unknown status strings from newer servers are tolerated everywhere.
import type { Absence, AbsenceKind, AbsenceStatus } from '#lib/api/types.js';

/** Statuses the form may send per kind (the table of ADR-0032). */
export const STATUSES_BY_KIND: Record<AbsenceKind, readonly AbsenceStatus[]> = {
	vacation: ['planned', 'requested', 'approved', 'taken', 'rejected', 'cancelled'],
	sick: ['recorded', 'cancelled'],
	excused: ['recorded', 'cancelled'],
	other: ['planned', 'recorded', 'cancelled']
};

/** Every status the UI knows (filters, sorting); anything else is shown as received. */
export const KNOWN_STATUSES: readonly AbsenceStatus[] = ['planned', 'requested', 'approved', 'taken', 'recorded', 'rejected', 'cancelled'];

/** Only vacation goes through request and approval. */
export const hasApprovalWorkflow = (kind: AbsenceKind | string) => kind === 'vacation';

/** Status for a new entry: vacation starts as plan, the other kinds are recorded (the server default). */
export const defaultStatusFor = (kind: AbsenceKind): AbsenceStatus => (kind === 'vacation' ? 'planned' : 'recorded');

/** Statuses a quick-change menu offers for an entry of this kind. */
export function quickStatusesFor(kind: AbsenceKind | string): readonly AbsenceStatus[] {
	if (kind === 'vacation') return ['planned', 'approved', 'taken', 'cancelled'];
	if (kind === 'other') return ['planned', 'recorded', 'cancelled'];
	return ['recorded', 'cancelled'];
}

export const isCancelledLike = (status: string) => status === 'cancelled' || status === 'rejected';

/** The entry is decided / happened: approved or taken vacation, recorded sick/excused/other entries (legacy values count too). */
export function isBookedAbsence(absence: Pick<Absence, 'kind' | 'status'>): boolean {
	return absence.status === 'approved' || absence.status === 'taken' || absence.status === 'recorded';
}

/** Vacation that is planned or requested only (hollow display, open warning). Never true for the other kinds. */
export function isOpenVacation(absence: Pick<Absence, 'kind' | 'status'>): boolean {
	return absence.kind === 'vacation' && (absence.status === 'planned' || absence.status === 'requested');
}

/**
 * Status to send for an edit: vacation sends the selection; the other kinds keep the stored status when it is valid for the
 * kind (a cancelled entry stays cancelled) and otherwise omit it so that the server picks its default.
 */
export function statusToSend(kind: AbsenceKind, selected: AbsenceStatus, initial: Pick<Absence, 'kind' | 'status'> | null): AbsenceStatus | undefined {
	if (kind === 'vacation') return STATUSES_BY_KIND.vacation.includes(selected) ? selected : 'planned';
	if (initial && initial.kind === kind && STATUSES_BY_KIND[kind].includes(initial.status)) return initial.status;
	return undefined;
}
