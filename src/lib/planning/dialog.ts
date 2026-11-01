import type { Absence, AbsenceInput, AbsenceKind, AbsenceStatus, PlanDay, PlanDayInput, PlanMode, PlanTimeBlock } from '#lib/api/types.js';
import type { MessageKey } from '#lib/i18n/index.js';
import { isValidDate } from '#lib/time/dates.js';
import { statusToSend } from './absence-status.js';
import { covers } from './calendar.js';
import { isWorkday, type ConflictContext, type PlannedAction } from './conflicts.js';
import { rangeDates, selectionRuns, type DateRange } from './range-select.js';

/** What the precise planning window edits: a working plan or one of the absence kinds. */
export type DialogKind = 'plan' | AbsenceKind;

export interface DialogForm {
	kind: DialogKind;
	start: string;
	end: string;
	/** Explicit, possibly non-contiguous days (multi-select); null = the whole range start..end. */
	days: string[] | null;
	mode: PlanMode;
	placeId: string;
	plannedStart: string;
	plannedEnd: string;
	breakMinutes: string;
	/**
	 * Blocks of the plan being edited (contract 0.35.0). They are written back unchanged while the window fields still show
	 * the values derived from them; touching start, end or break replaces them with the single window.
	 */
	blocks: PlanTimeBlock[] | null;
	blocksWindow: string;
	note: string;
	status: AbsenceStatus;
	halfDayStart: boolean;
	halfDayEnd: boolean;
	onlyWorkdays: boolean;
}

export interface DialogSeed {
	start: string;
	end: string;
	days?: string[] | null;
	kind?: DialogKind;
	absence?: Absence | null;
	plan?: PlanDay | null;
}

export type DialogResult =
	| { type: 'plan'; dates: string[]; input: PlanDayInput }
	| { type: 'absence'; runs: DateRange[]; template: Omit<AbsenceInput, 'startDate' | 'endDate'>; editing: Absence | null };

const windowKey = (start: string, end: string, pause: string) => `${start}|${end}|${pause.trim()}`;

/** True while the plan's block list is untouched: the window fields still equal the ones derived from the blocks. */
export const keepsBlocks = (form: DialogForm) => form.blocks !== null && windowKey(form.plannedStart, form.plannedEnd, String(form.breakMinutes)) === form.blocksWindow;

export function formFromSeed(seed: DialogSeed): DialogForm {
	const absence = seed.absence ?? null;
	const plan = seed.plan ?? null;
	const multi = seed.start !== seed.end || (seed.days?.length ?? 0) > 1;
	return {
		kind: absence ? absence.kind : (seed.kind ?? 'plan'),
		start: absence?.startDate ?? seed.start,
		end: absence?.endDate ?? seed.end,
		days: absence ? null : (seed.days ?? null),
		mode: plan?.mode ?? 'office',
		placeId: plan?.placeId ?? '',
		plannedStart: plan?.plannedStart ?? '',
		plannedEnd: plan?.plannedEnd ?? '',
		breakMinutes: plan?.plannedBreakMinutes != null ? String(plan.plannedBreakMinutes) : '',
		blocks: plan && Array.isArray(plan.blocks) && plan.blocks.length > 0 ? plan.blocks : null,
		blocksWindow: windowKey(plan?.plannedStart ?? '', plan?.plannedEnd ?? '', plan?.plannedBreakMinutes != null ? String(plan.plannedBreakMinutes) : ''),
		note: absence?.note ?? plan?.note ?? '',
		status: absence?.status ?? 'planned',
		halfDayStart: absence?.halfDayStart ?? false,
		halfDayEnd: absence?.halfDayEnd ?? false,
		onlyWorkdays: absence ? false : multi
	};
}

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Days a plan would be written to: the selection or range, optionally only working days that are not holidays. */
export function planDates(form: DialogForm, ctx: ConflictContext): string[] {
	if (!isValidDate(form.start) || !isValidDate(form.end) || form.end < form.start) return [];
	const all = form.days && form.days.length > 0 ? [...form.days].sort() : rangeDates({ start: form.start, end: form.end });
	if (!form.onlyWorkdays || form.mode === 'off') return all;
	return all.filter((d) => isWorkday(d, ctx.models) && !ctx.holidays.some((h) => h.kind === 'holiday' && covers(h, d)));
}

