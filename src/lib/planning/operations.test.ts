import { describe, expect, it } from 'vitest';
import type { Absence, AbsenceInput, PlanDay, PlanDayInput } from '#lib/api/types.js';
import { absenceInputOf, createAbsenceOp, deleteAbsenceOp, deletePlanOp, moveAbsenceInput, pasteTargets, putPlanOp, runLimited, updateAbsenceOp, type PlanningApi } from './operations.js';

function fakeApi(initial: { absences?: Absence[]; plan?: PlanDay[]; failPutOn?: string } = {}) {
	const absences = new Map((initial.absences ?? []).map((a) => [a.id, a]));
	const plan = new Map((initial.plan ?? []).map((p) => [p.date, p]));
	let counter = 0;
	const api: PlanningApi = {
		async createAbsence(input: AbsenceInput) {
			const absence = { ...input, id: `n${++counter}`, version: 1, countedHalfDays: 0 } as Absence;
			absences.set(absence.id, absence);
			return absence;
		},
		async updateAbsence(id, input, version) {
			const old = absences.get(id);
			if (!old || old.version !== version) throw new Error('stale');
			const next = { ...old, ...input, version: old.version + 1 } as Absence;
			absences.set(id, next);
			return next;
		},
		async deleteAbsence(id) {
			absences.delete(id);
		},
		async putPlanDay(date, input: PlanDayInput) {
			if (date === initial.failPutOn) throw new Error('fail');
			const day = { date, ...input } as PlanDay;
			plan.set(date, day);
			return day;
		},
		async deletePlanDay(date) {
			plan.delete(date);
		}
	};
	return { api, absences, plan };
}

const vacation: Absence = { id: 'a1', version: 3, kind: 'vacation', startDate: '2031-03-11', endDate: '2031-03-13', status: 'planned', note: 'x', countedHalfDays: 6, halfDayEnd: true };

describe('absence operations', () => {
	it('creates and undoes/redoes a creation', async () => {
		const { api, absences } = fakeApi();
		const { command } = await createAbsenceOp(api, absenceInputOf(vacation), 'create');
		expect(absences.size).toBe(1);
		await command.undo();
		expect(absences.size).toBe(0);
		await command.redo();
		expect(absences.size).toBe(1);
		await command.undo();
		expect(absences.size).toBe(0);
	});
	it('moves an absence keeping half days and note, and undoes with the new version', async () => {
		const { api, absences } = fakeApi({ absences: [vacation] });
		const input = moveAbsenceInput(vacation, { start: '2031-03-18', end: '2031-03-20' });
		expect(input).toMatchObject({ startDate: '2031-03-18', endDate: '2031-03-20', halfDayEnd: true, note: 'x' });
		const { command } = await updateAbsenceOp(api, vacation, input, 'move');
		expect(absences.get('a1')).toMatchObject({ startDate: '2031-03-18', version: 4 });
		await command.undo();
		expect(absences.get('a1')).toMatchObject({ startDate: '2031-03-11', endDate: '2031-03-13', version: 5 });
		await command.redo();
		expect(absences.get('a1')).toMatchObject({ startDate: '2031-03-18', version: 6 });
	});
	it('propagates a stale version without touching anything', async () => {
		const { api } = fakeApi({ absences: [{ ...vacation, version: 9 }] });
		await expect(updateAbsenceOp(api, vacation, absenceInputOf(vacation), 'move')).rejects.toThrow('stale');
	});
	it('deletes and restores an absence', async () => {
		const { api, absences } = fakeApi({ absences: [vacation] });
		const { command } = await deleteAbsenceOp(api, vacation, 'delete');
		expect(absences.size).toBe(0);
		await command.undo();
		expect([...absences.values()][0]).toMatchObject({ kind: 'vacation', startDate: '2031-03-11', halfDayEnd: true });
		await command.redo();
		expect(absences.size).toBe(0);
	});
});

describe('plan operations', () => {
	const dates = ['2031-03-10', '2031-03-11', '2031-03-12'];
	const old: PlanDay = { date: '2031-03-11', mode: 'home', note: 'alt', plannedStart: '08:00', plannedEnd: '16:00', plannedBreakMinutes: 30 };

	it('writes many days and restores previous plans on undo', async () => {
		const { api, plan } = fakeApi({ plan: [old] });
		const { command } = await putPlanOp(api, dates, { mode: 'office' }, [old], 'plan');
		expect([...plan.values()].map((p) => p.mode)).toEqual(["office", "office", "office"]);
		await command.undo();
		expect([...plan.keys()]).toEqual(['2031-03-11']);
		expect(plan.get('2031-03-11')).toMatchObject({ mode: 'home', note: 'alt', plannedStart: '08:00', plannedEnd: '16:00', plannedBreakMinutes: 30 });
		await command.redo();
		expect(plan.size).toBe(3);
	});
	it('rolls back already written days when one write fails', async () => {
		const { api, plan } = fakeApi({ plan: [old], failPutOn: '2031-03-12' });
		await expect(putPlanOp(api, dates, { mode: 'office' }, [old], 'plan')).rejects.toThrow('fail');
		expect([...plan.keys()]).toEqual(['2031-03-11']);
		expect(plan.get('2031-03-11')?.mode).toBe('home');
	});
	it('deletes plans and puts them back on undo', async () => {
		const { api, plan } = fakeApi({ plan: [old] });
		const { command } = await deletePlanOp(api, [old], 'delete');
		expect(plan.size).toBe(0);
		await command.undo();
		expect(plan.get('2031-03-11')).toMatchObject({ mode: 'home', plannedEnd: '16:00' });
	});
});

describe('helpers', () => {
	it('shifts pasted days so the first lands on the target', () => {
		expect(pasteTargets(['2031-03-12', '2031-03-10'], '2031-03-17')).toEqual(['2031-03-17', '2031-03-19']);
		expect(pasteTargets([], '2031-03-17')).toEqual([]);
	});
	it('runs tasks with limited concurrency and stops after a failure', async () => {
		let running = 0;
		let peak = 0;
		const seen: number[] = [];
		await runLimited([1, 2, 3, 4, 5, 6], 2, async (n) => {
			running++;
			peak = Math.max(peak, running);
			await Promise.resolve();
			seen.push(n);
			running--;
		});
		expect(peak).toBeLessThanOrEqual(2);
		expect(seen).toHaveLength(6);
		await expect(runLimited([1, 2, 3], 1, async (n) => { if (n === 2) throw new Error('x'); })).rejects.toThrow('x');
	});
});
