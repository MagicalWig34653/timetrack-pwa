import { t } from '#lib/i18n/index.js';
import type { AbsenceKind, AbsenceStatus, DocumentStatus, PlanMode, ShareScopes } from '#lib/api/types.js';

export const ABSENCE_KINDS: AbsenceKind[] = ['vacation', 'sick', 'excused', 'other'];
export const ABSENCE_STATUSES: AbsenceStatus[] = ['planned', 'requested', 'approved', 'taken', 'rejected', 'cancelled'];
export const DOCUMENT_STATUSES: DocumentStatus[] = ['not_needed', 'pending', 'submitted'];
export const PLAN_MODES: PlanMode[] = ['office', 'home', 'customer', 'school', 'off'];
export const SHARE_SCOPE_KEYS: (keyof ShareScopes)[] = ['plan', 'actual', 'vacation'];

export const absenceKindLabel = (kind: AbsenceKind) => t(`absence.kind.${kind}`);
export const absenceStatusLabel = (status: AbsenceStatus) => t(`absence.status.${status}`);
export const documentStatusLabel = (status: DocumentStatus) => t(`absence.document.${status}`);
export const planModeLabel = (mode: PlanMode) => t(`plan.mode.${mode}`);
export const scopeLabel = (scope: keyof ShareScopes) => t(`share.scope.${scope}`);

/** Statuses that count as booked / planned vacation (ADR-0005). */
export const BOOKED_STATUSES: AbsenceStatus[] = ['approved', 'taken'];
export const PLANNED_STATUSES: AbsenceStatus[] = ['planned', 'requested'];

/** Tailwind classes per absence kind (color is never the only signal: the label text is always shown). */
export const ABSENCE_CLASSES: Record<AbsenceKind, string> = {
	vacation: 'bg-sky-500/15 text-sky-900 dark:text-sky-200',
	sick: 'bg-rose-500/15 text-rose-900 dark:text-rose-200',
	excused: 'bg-teal-500/15 text-teal-900 dark:text-teal-200',
	other: 'bg-violet-500/15 text-violet-900 dark:text-violet-200'
};

export const PLAN_CLASSES: Record<PlanMode, string> = {
	office: 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
	home: 'bg-teal-500/15 text-teal-900 dark:text-teal-200',
	customer: 'bg-orange-500/15 text-orange-900 dark:text-orange-200',
	school: 'bg-indigo-500/15 text-indigo-900 dark:text-indigo-200',
	off: 'bg-muted text-muted-foreground'
};

export const HOLIDAY_CLASS = 'bg-amber-500/20 text-amber-900 dark:text-amber-200';
export const SCHOOL_HOLIDAY_CLASS = 'bg-yellow-500/15 text-yellow-900 dark:text-yellow-200';