/** The action for conflict detection and the days it touches (absences: the whole range, one absence per run). */
export function previewOf(form: DialogForm, ctx: ConflictContext, editing: Absence | null): { action: PlannedAction; dates: string[] } {
	if (form.kind === 'plan') return { action: { type: 'plan', mode: form.mode }, dates: planDates(form, ctx) };
	const dates = !isValidDate(form.start) || !isValidDate(form.end) || form.end < form.start ? [] : form.days && form.days.length > 0 ? [...form.days].sort() : rangeDates({ start: form.start, end: form.end });
	return { action: { type: 'absence', kind: form.kind, ignoreAbsenceId: editing?.id }, dates };
}

export type FormErrors = Partial<Record<'start' | 'end' | 'time' | 'break' | 'note' | 'days', MessageKey>>;

/** Validates the form and builds what the page writes. Pure: no API, no DOM. */
export function buildResult(form: DialogForm, ctx: ConflictContext, editing: Absence | null): { ok: true; result: DialogResult } | { ok: false; errors: FormErrors } {
	const errors: FormErrors = {};
	if (!isValidDate(form.start)) errors.start = 'pd.error_date';
	if (!isValidDate(form.end)) errors.end = 'pd.error_date';
	else if (isValidDate(form.start) && form.end < form.start) errors.end = 'pd.error_end_before_start';
	const limit = form.kind === 'plan' ? 200 : 500;
	if (form.note.length > limit) errors.note = 'pd.error_note';

	if (form.kind === 'plan') {
		const hasStart = form.plannedStart !== '';
		const hasEnd = form.plannedEnd !== '';
		if (form.mode !== 'off' && (hasStart || hasEnd)) {
			if (!hasStart || !hasEnd || !TIME.test(form.plannedStart) || !TIME.test(form.plannedEnd) || form.plannedStart >= form.plannedEnd) errors.time = 'pd.error_time';
		}
		const pause = String(form.breakMinutes).trim();
		if (pause !== '') {
			const minutes = Number(pause);
			if (!Number.isInteger(minutes) || minutes < 0 || minutes > 600 || !(hasStart && hasEnd) || form.mode === 'off') errors.break = 'pd.error_break';
		}
		const dates = planDates(form, ctx);
		if (Object.keys(errors).length === 0 && dates.length === 0) errors.days = 'pd.error_no_days';
		if (Object.keys(errors).length > 0) return { ok: false, errors };
		const timed = form.mode !== 'off' && form.plannedStart && form.plannedEnd;
		const input: PlanDayInput = {
			mode: form.mode,
			placeId: form.placeId || null,
			note: form.note.trim() || null,
			...(form.mode !== 'off' && keepsBlocks(form)
				? { blocks: form.blocks!.map((b) => ({ start: b.start, end: b.end, kind: b.kind, placeId: b.placeId ?? null, note: b.note ?? null })) }
				: timed ? { plannedStart: form.plannedStart, plannedEnd: form.plannedEnd, plannedBreakMinutes: pause === '' ? null : Number(form.breakMinutes) } : {})
		};
		return { ok: true, result: { type: 'plan', dates, input } };
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };
	const runs = form.days && form.days.length > 0 && !editing ? selectionRuns(form.days) : [{ start: form.start, end: form.end }];
	return {
		ok: true,
		result: {
			type: 'absence',
			runs,
			editing,
			template: {
				kind: form.kind,
				status: statusToSend(form.kind as AbsenceKind, form.status, editing),
				halfDayStart: form.halfDayStart,
				halfDayEnd: form.halfDayEnd,
				note: form.note.trim() || null,
				// Documents and attachments stay in the full form (inspector); an edit keeps what is stored.
				documentStatus: editing?.documentStatus ?? 'not_needed',
				documentSubmittedOn: editing?.documentSubmittedOn ?? null,
				documentReferenceStart: editing?.documentReferenceStart ?? null,
				documentReferenceEnd: editing?.documentReferenceEnd ?? null
			}
		}
	};
}
