import { t } from '#lib/i18n/index.js';
import { KNOWN_STATUSES } from './absence-status.js';
import type { DayWorkState } from '#lib/planning/calendar.js';
import type { AbsenceKind, AbsenceStatus, KnownAbsenceStatus, DocumentStatus, PlanBlockKind, PlanHint, PlanMode, ShareScopes } from '#lib/api/types.js';

export const ABSENCE_KINDS: AbsenceKind[] = ['vacation', 'sick', 'excused', 'other'];
export const ABSENCE_STATUSES: AbsenceStatus[] = [...KNOWN_STATUSES];
export const DOCUMENT_STATUSES: DocumentStatus[] = ['not_needed', 'pending', 'submitted'];
export const PLAN_MODES: PlanMode[] = ['office', 'home', 'customer', 'school', 'off'];
/** Kinds of a plan block (contract 0.35.0), in the order of the brush. */
export const BLOCK_KINDS: PlanBlockKind[] = ['work', 'school', 'travel', 'office', 'home', 'customer'];
export const SHARE_SCOPE_KEYS: (keyof ShareScopes)[] = ['plan', 'actual', 'vacation'];

export const absenceKindLabel = (kind: AbsenceKind) => t(`absence.kind.${kind}`);
/** Label of a status; an unknown value from a newer server is shown as received instead of a missing-key marker. */
export const absenceStatusLabel = (status: AbsenceStatus) => (KNOWN_STATUSES.includes(status) ? t(`absence.status.${status as KnownAbsenceStatus}`) : String(status || '–'));
/** Short status text for chips and day details: a plain "recorded" entry of sick/excused/other needs no extra wording. */
export const absenceStatusHint = (absence: { kind: AbsenceKind; status: AbsenceStatus }) => (absence.kind !== 'vacation' && absence.status === 'recorded' ? '' : absenceStatusLabel(absence.status));
export const documentStatusLabel = (status: DocumentStatus) => t(`absence.document.${status}`);
export const planModeLabel = (mode: PlanMode) => t(`plan.mode.${mode}`);
export const blockKindLabel = (kind: PlanBlockKind) => t(`plan.kind.${kind}`);
export const planHintLabel = (hint: PlanHint) => t(`plan.hint.${hint}`);
export const scopeLabel = (scope: keyof ShareScopes) => t(`share.scope.${scope}`);

/** Statuses that count as booked / planned vacation (ADR-0005). */
export const BOOKED_STATUSES: AbsenceStatus[] = ['approved', 'taken', 'recorded'];
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

export const BLOCK_KIND_CLASSES: Record<PlanBlockKind, string> = {
	work: 'bg-blue-500/15 text-blue-900 dark:text-blue-200',
	school: PLAN_CLASSES.school,
	travel: 'bg-yellow-500/20 text-yellow-900 dark:text-yellow-200',
	office: PLAN_CLASSES.office,
	home: PLAN_CLASSES.home,
	customer: PLAN_CLASSES.customer
};

export const HOLIDAY_CLASS = 'bg-amber-500/20 text-amber-900 dark:text-amber-200';
export const SCHOOL_HOLIDAY_CLASS = 'bg-yellow-500/15 text-yellow-900 dark:text-yellow-200';

/**
 * Tile background per work state (P5). Alpha tints keep the dark/light text readable in both themes;
 * planned vacation is lighter with a dashed border, so booked and planned differ without relying on colour alone.
 */
export const WORK_STATE_CLASSES: Record<DayWorkState, string> = {
	work: 'bg-emerald-500/10',
	free: 'bg-zinc-500/20',
	vacation_booked: 'bg-sky-500/30',
	vacation_planned: 'bg-sky-500/10 border-2 border-dashed border-sky-600/60 dark:border-sky-400/60',
	sick: 'bg-rose-500/25',
	absence: 'bg-violet-500/25'
};

export const WORK_STATE_ORDER: DayWorkState[] = ['work', 'free', 'vacation_booked', 'vacation_planned', 'sick', 'absence'];
export const workStateLabel = (state: DayWorkState) => t(`calendar.state.${state}`);
