<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { MenuEntry } from '#lib/a11y/context-menu.svelte.js';
	import { api } from '#lib/api/client.js';
	import type { Absence, AbsenceInput, AbsenceKind, AbsenceStatus, CalendarDay, DayEvaluation, Place, PlanDay, WorkModel } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import DayDetail from '#lib/components/day/DayDetail.svelte';
	import CalendarBoard from '#lib/components/planning/CalendarBoard.svelte';
	import CalendarShortcuts from '#lib/components/planning/CalendarShortcuts.svelte';
	import PlanDialog from '#lib/components/planning/PlanDialog.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { holidayHint } from '#lib/planning/company-days.js';
	import { addMonths, covers, dayInfo, dayWorkState, monthGrid, weekOf, yearsOf, type DayInfo } from '#lib/planning/calendar.js';
	import { findConflicts, hasBlocking, severityByDate, type ConflictContext } from '#lib/planning/conflicts.js';
	import type { DialogResult, DialogSeed } from '#lib/planning/dialog.js';
	import { previewRange, type DragOp } from '#lib/planning/drag.js';
	import { defaultStatusFor, quickStatusesFor } from '#lib/planning/absence-status.js';
	import { ABSENCE_CLASSES, absenceKindLabel, absenceStatusLabel, HOLIDAY_CLASS, PLAN_CLASSES, planModeLabel, SCHOOL_HOLIDAY_CLASS, WORK_STATE_CLASSES, WORK_STATE_ORDER, workStateLabel } from '#lib/planning/labels.js';
	import { absenceInputOf, createAbsenceOp, deleteAbsenceOp, deletePlanOp, moveAbsenceInput, pasteTargets, putPlanOp, updateAbsenceOp, type Operation } from '#lib/planning/operations.js';
	import { addRange, emptySelection, rangeDates, selectionRuns, selectOne, selectRangeTo, shiftRange, toggleDate, type DateRange, type Selection } from '#lib/planning/range-select.js';
	import { combine, UndoStack } from '#lib/planning/undo.js';
	import { weekBalance } from '#lib/planning/week-balance.js';
	import YearOverview from '#lib/components/planning/YearOverview.svelte';
	import { monthSummary } from '#lib/planning/cell-model.js';
	import { durationText } from '#lib/planning/week-balance-text.js';
	import WeekBalanceLabel from '#lib/components/planning/WeekBalanceLabel.svelte';
	import { addDays, formatDateLong, formatDateNumeric, isoWeekLabel, isoWeekNumber, isValidDate, todayLocal } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';

	const timeZone = $derived(zoneStore.value);
	const today = $derived(todayLocal(timeZone));
	const requested = $derived(page.url.searchParams.get('date') ?? '');
	const anchor = $derived(isValidDate(requested) ? requested : today);

	// Month and year only (U1): the week lives on /week, reached by the week number or "Woche öffnen".
	const weeks = $derived(monthGrid(anchor));
	const gridFrom = $derived(weeks[0][0]);
	const gridTo = $derived(weeks[weeks.length - 1][6]);

	const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
	const monthTitle = $derived(`${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`);
	const weekHref = (date: string) => `/week?week=${isoWeekLabel(date)}&day=${date}`;

	let load = $state<LoadState>({ status: 'loading' });
	let holidays = $state<CalendarDay[]>([]);
	let absences = $state<Absence[]>([]);
	let plan = $state<PlanDay[]>([]);
	let days = $state<DayEvaluation[]>([]);
	let places = $state<Place[]>([]);
	let models = $state<WorkModel[]>([]);
	let reloadToken = $state(0);

	// interaction state
	let selection = $state<Selection>(emptySelection);
	let cursor = $state('');
	let op = $state<DragOp | null>(null);
	let rangeMode = $state(false);
	// Legend and filters live in a popover next to the toolbar, closed by default.
	let legendOpen = $state(false);
	let dialog = $state<{ seed: DialogSeed; anchor: DOMRect | null; opener: HTMLElement | null } | null>(null);
	let dialogError = $state('');
	let helpOpen = $state<HTMLElement | null | false>(false);
	let busy = $state(false);
	let notice = $state('');
	let error = $state('');
	let clipboard = $state<PlanDay[]>([]);
	let panelEl = $state<HTMLElement | null>(null);
	const stack = new UndoStack();
	let undoLabel = $state<string | null>(null);
	let redoLabel = $state<string | null>(null);
	const syncStack = () => {
		undoLabel = stack.undoLabel;
		redoLabel = stack.redoLabel;
	};

	// legend = filter: hidden chip kinds, remembered per browser
	function storedHidden(): Set<string> {
		try {
			const raw = JSON.parse(localStorage.getItem('timetrack.calendar.hidden') ?? '[]');
			return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
		} catch {
			return new Set();
		}
	}
	let hidden = $state<Set<string>>(storedHidden());
	function toggleHidden(key: string) {
		const next = new Set(hidden);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		hidden = next;
		try {
			localStorage.setItem('timetrack.calendar.hidden', JSON.stringify([...next]));
		} catch {
			// remembering is a convenience only
		}
	}

	interface Bundle {
		holidays: CalendarDay[];
		absences: Absence[];
		plan: PlanDay[];
		days: DayEvaluation[];
	}
	// Data per visible grid range. The neighbours of the shown month are prefetched, so switching months paints at once
	// and refreshes in the background. Writes clear the cache.
	let cache = new Map<string, Bundle>();
	let cacheToken = 0;

	async function fetchRange(from: string, to: string): Promise<Bundle & { places: Place[]; models: WorkModel[] }> {
		await zoneStore.ensure();
		const [h, a, p, d, pl, wm] = await Promise.all([
			Promise.all(yearsOf(from, to).map((y) => api.listHolidays(y))),
			api.listAbsences(from, to),
			api.listPlanDays(from, to),
			// Evaluation hints are optional: a server without time tracking must not break the calendar.
			api.listDays(from, to).catch(() => [] as DayEvaluation[]),
			api.listPlaces().catch(() => [] as Place[]),
			// Without work models Monday to Friday count as working days.
			api.listWorkModels().catch(() => [] as WorkModel[])
		]);
		return { holidays: h.flat(), absences: a, plan: p, days: d, places: pl.filter((x) => !x.archived), models: wm };
	}

	function apply(b: Bundle) {
		holidays = b.holidays;
		absences = b.absences;
		plan = b.plan;
		days = b.days;
	}

	$effect(() => {
		const from = gridFrom;
		const to = gridTo;
		const token = reloadToken;
		if (token !== cacheToken) {
			cache = new Map();
			cacheToken = token;
		}
		const key = `${from}|${to}`;
		const hit = cache.get(key);
		if (hit) {
			apply(hit);
			load = { status: 'ready' };
		}
		void (async () => {
			try {
				const r = await fetchRange(from, to);
				if (from !== gridFrom) return;
				cache.set(key, { holidays: r.holidays, absences: r.absences, plan: r.plan, days: r.days });
				apply(r);
				places = r.places;
				models = r.models;
				load = { status: 'ready' };
				prefetchNeighbours();
			} catch (e) {
				if (!hit) load = toLoadState(e);
			}
		})();
	});

	function prefetchNeighbours() {
		const token = cacheToken;
		for (const delta of [-1, 1]) {
			const grid = monthGrid(addMonths(anchor, delta));
			const f = grid[0][0];
			const t2 = grid[grid.length - 1][6];
			const key = `${f}|${t2}`;
			if (cache.has(key)) continue;
			void fetchRange(f, t2)
				.then((r) => {
					if (token === cacheToken) cache.set(key, { holidays: r.holidays, absences: r.absences, plan: r.plan, days: r.days });
				})
				.catch(() => undefined);
		}
	}

	$effect(() => {
		if (!cursor) cursor = anchor;
	});

	const data = $derived({ holidays, absences, plan, days });
	const ctx = $derived<ConflictContext>({ holidays, absences, plan, models });
	const infoOf = (date: string): DayInfo => dayInfo(date, data);
	const stateOf = (info: DayInfo) => dayWorkState(info, models);
	const selectedSet = $derived(new Set(selection.dates));
	// Phone: the week list below the month grid follows the selected day (when it lies in the shown grid).
	const phoneWeek = $derived(weekOf(selection.anchor && selection.anchor >= gridFrom && selection.anchor <= gridTo ? selection.anchor : anchor));
	const focusDate = $derived(selection.anchor);
	const absenceById = (id: string) => absences.find((a) => a.id === id);
	const summary = $derived(monthSummary(weeks.flat().filter((d) => d.slice(0, 7) === anchor.slice(0, 7)), data, models, today));
	let yearOpen = $state(false);
	const mode = $derived(yearOpen ? 'year' : 'month');
	const balanceOf = (week: string[]) => weekBalance(week, days, today);

	function describe(info: DayInfo): string {
		const parts: string[] = [formatDateLong(info.date).replace(/\d\d\.\d\d\.\d{4}/, `${Number(info.date.slice(8))}. ${MONTHS[Number(info.date.slice(5, 7)) - 1]} ${info.date.slice(0, 4)}`), workStateLabel(stateOf(info))];
		for (const h of info.holidays) parts.push(`${t('calendar.holiday')} ${holidayHint(h.name, h.companyTreatment)}`);
		for (const h of info.schoolHolidays) parts.push(h.name);
		for (const a of info.absences) parts.push(absenceKindLabel(a.kind));
		if (info.plan) parts.push(`${t('calendar.plan')} ${planModeLabel(info.plan.mode)}`);
		if (info.evaluation && info.evaluation.evaluatedWorkSeconds > 0) parts.push(t('calendar.worked', { time: timeDisplay.duration(info.evaluation.evaluatedWorkSeconds) }));
		return parts.join(', ');
	}

	// --- drag ghost -----------------------------------------------------------------------------------------------

	const ghost = $derived.by(() => {
		if (!op) return null;
		const range = previewRange(op);
		const dates = rangeDates(range);
		const moving = op.type === 'select' ? null : absenceById(op.id);
		const conflicts = moving ? findConflicts(dates, { type: 'absence', kind: moving.kind, ignoreAbsenceId: moving.id }, ctx) : [];
		return { dates: new Set(dates), severity: severityByDate(conflicts), range, count: dates.length, blocked: hasBlocking(conflicts) };
	});

	// --- navigation -----------------------------------------------------------------------------------------------

	const href = (date: string) => `/calendar?date=${date}`;

	function moveCursorTo(date: string) {
		cursor = date;
		if (date < gridFrom || date > gridTo) void goto(href(date), { replace: true, reset: false });
	}

	// --- selection ------------------------------------------------------------------------------------------------

	let scrollTimer: ReturnType<typeof setTimeout> | undefined;

	function pick(date: string, mods: { shift: boolean; meta: boolean }) {
		cursor = date;
		if (mods.shift || (rangeMode && selection.dates.length === 1 && !mods.meta)) selection = selectRangeTo(selection, date);
		else if (mods.meta) selection = toggleDate(selection, date);
		else selection = selectOne(date);
		// Scroll the details into view only after the double-click window: a scroll between the two clicks of a
		// double click would move another tile under the pointer.
		clearTimeout(scrollTimer);
		scrollTimer = setTimeout(() => !dialog && panelEl?.scrollIntoView?.({ block: 'nearest' }), 400);
	}

	function dragSelect(range: DateRange, additive: boolean) {
		selection = additive ? addRange(selection, range) : { dates: rangeDates(range), anchor: range.start };
		cursor = range.end;
	}

	function extendCursor(date: string, extend: boolean) {
		const previous = cursor;
		moveCursorTo(date);
		if (extend) selection = selectRangeTo(selection.anchor ? selection : selectOne(previous), date);
	}

	// --- writing --------------------------------------------------------------------------------------------------

	async function run(job: () => Promise<Operation | null>, message: string) {
		if (busy) return false;
		busy = true;
		error = '';
		try {
			const result = await job();
			if (result) {
				stack.push(result.command);
				syncStack();
			}
			notice = message;
			reloadToken++;
			return true;
		} catch (e) {
			error = errorMessage(e);
			notice = '';
			return false;
		} finally {
			busy = false;
		}
	}

	async function undo() {
		if (busy || !stack.canUndo) return;
		busy = true;
		error = '';
		try {
			const label = await stack.undo();
			notice = label ? t('cal.undone', { label }) : '';
			reloadToken++;
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
			syncStack();
		}
	}

	async function redo() {
		if (busy || !stack.canRedo) return;
		busy = true;
		error = '';
		try {
			const label = await stack.redo();
			notice = label ? t('cal.redone', { label }) : '';
			reloadToken++;
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
			syncStack();
		}
	}

	/** Creates one absence per run; when a later one fails, the earlier ones are removed again. */
	async function createRuns(runs: DateRange[], template: Omit<AbsenceInput, 'startDate' | 'endDate'>, label: string): Promise<Operation> {
		const ops: Operation[] = [];
		try {
			for (const r of runs) ops.push(await createAbsenceOp(api, { ...template, startDate: r.start, endDate: r.end }, label));
		} catch (e) {
			for (const done of ops.reverse()) await done.command.undo().catch(() => undefined);
			throw e;
		}
		return { command: combine(label, ops.map((o) => o.command)) };
	}

	function quickAbsence(kind: AbsenceKind, dates: string[]) {
		const label = t('cal.op_create', { kind: absenceKindLabel(kind) });
		if (hasBlocking(findConflicts(dates, { type: 'absence', kind }, ctx))) {
			error = t('error.absence_overlap');
			return;
		}
		void run(() => createRuns(selectionRuns(dates), { kind, status: defaultStatusFor(kind), halfDayStart: false, halfDayEnd: false, note: null, documentStatus: 'not_needed' }, label), label);
	}

	function openDialog(dates: string[], kind: DialogSeed['kind'], opener: HTMLElement | null, extra: Partial<DialogSeed> = {}) {
		const sorted = [...dates].sort();
		const runs = selectionRuns(sorted);
		dialogError = '';
		dialog = {
			seed: { start: sorted[0], end: sorted[sorted.length - 1], days: runs.length > 1 ? sorted : null, kind, plan: sorted.length === 1 ? (plan.find((p) => p.date === sorted[0]) ?? null) : null, ...extra },
			anchor: opener?.getBoundingClientRect() ?? null,
			opener
		};
	}

	async function submitDialog(result: DialogResult) {
		dialogError = '';
		if (busy) return;
		busy = true;
		error = '';
		try {
			let operation: Operation;
			if (result.type === 'plan') {
				const previous = plan.filter((p) => result.dates.includes(p.date));
				operation = await putPlanOp(api, result.dates, result.input, previous, t('cal.op_plan'));
			} else if (result.editing) {
				const range = result.runs[0];
				operation = await updateAbsenceOp(api, result.editing, { ...result.template, startDate: range.start, endDate: range.end }, t('cal.op_edit'));
			} else {
				operation = await createRuns(result.runs, result.template, t('cal.op_create', { kind: absenceKindLabel(result.template.kind) }));
			}
			stack.push(operation.command);
			syncStack();
			notice = t('cal.saved');
			reloadToken++;
			dialog = null;
		} catch (e) {
			dialogError = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	function applyAbsenceRange(absence: Absence, range: DateRange, label: string) {
		if (range.start === absence.startDate && range.end === absence.endDate) return;
		if (hasBlocking(findConflicts(rangeDates(range), { type: 'absence', kind: absence.kind, ignoreAbsenceId: absence.id }, ctx))) {
			error = t('error.absence_overlap');
			notice = '';
			return;
		}
		void run(() => updateAbsenceOp(api, absence, moveAbsenceInput(absence, range), label), label);
	}

	function setStatus(absence: Absence, status: AbsenceStatus) {
		const label = t('cal.op_status', { status: absenceStatusLabel(status) });
		void run(() => updateAbsenceOp(api, absence, { ...absenceInputOf(absence), status }, label), label);
	}

	function removeAbsences(list: Absence[]) {
		const label = t('cal.op_delete_absence');
		void run(async () => {
			const ops: Operation[] = [];
			for (const a of list) ops.push(await deleteAbsenceOp(api, a, label));
			return { command: combine(label, ops.map((o) => o.command)) };
		}, label);
	}

	function removePlans(dates: string[]) {
		const plans = plan.filter((p) => dates.includes(p.date));
		if (plans.length === 0) return;
		const label = t('cal.op_delete_plan');
		void run(() => deletePlanOp(api, plans, label), label);
	}

	function copyPlans(dates: string[]) {
		clipboard = plan.filter((p) => dates.includes(p.date));
		notice = t('cal.copied', { count: clipboard.length });
	}

	function pastePlans(target: string) {
		const sources = [...clipboard].sort((a, b) => a.date.localeCompare(b.date));
		const targets = pasteTargets(
			sources.map((p) => p.date),
			target
		);
		const label = t('cal.op_paste');
		void run(async () => {
			const ops: Operation[] = [];
			for (const [i, source] of sources.entries()) {
				const { date: _date, plannedSeconds: _seconds, ...input } = source;
				ops.push(
					await putPlanOp(
						api,
						[targets[i]],
						input,
						plan.filter((p) => p.date === targets[i]),
						label
					)
				);
			}
			return { command: combine(label, ops.map((o) => o.command)) };
		}, label);
	}

	// --- context menus --------------------------------------------------------------------------------------------

	function menuFor(date: string, target: Element): MenuEntry[] | null {
		const chip = target.closest<HTMLElement>('[data-absence-id]');
		const absence = chip ? absenceById(chip.dataset.absenceId ?? '') : undefined;
		const opener = target.closest<HTMLElement>('button') ?? null;
		if (absence) {
			return [
				{ id: 'edit', label: t('cal.menu_edit'), icon: Pencil, onselect: () => openDialog([absence.startDate], undefined, opener, { start: absence.startDate, end: absence.endDate, absence }) },
				...quickStatusesFor(absence.kind)
					.filter((s) => s !== absence.status)
					.map<MenuEntry>((s) => ({ id: `status-${s}`, label: t('cal.menu_status', { status: absenceStatusLabel(s) }), onselect: () => setStatus(absence, s) })),
				{ separator: true },
				{ id: 'attachments', label: t('cal.menu_attachments'), icon: ExternalLink, onselect: () => void goto(`/absences?year=${absence.startDate.slice(0, 4)}`) },
				{ separator: true },
				{ id: 'delete', label: t('cal.menu_delete_absence'), icon: Trash2, danger: true, onselect: () => removeAbsences([absence]) }
			];
		}
		const scope = selectedSet.has(date) && selection.dates.length > 1 ? selection.dates : [date];
		const many = scope.length > 1;
		const withPlan = plan.some((p) => scope.includes(p.date));
		const dayAbsences = absences.filter((a) => scope.some((d) => covers(a, d)));
		return [
			{ id: 'vacation', label: many ? t('cal.menu_vacation_n', { count: scope.length }) : t('cal.menu_vacation'), icon: CalendarPlus, onselect: () => quickAbsence('vacation', scope) },
			{ id: 'sick', label: many ? t('cal.menu_sick_n', { count: scope.length }) : t('cal.menu_sick'), onselect: () => quickAbsence('sick', scope) },
			{ id: 'plan', label: t('cal.menu_plan'), onselect: () => openDialog(scope, 'plan', opener) },
			{ id: 'precise', label: t('cal.menu_precise'), onselect: () => openDialog(scope, 'other', opener) },
			{ separator: true },
			{ id: 'copy', label: t('cal.menu_copy'), icon: Copy, disabled: !withPlan, onselect: () => copyPlans(scope) },
			{ id: 'paste', label: t('cal.menu_paste'), icon: ClipboardPaste, disabled: clipboard.length === 0, onselect: () => pastePlans(scope[0]) },
			{ separator: true },
			{ id: 'delete-plan', label: t('cal.menu_delete_plan'), icon: Trash2, disabled: !withPlan, shortcut: 'Entf', onselect: () => removePlans(scope) },
			{ id: 'delete-absence', label: t('cal.menu_delete_absence'), icon: Trash2, danger: true, disabled: dayAbsences.length === 0, onselect: () => removeAbsences(dayAbsences) },
			{ separator: true },
			{ id: 'open', label: t('cal.menu_open_day'), icon: ExternalLink, onselect: () => void goto(`/time/${date}`) },
			{ id: 'undo', label: undoLabel ? t('cal.menu_undo', { label: undoLabel }) : t('cal.undo'), icon: Undo2, disabled: !undoLabel, shortcut: 'Strg+Z', onselect: () => void undo() }
		];
	}

	// --- keyboard (window level; cursor keys live in the board) ---------------------------------------------------

	function isEditable(target: EventTarget | null): boolean {
		return target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (load.status !== 'ready' || isEditable(event.target) || dialog || helpOpen !== false) return;
		if (document.querySelector('[data-testid="context-menu"], dialog[open]')) return;
		const mod = event.metaKey || event.ctrlKey;
		const key = event.key;
		if (mod && key.toLowerCase() === 'z') {
			event.preventDefault();
			void (event.shiftKey ? redo() : undo());
		} else if (mod && key.toLowerCase() === 'y') {
			event.preventDefault();
			void redo();
		} else if (!mod && event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
			const delta = key === 'ArrowLeft' ? -1 : 1;
			const list = absences.filter((a) => covers(a, cursor));
			if (list.length !== 1) return;
			event.preventDefault();
			const a = list[0];
			if (event.shiftKey) {
				const end = addDays(a.endDate, delta);
				if (end >= a.startDate) applyAbsenceRange(a, { start: a.startDate, end }, t('cal.op_resize'));
			} else applyAbsenceRange(a, shiftRange({ start: a.startDate, end: a.endDate }, delta), t('cal.op_move'));
		} else if (!mod && !event.altKey && key === 'Delete') {
			const dates = selection.dates.length > 0 ? selection.dates : [cursor];
			if (plan.some((p) => dates.includes(p.date))) {
				event.preventDefault();
				removePlans(dates);
			}
		} else if (!mod && !event.altKey && key === 'Escape') {
			if (selection.dates.length > 0) {
				selection = emptySelection;
				rangeMode = false;
			}
		} else if (!mod && !event.altKey && key.length === 1) {
			const k = key.toLowerCase();
			if (k === 't') {
				event.preventDefault();
				cursor = today;
				void goto(href(today), { replace: true, reset: false });
			} else if (k === 'm') yearOpen = false;
				else if (k === 'j') yearOpen = true;
				else if (k === 'w') void goto(weekHref(cursor || today));
			else if (key === '?') {
				event.preventDefault();
				helpOpen = (document.activeElement as HTMLElement | null) ?? null;
			}
		}
	}

	const quickKinds: { key: string; kind: AbsenceKind | 'plan'; label: () => string }[] = [
		{ key: 'vacation', kind: 'vacation', label: () => absenceKindLabel('vacation') },
		{ key: 'sick', kind: 'sick', label: () => absenceKindLabel('sick') },
		{ key: 'plan', kind: 'plan', label: () => t('cal.kind_plan') },
		{ key: 'excused', kind: 'excused', label: () => t('c2.freistellen') },
		{ key: 'other', kind: 'other', label: () => absenceKindLabel('other') }
	];

	const legend: { key: string; label: () => string; cls: string }[] = [
		{ key: 'holiday', label: () => t('calendar.holiday'), cls: HOLIDAY_CLASS },
		{ key: 'school_holiday', label: () => t('calendar.school_holiday'), cls: SCHOOL_HOLIDAY_CLASS },
		{ key: 'vacation', label: () => absenceKindLabel('vacation'), cls: ABSENCE_CLASSES.vacation },
		{ key: 'sick', label: () => absenceKindLabel('sick'), cls: ABSENCE_CLASSES.sick },
		{ key: 'excused', label: () => absenceKindLabel('excused'), cls: ABSENCE_CLASSES.excused },
		{ key: 'other', label: () => absenceKindLabel('other'), cls: ABSENCE_CLASSES.other },
		{ key: 'plan', label: () => t('calendar.plan'), cls: PLAN_CLASSES.office }
	];
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!--
	Layout (U1): on landscape desktops (fit variant: 1280 x 640 and larger) the page fills the viewport height: compact
	header, toolbar and summary on top, the month grid takes the remaining height with equal rows, the day details sit in a
	fixed 20 rem column on the right (reserved even without selection, so selecting a day never shifts the grid). Below
	that the details follow the grid and the page scrolls (phones, tablets).
-->
<div class="fit:flex fit:h-[calc(100dvh-60px-4.5rem)] fit:flex-col fit:gap-3" data-testid="calendar-page">
	<PageHeader compact title={t('calendar.title')} description={t('calendar.description')} />

	{#if load.status === 'loading'}
		<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
	{:else if load.status === 'unavailable'}
		<Unavailable />
	{:else if load.status === 'error'}
		<Alert variant="destructive">{load.message}</Alert>
	{:else}
		<div class="fit:grid fit:min-h-0 fit:flex-1 fit:grid-cols-[minmax(0,1fr)_19rem] fit:gap-5" data-testid="calendar-layout">
			<div class="flex min-w-0 flex-col gap-3 fit:min-h-0">
				<div class="flex flex-wrap items-center gap-2">
					<nav class="flex items-center gap-1.5" aria-label={t('calendar.nav_month')}>
						<Button variant="outline" size="icon" class="size-8" href={href(addMonths(anchor, -1))} aria-label={t('calendar.previous_month')}><ChevronLeft /></Button>
						<h2 class="min-w-32 text-center text-[17px] font-semibold tracking-tight" data-testid="calendar-month" aria-live="polite">{monthTitle}</h2>
						<Button variant="outline" size="icon" class="size-8" href={href(addMonths(anchor, 1))} aria-label={t('calendar.next_month')}><ChevronRight /></Button>
						<Button variant="outline" size="sm" href={href(today)}>{t('datenav.today')}</Button>
					</nav>

					<div class="ml-auto flex flex-wrap items-center gap-2">
						<Segmented
							label={t('cal.view')}
							value={mode}
							items={[
								{ id: 'month', label: t('cal.view_month'), testid: 'view-month' },
								{ id: 'year', label: t('c2.year'), testid: 'view-year' }
							]}
							onchange={(id) => (yearOpen = id === 'year')}
						/>
						<Button variant={rangeMode ? 'default' : 'outline'} size="sm" aria-pressed={rangeMode} onclick={() => (rangeMode = !rangeMode)} title={t('cal.range_mode_hint')} data-testid="range-mode">{t('cal.range_mode')}</Button>
						<Button variant="outline" size="icon" class="size-8" aria-label={undoLabel ? t('cal.menu_undo', { label: undoLabel }) : t('cal.undo')} title={t('cal.undo')} disabled={!undoLabel || busy} onclick={() => void undo()} data-testid="undo"><Undo2 /></Button>
						<Button variant="outline" size="icon" class="size-8" aria-label={redoLabel ? t('cal.menu_redo', { label: redoLabel }) : t('cal.redo')} title={t('cal.redo')} disabled={!redoLabel || busy} onclick={() => void redo()} data-testid="redo"><Redo2 /></Button>
						<Button variant="outline" size="sm" class="size-8 px-0" aria-label={t('cal.sc.title')} onclick={(e) => (helpOpen = e.currentTarget)} data-testid="shortcuts-open">?</Button>
						<details bind:open={legendOpen} class="relative" data-testid="calendar-legends">
							<summary class="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border bg-background px-2.5 text-[13px] font-medium select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-input/30" title={t('n2.legend_title')}><ListFilter class="size-4" aria-hidden="true" /><span class="fit:max-[1599px]:sr-only">{t('n2.legend_title')}</span></summary>
							<div class="absolute right-0 z-40 mt-1.5 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
								<ul class="flex flex-wrap gap-2 text-xs" aria-label={t('calendar.legend')} data-testid="calendar-legend">
									{#each legend as item (item.key)}
										<li>
											<button type="button" class="rounded px-1.5 py-0.5 {item.cls} {hidden.has(item.key) ? 'line-through opacity-40' : ''} focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-pressed={!hidden.has(item.key)} title={t('cal.legend_toggle')} onclick={() => toggleHidden(item.key)}>{item.label()}</button>
										</li>
									{/each}
								</ul>
								<ul class="flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label={t('calendar.tile_legend')} data-testid="tile-legend">
									{#each WORK_STATE_ORDER as state (state)}
										<li class="flex items-center gap-1.5" data-state={state}>
											<span class="inline-block size-4 rounded-sm border border-border {WORK_STATE_CLASSES[state]}" aria-hidden="true"></span>
											{workStateLabel(state)}
										</li>
									{/each}
								</ul>
							</div>
						</details>
					</div>
				</div>

				<section class="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-card px-3.5 py-2 text-sm" aria-label={t('c2.summary')} data-testid="month-summary">
					<p class="flex items-baseline gap-1.5"><span class="text-xs text-muted-foreground">{t('c2.ist')}</span><span class="font-medium tabular-nums" data-testid="sum-ist">{summary.complete || summary.actualSeconds > 0 ? timeDisplay.duration(summary.actualSeconds) : '–'}</span></p>
					<p class="flex items-baseline gap-1.5"><span class="text-xs text-muted-foreground">{t('c2.soll')}</span><span class="font-medium tabular-nums" data-testid="sum-soll">{summary.complete ? timeDisplay.duration(summary.targetSeconds) : '–'}</span></p>
					<p class="flex items-baseline gap-1.5"><span class="text-xs text-muted-foreground">{t('c2.saldo')}</span><span class="font-medium tabular-nums {summary.balanceSeconds < 0 ? 'text-amber-700 dark:text-amber-300' : summary.balanceSeconds > 0 ? 'text-emerald-700 dark:text-emerald-300' : ''}" data-testid="sum-saldo">{summary.complete ? timeDisplay.delta(summary.balanceSeconds) : '–'}</span></p>
					<p class="flex items-baseline gap-1.5"><span class="text-xs text-muted-foreground">{t('c2.vacation')}</span><span class="font-medium tabular-nums" data-testid="sum-vacation">{t('c2.vacation_counts', { booked: String(summary.vacationBooked).replace('.', ','), open: String(summary.vacationOpen).replace('.', ',') })}</span></p>
					<p class="flex items-baseline gap-1.5"><span class="text-xs text-muted-foreground">{t('c2.sick')}</span><span class="font-medium tabular-nums" data-testid="sum-sick">{summary.sickDays}</span></p>
					<!-- live status: drag preview, selection count or a short hint -->
					<div class="ml-auto min-w-0 max-w-full truncate text-xs" aria-live="polite" data-testid="calendar-status" title={t('cal.hint')}>
						{#if ghost}
							<span class="text-sm" data-testid="drag-status">
								{t('cal.drag_range', { from: formatDateNumeric(ghost.range.start), to: formatDateNumeric(ghost.range.end), count: ghost.count })}
								{#if ghost.blocked}<span class="font-medium text-destructive"> · {t('pd.blocked')}</span>{/if}
							</span>
						{:else if selection.dates.length > 0}
							<!-- the floating bar shows the count; the live region announces it -->
							<span class="sr-only" data-testid="selection-count">{t('cal.selected', { count: selection.dates.length })}</span>
						{:else}
							<span class="sr-only">{t('cal.hint_short')}</span>
						{/if}
					</div>
				</section>

				{#if yearOpen}
					<div class="relative fit:min-h-0 fit:flex-1 fit:overflow-y-auto">
						<YearOverview year={Number(anchor.slice(0, 4))} {today} {models} onpick={(d) => { yearOpen = false; void goto(href(d), { replace: true, reset: false }); }} />
					</div>
				{/if}
				<div class="fit:min-h-0 fit:flex-1 fit:[--row-min:0px]" class:hidden={yearOpen} data-testid="board-wrap">
					<CalendarBoard
						{weeks}
						{today}
						monthOf={anchor.slice(0, 7)}
						label={monthTitle}
						{phoneWeek}
						{infoOf}
						{stateOf}
						{describe}
						selected={selectedSet}
						{cursor}
						ghost={ghost ? { dates: ghost.dates, severity: ghost.severity } : null}
						{hidden}
						{rangeMode}
						{absenceById}
						{menuFor}
						{balanceOf}
						{models}
						{weekHref}
						bind:op
						onpick={pick}
						ondrag={dragSelect}
						onmove={(a, range) => applyAbsenceRange(a, range, t('cal.op_move'))}
						onresize={(a, range) => applyAbsenceRange(a, range, t('cal.op_resize'))}
						oncursor={extendCursor}
						onquick={(date, el) => openDialog([date], 'plan', el)}
					/>
				</div>
			</div>

			<aside bind:this={panelEl} class="relative mt-1 fit:mt-0 fit:min-h-0 fit:overflow-y-auto fit:pr-1" aria-label={t('cal.inspector')} data-testid="inspector">
				{#if focusDate}
					{@const focusBalance = balanceOf(weekOf(focusDate))}
					<div class="mb-2 flex items-center justify-between gap-2">
						<p class="flex items-baseline gap-2 text-xs text-muted-foreground" data-testid="inspector-week-balance">
							<span>{t('cal.week_balance_inspector', { n: isoWeekNumber(focusDate) })}</span>
							{#if focusBalance}<WeekBalanceLabel balance={focusBalance} week={isoWeekNumber(focusDate)} class="text-xs" />{/if}
						</p>
						<Button variant="outline" size="sm" href={weekHref(focusDate)} data-testid="open-week"><CalendarDays />{t('cal.open_week')}</Button>
					</div>
					<DayDetail date={focusDate} {places} refresh={reloadToken} onchanged={() => reloadToken++} onclose={() => (selection = emptySelection)} />
				{:else}
					<p class="text-sm text-muted-foreground">{t('calendar.pick_day')}</p>
				{/if}
			</aside>
		</div>
	{/if}
</div>

<!-- results appear as a toast so they never push the grid -->
{#if error}
	<div class="fixed inset-x-3 bottom-36 z-40 sm:inset-x-auto sm:right-4 sm:bottom-16 sm:max-w-sm"><Alert variant="destructive" data-testid="calendar-error">{error}</Alert></div>
{:else if notice}
	<div class="fixed inset-x-3 bottom-36 z-40 sm:inset-x-auto sm:right-4 sm:bottom-16 sm:max-w-sm">
		<Alert variant="success" data-testid="calendar-notice">
			{notice}
			{#if undoLabel}<Button class="ml-2" variant="outline" size="sm" onclick={() => void undo()} disabled={busy}>{t('cal.undo')}</Button>{/if}
		</Alert>
	</div>
{/if}

{#if selection.dates.length > 0 && !ghost}
		<div class="fixed inset-x-0 bottom-20 z-30 flex justify-center px-3 sm:bottom-3" data-testid="selection-bar">
			<div class="flex max-w-full flex-wrap items-center gap-2 rounded-2xl border bg-card/95 px-3 py-2 shadow-lg backdrop-blur" role="toolbar" aria-label={t('c2.actions')}>
				<span class="text-sm font-medium" data-testid="bar-count">{t('cal.selected', { count: selection.dates.length })}</span>
				{#each quickKinds as q (q.key)}
					<Button variant="outline" size="sm" onclick={(e) => openDialog(selection.dates, q.kind, e.currentTarget)} data-testid="select-{q.key}">{q.label()}…</Button>
				{/each}
				<Button variant="ghost" size="sm" onclick={() => { selection = emptySelection; rangeMode = false; }}>{t('cal.clear_selection')}</Button>
			</div>
		</div>
	{/if}
	{#if dialog}
		<PlanDialog seed={dialog.seed} {places} {ctx} anchor={dialog.anchor} returnFocus={dialog.opener} {busy} error={dialogError} onsubmit={submitDialog} onclose={() => (dialog = null)} />
	{/if}
	{#if helpOpen !== false}
		<CalendarShortcuts returnFocus={helpOpen} onclose={() => (helpOpen = false)} />
	{/if}
