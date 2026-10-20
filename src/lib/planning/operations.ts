import type { Absence, AbsenceInput, PlanDay, PlanDayInput } from '#lib/api/types.js';
import type { DateRange } from './range-select.js';
import { shiftRange } from './range-select.js';
import type { UndoCommand } from './undo.js';

/** The slice of the API client the calendar writes through (injected so the operations are unit-testable). */
export interface PlanningApi {
	createAbsence(input: AbsenceInput): Promise<Absence>;
	updateAbsence(id: string, input: AbsenceInput, ifMatchVersion: number): Promise<Absence>;
	deleteAbsence(id: string): Promise<void>;
	putPlanDay(date: string, input: PlanDayInput): Promise<PlanDay>;
	deletePlanDay(date: string): Promise<void>;
}

/** Operation result: the command goes onto the undo stack, `message` is the German confirmation text key payload. */
export interface Operation {
	command: UndoCommand;
}

/** The writable fields of an absence (id, version and counted days are server-owned). */
export function absenceInputOf(absence: Absence): AbsenceInput {
	return {
		kind: absence.kind,
		startDate: absence.startDate,
		endDate: absence.endDate,
		halfDayStart: absence.halfDayStart ?? false,
		halfDayEnd: absence.halfDayEnd ?? false,
		status: absence.status,
		note: absence.note ?? null,
		documentStatus: absence.documentStatus ?? 'not_needed',
		documentSubmittedOn: absence.documentSubmittedOn ?? null,
		documentReferenceStart: absence.documentReferenceStart ?? null,
		documentReferenceEnd: absence.documentReferenceEnd ?? null
	};
}

export function planInputOf(plan: PlanDay): PlanDayInput {
	return {
		mode: plan.mode,
		placeId: plan.placeId ?? null,
		note: plan.note ?? null,
		...(plan.plannedStart && plan.plannedEnd ? { plannedStart: plan.plannedStart, plannedEnd: plan.plannedEnd, plannedBreakMinutes: plan.plannedBreakMinutes ?? null } : {})
	};
}

/** Runs tasks with a small concurrency; the first failure stops starting new ones and rejects. */
export async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	let failure: unknown;
	let failed = false;
	const worker = async () => {
		while (!failed && next < items.length) {
			const item = items[next++];
			try {
				await task(item);
			} catch (error) {
				failed = true;
				failure = error;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	if (failed) throw failure;
}

/** Creates one absence; undo deletes it, redo creates it again (new id). */
export async function createAbsenceOp(api: PlanningApi, input: AbsenceInput, label: string): Promise<Operation> {
	let current = await api.createAbsence(input);
	return {
		command: {
			label,
			undo: () => api.deleteAbsence(current.id),
			redo: async () => {
				current = await api.createAbsence(input);
			}
		}
	};
}

/** Changes an absence (move, resize, edit) with optimistic locking; undo writes the previous values back. */
export async function updateAbsenceOp(api: PlanningApi, before: Absence, input: AbsenceInput, label: string): Promise<Operation> {
	const previous = absenceInputOf(before);
	let current = await api.updateAbsence(before.id, input, before.version);
	return {
		command: {
			label,
			undo: async () => {
				current = await api.updateAbsence(current.id, previous, current.version);
			},
			redo: async () => {
				current = await api.updateAbsence(current.id, input, current.version);
			}
		}
	};
}

export const moveAbsenceInput = (absence: Absence, range: DateRange): AbsenceInput => ({ ...absenceInputOf(absence), startDate: range.start, endDate: range.end });

export async function deleteAbsenceOp(api: PlanningApi, absence: Absence, label: string): Promise<Operation> {
	const input = absenceInputOf(absence);
	let current = absence;
	await api.deleteAbsence(absence.id);
	return {
		command: {
			label,
			undo: async () => {
				current = await api.createAbsence(input);
			},
			redo: () => api.deleteAbsence(current.id)
		}
	};
}

/** Writes the same plan to many days; undo restores each day's previous plan (or removes the new one). */
export async function putPlanOp(api: PlanningApi, dates: string[], input: PlanDayInput, previous: PlanDay[], label: string): Promise<Operation> {
	const before = new Map(previous.map((p) => [p.date, p]));
	const done: string[] = [];
	const restore = async (date: string) => {
		const old = before.get(date);
		if (old) await api.putPlanDay(date, planInputOf(old));
		else await api.deletePlanDay(date);
	};
	try {
		await runLimited(dates, 4, async (date) => {
			await api.putPlanDay(date, input);
			done.push(date);
		});
	} catch (error) {
		// Do not leave a half-applied range behind.
		await runLimited(done, 4, restore).catch(() => undefined);
		throw error;
	}
	return {
		command: {
			label,
			undo: () => runLimited(dates, 4, restore),
			redo: () => runLimited(dates, 4, async (date) => void (await api.putPlanDay(date, input)))
		}
	};
}

/** Removes the plan of many days; undo puts the removed plans back. */
export async function deletePlanOp(api: PlanningApi, plans: PlanDay[], label: string): Promise<Operation> {
	await runLimited(plans, 4, (p) => api.deletePlanDay(p.date));
	return {
		command: {
			label,
			undo: () => runLimited(plans, 4, async (p) => void (await api.putPlanDay(p.date, planInputOf(p)))),
			redo: () => runLimited(plans, 4, (p) => api.deletePlanDay(p.date))
		}
	};
}

/** Days a copied plan lands on: the source days shifted so the first one starts at `target`. */
export function pasteTargets(sourceDates: string[], target: string): string[] {
	if (sourceDates.length === 0) return [];
	const sorted = [...sourceDates].sort();
	const days = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${sorted[0]}T00:00:00Z`)) / 86_400_000);
	return sorted.map((d) => shiftRange({ start: d, end: d }, days).start);
}

