<script lang="ts">
	import { contextMenu, type MenuEntry } from '#lib/a11y/context-menu.svelte.js';
	import { api } from '#lib/api/client.js';
	import type { AbsenceStatus, LegalProfile, Place, PlanMode, PlanWeek, WorkModel } from '#lib/api/types.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { blockKindLabel, planModeLabel } from '#lib/planning/labels.js';
	import { addDays, formatDateNumeric, localDateOf, localMinutesOf, zonedTimeToInstant } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { clock, type MinuteRange, paintRange, snap } from '#lib/week/grid.js';
	import {
		type BlockId,
		blockId,
		blocksOf,
		breakBlock,
		type Brush,
		type BrushKind,
		canMergeWithNext,
		type Clip,
		copyClip,
		copyToDates,
		type EditCtx,
		type EditResult,
		eraseBlocks,
		eraseDays,
		mergeWithNext,
		moveBlocks,
		paintDays,
		parseBlockId,
		pasteClip,
		putDraft,
		rangeAt,
		replaceBlock,
		resizeBlock,
		setBreakOn,
		setKindOn,
		setModeOn,
		splitBlock
	} from '#lib/week/grid-edit.js';
	import { ADULT_PROFILE, issuesByDate, weekIssues, type DayIssue } from '#lib/week/limits.js';
	import { type BlockKind, BLOCK_KINDS, type DayDraft, type DraftBlock, emptyDraft, modeForKind, newBlock, parseClock, planHintsOfDay, spanOf, type WindowSuggestion } from '#lib/week/plan-draft.js';
	import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
	import Copy from '@lucide/svelte/icons/copy';
	import CopyPlus from '@lucide/svelte/icons/copy-plus';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Scissors from '@lucide/svelte/icons/scissors';
	import Trash from '@lucide/svelte/icons/trash';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
	import X from '@lucide/svelte/icons/x';
	import Coffee from '@lucide/svelte/icons/coffee';
	import Merge from '@lucide/svelte/icons/merge';
	import Split from '@lucide/svelte/icons/split';
	import { onMount } from 'svelte';
	import BlockDialog from './BlockDialog.svelte';
	import CopyDaysDialog from './CopyDaysDialog.svelte';
	import PlannerToolbar from './PlannerToolbar.svelte';
	import WeekGrid, { type Actual, type GridTool } from './WeekGrid.svelte';

	/**
	 * Week planner as a time grid (P11): toolbar with brush, the grid, selection bar, hints. The page owns the drafts and
	 * the undo history; every edit leaves through `commit`. A day holds several blocks (contract 0.35.0, `multi`) or
	 * one block on an older server.
	 */
	let {
		week,
		drafts,
		multi,
		commit,
		undo,
		redo,
		canUndo,
		canRedo,
		undoLabel,
		redoLabel,
		suggestion,
		places,
		today,
		timeZone,
		monday,
		onstandard,
		oncopylast
	}: {
		week: PlanWeek;
		drafts: DayDraft[];
		/** block lists per day (contract 0.35.0) instead of one window */
		multi: boolean;
		commit: (label: string, next: DayDraft[]) => void;
		undo: () => void;
		redo: () => void;
		canUndo: boolean;
		canRedo: boolean;
		undoLabel: string | null;
		redoLabel: string | null;
		suggestion: WindowSuggestion;
		places: Place[];
		today: string;
		timeZone: string;
		monday: string;
		onstandard: () => void;
		oncopylast: () => void;
	} = $props();

	const days = $derived(week.days);
	const ctx = $derived<EditCtx>({ days, multi });
	let legalProfiles = $state<LegalProfile[]>([]);
	let workModels = $state<WorkModel[]>([]);
	onMount(() => {
		void Promise.all([api.listLegalProfiles(), api.listWorkModels()]).then(([profiles, models]) => {
			legalProfiles = profiles;
			workModels = models;
		}).catch(() => undefined);
	});
	function profileForDate(date: string): LegalProfile {
		const model = workModels.find((item) => item.validFrom <= date && (!item.validTo || item.validTo >= date));
		return legalProfiles.find((item) => item.id === (model?.legalProfileId ?? 'arbzg-adult-de')) ?? ADULT_PROFILE;
	}

	// ---- tool and brush --------------------------------------------------------------------------------------
	let tool = $state<GridTool>('draw');
	let brushKind = $state<BrushKind>('office');
	let brushPlace = $state('');
	const brush = $derived<Brush>({ kind: brushKind, placeId: brushPlace || null, breakMinutes: null });
	let selected = $state<BlockId[]>([]);
	let activeDate = $state<string | null>(null);
	let clip = $state<Clip>([]);

	// ---- persisted view option -------------------------------------------------------------------------------
	const ACTUALS_KEY = 'tt.plan.actuals';
	function readFlag(): boolean {
		try {
			return localStorage.getItem(ACTUALS_KEY) === '1';
		} catch {
			return false;
		}
	}
	let showActuals = $state(readFlag());
	$effect(() => {
		const value = showActuals;
		try {
			localStorage.setItem(ACTUALS_KEY, value ? '1' : '0');
		} catch {
			/* storage is optional */
		}
	});

	// ---- phone: one day at a time ----------------------------------------------------------------------------
	let phone = $state(false);
	let dayIndex = $state(0);
	onMount(() => {
		const query = window.matchMedia('(max-width: 639px)');
		phone = query.matches;
		const listener = () => (phone = query.matches);
		query.addEventListener('change', listener);
		return () => query.removeEventListener('change', listener);
	});
	let indexedWeek = '';
	$effect(() => {
		if (indexedWeek === week.week) return;
		indexedWeek = week.week;
		const index = days.findIndex((d) => d.date === today);
		dayIndex = index >= 0 ? index : 0;
	});
	const visible = $derived(phone ? [dayIndex] : days.map((_, i) => i));
	const dayLabel = (i: number) => `${weekdayLabel(days[i].weekday)} ${formatDateNumeric(days[i].date).slice(0, 6)}`;

	// ---- clock, actuals, holidays ----------------------------------------------------------------------------
	let nowMinute = $state<number | null>(null);
	onMount(() => {
		const tick = () => (nowMinute = localMinutesOf(new Date(), timeZone));
		tick();
		const id = setInterval(tick, 30_000);
		return () => clearInterval(id);
	});

	let actuals = $state<Record<string, Actual[]>>({});
	$effect(() => {
		const from = monday;
		if (!showActuals) return;
		let current = true;
		void (async () => {
			try {
				const list = await api.listSegments(zonedTimeToInstant(from, '00:00', timeZone).toISOString(), zonedTimeToInstant(addDays(from, 7), '00:00', timeZone).toISOString());
				if (!current) return;
				const map: Record<string, Actual[]> = {};
				for (const s of list) {
					if (s.voided) continue;
					const date = localDateOf(s.startedAt, timeZone);
					const start = localMinutesOf(s.startedAt, timeZone);
					const running = s.endedAt === null;
					const sameDay = !running && localDateOf(s.endedAt!, timeZone) === date;
					const end = running ? (date === today && nowMinute !== null ? nowMinute : start + 15) : sameDay ? localMinutesOf(s.endedAt!, timeZone) : 24 * 60;
					if (end <= start) continue;
					(map[date] ??= []).push({ start, end, kind: s.kind, running });
				}
				actuals = map;
			} catch {
				if (current) actuals = {};
			}
		})();
		return () => (current = false);
	});

	/** Vacation per day of the week (planned, requested or approved), for the all-day chip and the hatching of the column. */
	let vacation = $state<Record<string, AbsenceStatus>>({});
	$effect(() => {
		const from = monday;
		let current = true;
		void api
			.listAbsences(from, addDays(from, 6))
			.then((list) => {
				if (!current) return;
				const rank: Record<string, number> = { taken: 4, approved: 3, requested: 2, planned: 1 };
				const result: Record<string, AbsenceStatus> = {};
				for (const absence of list) {
					if (absence.kind !== 'vacation' || !(absence.status in rank)) continue;
					for (let d = absence.startDate < from ? from : absence.startDate; d <= absence.endDate && d <= addDays(from, 6); d = addDays(d, 1)) {
						if (!result[d] || rank[absence.status] > rank[result[d]]) result[d] = absence.status;
					}
				}
				vacation = result;
			})
			.catch(() => (vacation = {}));
		return () => (current = false);
	});

	let holidayNames = $state<Record<string, string>>({});
	let holidayTreatments = $state<Record<string, 'half' | 'full'>>({});
	$effect(() => {
		const years = [...new Set([Number(monday.slice(0, 4)), Number(addDays(monday, 6).slice(0, 4))])];
		let current = true;
		void Promise.all(years.map((y) => api.listHolidays(y).catch(() => [])))
			.then((lists) => {
				if (!current) return;
				const names: Record<string, string> = {};
				const treatments: Record<string, 'half' | 'full'> = {};
				for (const day of lists.flat()) {
					if (day.kind !== 'holiday') continue;
					for (let d = day.startDate; d <= day.endDate; d = addDays(d, 1)) {
						names[d] = day.name;
						if (day.companyTreatment) treatments[d] = day.companyTreatment;
					}
				}
				holidayNames = names;
				holidayTreatments = treatments;
			})
			.catch(() => undefined);
		return () => (current = false);
	});

	// ---- hints -----------------------------------------------------------------------------------------------
	const issues = $derived(weekIssues(days, drafts, profileForDate, multi));
	/** Non-binding planning hints per day (contract 0.35.0 `planHints`, mirrored live for the draft). */
	const planHints = $derived(
		drafts.flatMap((draft, index) => (days[index].blockedBy === null ? planHintsOfDay(draft).map((hint) => ({ date: draft.date, hint })) : []))
	);
	function hintText(item: { date: string; hint: string }): string {
		const day = days.find((d) => d.date === item.date)!;
		return t(`plan.hint.${item.hint}` as 'plan.hint.planned_break_short', { day: `${weekdayLabel(day.weekday)} ${formatDateNumeric(day.date).slice(0, 6)}` });
	}
	const issueMap = $derived(issuesByDate(issues));
	function issueText(issue: DayIssue): string {
		const day = days.find((d) => d.date === issue.date)!;
		const params = { day: `${weekdayLabel(day.weekday)} ${formatDateNumeric(day.date).slice(0, 6)}`, time: formatDuration((issue.value ?? 0) * 60), minutes: issue.value ?? 0 };
		return t(`wg.issue.${issue.kind}`, params);
	}

	// ---- helpers ---------------------------------------------------------------------------------------------
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	function say(message: string) {
		notice = message;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = ''), 6000);
	}
	const blockIds = $derived(drafts.flatMap((d, i) => (days[i].blockedBy === null ? blocksOf(d).map((b) => b.id) : [])));
	$effect(() => {
		const keep = selected.filter((id) => blockIds.includes(id));
		if (keep.length !== selected.length) selected = keep;
	});
	const defaultLength = $derived.by(() => {
		const start = parseClock(suggestion.start) ?? 480;
		const end = parseClock(suggestion.end) ?? start + 510;
		return Math.max(15, end - start);
	});

	/** Applies an edit result: commits when something changed and tells about skipped or replaced days. */
	function apply(label: string, result: EditResult): boolean {
		if (result.touched.length === 0) {
			if (result.skipped.length) say(t('wg.say_blocked', { count: result.skipped.length }));
			return false;
		}
		commit(label, result.drafts);
		const parts: string[] = [label];
		if (result.replaced.length) parts.push(t('wg.say_replaced', { count: result.replaced.length }));
		if (result.skipped.length) parts.push(t('wg.say_blocked', { count: result.skipped.length }));
		say(parts.join(' '));
		return true;
	}

	// ---- grid callbacks --------------------------------------------------------------------------------------
	const kindText = (kind: BrushKind) => (kind === 'off' ? planModeLabel('off') : blockKindLabel(kind));
	function paint(dates: string[], range: MinuteRange) {
		const result = paintDays(drafts, ctx, dates, range, brush);
		if (apply(t('wg.did_paint', { mode: kindText(brush.kind) }), result)) selected = result.selection;
	}
	function quick(date: string, minute: number) {
		const range = paintRange(minute, minute + defaultLength, 15);
		paint([date], range);
	}
	function move(sources: BlockId[], deltaDays: number, deltaMinutes: number, copy: boolean): boolean {
		const result = moveBlocks(drafts, ctx, sources, deltaDays, deltaMinutes, copy);
		if (!result.ok) {
			say(t('wg.say_blocked', { count: result.skipped.length || 1 }));
			return false;
		}
		if (!apply(copy ? t('wg.did_copy') : t('wg.did_move'), result)) return false;
		selected = result.selection;
		return true;
	}
	function resize(id: BlockId, range: MinuteRange) {
		const result = resizeBlock(drafts, id, range);
		if (apply(t('wg.did_resize', { start: clock(range.start), end: clock(range.end) }), result)) selected = result.selection;
	}
	function erase(ids: BlockId[]) {
		if (apply(t('wg.did_erase'), eraseBlocks(drafts, ctx, ids))) selected = selected.filter((id) => !ids.includes(id));
	}
	/** Splits a block at the clicked minute, or in the middle (keyboard). */
	function split(id: BlockId, minute?: number, gap = 0) {
		const range = rangeAt(drafts, id);
		if (!range) return;
		const at = minute !== undefined ? snap(minute, 5) : snap((range.start + range.end) / 2, 5);
		const result = gap > 0 ? breakBlock(drafts, ctx, id, gap) : splitBlock(drafts, ctx, id, at);
		if (apply(gap > 0 ? t('wg.did_break', { minutes: gap }) : t('wg.did_split'), result)) selected = result.selection;
		else say(t('wg.say_split_short'));
	}
	function merge(id: BlockId) {
		const result = mergeWithNext(drafts, ctx, id);
		if (apply(t('wg.did_merge'), result)) selected = result.selection;
	}

	// ---- dialogs ---------------------------------------------------------------------------------------------
	interface DialogState {
		/** id of the edited block; null = new block */
		id: BlockId | null;
		/** day-level only (mode, note): chip of a rough plan */
		dayOnly: boolean;
		seed: { date: string; block: DraftBlock; mode: PlanMode; breakMinutes: number; note: string };
		anchor: DOMRect | null;
		returnFocus: HTMLElement | null;
	}
	let dialog = $state<DialogState | null>(null);
	let copyDialog = $state<{ sourceDate: string; anchor: DOMRect | null; returnFocus: HTMLElement | null } | null>(null);
	const blockElement = (id: BlockId) => document.querySelector<HTMLElement>(`[data-block][data-id="${id}"]:not([data-ghost])`);
	const kindForBrush = (): BlockKind => (brushKind === 'off' ? 'office' : brushKind);

	function openEdit(id: BlockId) {
		const { date, index } = parseBlockId(id);
		const draft = drafts.find((d) => d.date === date);
		const block = draft?.blocks[index];
		if (!draft || !block) return;
		const el = blockElement(id);
		dialog = {
			id,
			dayOnly: false,
			seed: { date, block: { ...block, note: multi ? block.note : draft.note, placeId: block.placeId ?? draft.placeId }, mode: draft.mode === '' || draft.mode === 'off' ? modeForKind(block.kind) : draft.mode, breakMinutes: draft.breakMinutes, note: draft.note },
			anchor: el?.getBoundingClientRect() ?? null,
			returnFocus: el
		};
	}
	function openEditDay(date: string) {
		const draft = drafts.find((d) => d.date === date);
		if (!draft || draft.mode === '') return;
		const el = document.querySelector<HTMLElement>(`[data-testid="chip-${date}"]`);
		const kind = kindForBrush();
		dialog = {
			id: null,
			dayOnly: true,
			seed: { date, block: newBlock(480, 720, kind), mode: draft.mode === 'off' ? 'office' : draft.mode, breakMinutes: draft.breakMinutes, note: draft.note },
			anchor: el?.getBoundingClientRect() ?? null,
			returnFocus: el
		};
	}
	function openAdd(date?: string, minute?: number) {
		const index = date ? days.findIndex((d) => d.date === date) : days.findIndex((d, i) => d.blockedBy === null && visible.includes(i));
		const target = days[index >= 0 ? index : 0];
		const draft = drafts.find((d) => d.date === target.date) ?? emptyDraft(target.date);
		// a new block starts after the last block of the day (or at the suggested start) unless a minute was clicked
		const last = spanOf(draft);
		const start = minute !== undefined ? snap(minute, 15) : last && multi ? Math.min(snap(last.end, 15), 22 * 60) : (parseClock(suggestion.start) ?? 480);
		const end = Math.min(start + (multi && last ? 240 : defaultLength), 23 * 60 + 59);
		const kind = kindForBrush();
		const trigger = document.querySelector<HTMLElement>('[data-testid="plan-add-block"]');
		dialog = {
			id: null,
			dayOnly: false,
			seed: { date: target.date, block: newBlock(start, end, kind, brushPlace || null), mode: draft.mode === '' || draft.mode === 'off' ? modeForKind(kind) : draft.mode, breakMinutes: end - start > 360 ? 30 : 0, note: draft.note },
			anchor: trigger?.getBoundingClientRect() ?? null,
			returnFocus: trigger
		};
	}
	function submitDialog(input: { date: string; block: DraftBlock; mode: PlanMode; breakMinutes: number }) {
		if (!dialog) return;
		const { id, dayOnly } = dialog;
		const label = id || dayOnly ? t('wg.did_edit') : t('wg.did_add');
		if (dayOnly) {
			const result = input.mode === 'off' ? setModeOn(drafts, ctx, [input.date], 'off') : setModeOn(drafts, ctx, [input.date], input.mode);
			const index = drafts.findIndex((d) => d.date === input.date);
			let next = result.drafts;
			if (result.touched.length === 0 && drafts[index]?.mode === input.mode) next = drafts;
			const noted = next.map((d) => (d.date === input.date ? { ...d, note: input.block.note } : d));
			if (JSON.stringify(noted) !== JSON.stringify(drafts)) {
				commit(label, noted);
				say(label);
			}
			dialog = null;
			return;
		}
		const result = replaceBlock(drafts, ctx, id, input.date, input.block, { mode: input.mode, breakMinutes: input.breakMinutes, ...(multi ? {} : { dayNote: input.block.note }) });
		if (result.touched.length === 0) {
			say(t('wg.say_blocked', { count: 1 }));
			return;
		}
		commit(label, result.drafts);
		selected = result.selection;
		say(label);
		dialog = null;
	}
	function deleteFromDialog() {
		if (!dialog) return;
		const { id, dayOnly, seed } = dialog;
		dialog = null;
		if (dayOnly || !id) apply(t('wg.did_erase'), eraseDays(drafts, ctx, [seed.date]));
		else erase([id]);
	}
	function openCopyTo(id: BlockId) {
		const el = blockElement(id);
		copyDialog = { sourceDate: parseBlockId(id).date, anchor: el?.getBoundingClientRect() ?? null, returnFocus: el };
	}

	// ---- selection actions -----------------------------------------------------------------------------------
	const selectedBlocks = $derived(
		selected.map((id) => ({ id, ...parseBlockId(id) })).flatMap((ref) => {
			const block = drafts.find((d) => d.date === ref.date)?.blocks[ref.index];
			return block ? [{ ...ref, block }] : [];
		})
	);
	function duplicate() {
		if (!selected.length) return;
		// the next day whose plan is not touched; if every following day has a plan, the first one that takes it
		let fallback = 0;
		for (let shift = 1; shift < 7; shift++) {
			const result = moveBlocks(drafts, ctx, selected, shift, 0, true);
			if (!result.ok) continue;
			if (result.replaced.length === 0) return void move(selected, shift, 0, true);
			fallback ||= shift;
		}
		if (fallback) return void move(selected, fallback, 0, true);
		say(t('wg.say_blocked', { count: 1 }));
	}
	function copy(cut = false) {
		const ids = selected.length ? selected : activeDate ? blocksOf(drafts.find((d) => d.date === activeDate) ?? emptyDraft(activeDate)).map((b) => b.id) : [];
		const next = copyClip(drafts, ids);
		if (next.length === 0) return;
		clip = next;
		say(cut ? t('wg.did_cut', { count: next.length }) : t('wg.did_clip', { count: next.length }));
		if (cut) erase(ids);
	}
	function paste(date?: string) {
		if (!clip.length) return;
		const target = date ?? activeDate ?? (selected[0] ? parseBlockId(selected[0]).date : days[visible[0]].date);
		const result = pasteClip(drafts, ctx, clip, days.some((d) => d.date === target) ? target : days[visible[0]].date);
		if (apply(t('wg.did_paste'), result)) selected = result.selection;
	}
	function setKind(kind: BlockKind) {
		apply(t('wg.did_mode', { mode: blockKindLabel(kind) }), setKindOn(drafts, ctx, selected, kind));
	}
	function setBreak(minutes: number) {
		if (multi) {
			const only = selected.length === 1 ? selected[0] : null;
			if (only) split(only, undefined, minutes);
			return;
		}
		apply(minutes ? t('wg.did_break', { minutes }) : t('wg.did_break_none'), setBreakOn(drafts, selected, minutes));
	}

	function menu(context: { date: string | null; minute: number; id: BlockId | null }): MenuEntry[] {
		if (!context.id) {
			const date = context.date!;
			return [
				{ id: 'add', label: t('wg.menu_add_here'), icon: Plus, onselect: () => openAdd(date, context.minute) },
				{ id: 'paste', label: t('wg.menu_paste'), icon: ClipboardPaste, shortcut: 'Strg+V', disabled: clip.length === 0, onselect: () => paste(date) },
				{ separator: true },
				{ id: 'standard', label: t('weekplan.action_standard'), icon: WandSparkles, onselect: onstandard },
				{ id: 'copylast', label: t('weekplan.action_copy'), icon: Copy, onselect: oncopylast }
			];
		}
		const only = selectedBlocks.length === 1 ? selectedBlocks[0] : null;
		const items: MenuEntry[] = [];
		if (only) items.push({ id: 'edit', label: t('wg.menu_edit'), icon: Pencil, shortcut: 'Enter', onselect: () => openEdit(only.id) }, { separator: true });
		const kinds: BlockKind[] = multi ? BLOCK_KINDS : ['office', 'home', 'customer', 'school'];
		for (const kind of kinds) {
			items.push({ id: `kind-${kind}`, label: t('wg.menu_kind', { kind: blockKindLabel(kind) }), disabled: selectedBlocks.every((b) => b.block.kind === kind), onselect: () => setKind(kind) });
		}
		items.push({ separator: true });
		if (multi && only) {
			items.push({ id: 'split', label: t('wg.menu_split'), icon: Split, shortcut: 'S', onselect: () => split(only.id, context.minute) });
			for (const minutes of [15, 30, 45]) items.push({ id: `break-${minutes}`, label: t('wg.menu_break', { minutes }), icon: Coffee, onselect: () => split(only.id, undefined, minutes) });
			if (canMergeWithNext(drafts, only.id)) items.push({ id: 'merge', label: t('wg.menu_merge'), icon: Merge, onselect: () => merge(only.id) });
		} else if (!multi) {
			items.push({ id: 'break-30', label: t('wg.menu_break_legacy', { minutes: 30 }), icon: Coffee, onselect: () => setBreak(30) });
			items.push({ id: 'break-45', label: t('wg.menu_break_legacy', { minutes: 45 }), icon: Coffee, onselect: () => setBreak(45) });
			if (selectedBlocks.some((b) => (drafts.find((d) => d.date === b.date)?.breakMinutes ?? 0) > 0)) items.push({ id: 'break-none', label: t('wg.menu_break_none'), onselect: () => setBreak(0) });
		}
		items.push({ separator: true });
		items.push({ id: 'duplicate', label: t('wg.menu_duplicate'), icon: CopyPlus, shortcut: 'Strg+D', onselect: duplicate });
		if (only) items.push({ id: 'copy-to', label: t('wg.menu_copy_to'), icon: Copy, onselect: () => openCopyTo(only.id) });
		items.push({ id: 'copy', label: t('wg.menu_copy'), icon: Copy, shortcut: 'Strg+C', onselect: () => copy() });
		items.push({ id: 'cut', label: t('wg.menu_cut'), icon: Scissors, shortcut: 'Strg+X', onselect: () => copy(true) });
		items.push({ separator: true });
		items.push({ id: 'delete', label: t('wg.menu_delete'), icon: Trash, shortcut: 'Entf', danger: true, onselect: () => erase(selected) });
		return items;
	}

	// ---- keyboard --------------------------------------------------------------------------------------------
	const isEditable = (target: EventTarget | null) => target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
	function onKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || isEditable(e.target) || (e.target instanceof Element && e.target.closest('[role="dialog"], [aria-modal="true"]')) || contextMenu.current || dialog || copyDialog) return;
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		if (mod && key === 'z') {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
		} else if (mod && key === 'y') {
			e.preventDefault();
			redo();
		} else if (mod && key === 'c') {
			if (selected.length || activeDate) {
				e.preventDefault();
				copy();
			}
		} else if (mod && key === 'x') {
			if (selected.length) {
				e.preventDefault();
				copy(true);
			}
		} else if (mod && key === 'v') {
			if (clip.length) {
				e.preventDefault();
				paste();
			}
		} else if (mod && key === 'd') {
			if (selected.length) {
				e.preventDefault();
				duplicate();
			}
		} else if (mod && key === 'a') {
			e.preventDefault();
			selected = blockIds.filter((id) => visible.some((i) => days[i].date === parseBlockId(id).date));
		} else if (!mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
			if (selected.length) {
				e.preventDefault();
				erase(selected);
			}
		} else if (!mod && !e.altKey && e.key === 'Escape') {
			selected = [];
		} else if (!mod && !e.altKey && !e.shiftKey && key === 'v') tool = 'select';
		else if (!mod && !e.altKey && !e.shiftKey && key === 'b') tool = 'draw';
		else if (!mod && !e.altKey && !e.shiftKey && key === 'e') tool = 'erase';
	}
	onMount(() => {
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	const swipe = (direction: -1 | 1) => (dayIndex = Math.min(6, Math.max(0, dayIndex + direction)));
</script>

<div class="flex flex-col gap-3 fit:h-full fit:min-h-0 fit:gap-2" data-testid="planner-board">
	<PlannerToolbar bind:tool bind:kind={brushKind} bind:placeId={brushPlace} bind:showActuals {multi} {places} {canUndo} {canRedo} {undoLabel} {redoLabel} onundo={undo} onredo={redo} onadd={() => openAdd()} />

	{#if phone}
		<div class="flex gap-1 overflow-x-auto" role="tablist" aria-label={t('wg.day_tabs')} data-testid="day-tabs">
			{#each days as day, i (day.date)}
				<button
					type="button"
					role="tab"
					aria-selected={dayIndex === i}
					class="flex min-w-[3.1rem] flex-1 flex-col items-center rounded-lg px-1.5 py-1.5 text-xs aria-selected:bg-ui-accent aria-selected:text-ui-accent-foreground {day.date === today ? 'font-semibold' : ''} bg-muted"
					onclick={() => (dayIndex = i)}
					data-testid="day-tab-{day.date}"
				>
					<span>{weekdayLabel(day.weekday)}</span>
					<span class="tabular-nums text-[13px] font-semibold">{Number(day.date.slice(8))}</span>
				</button>
			{/each}
		</div>
		<p class="text-sm font-medium" data-testid="day-title">{dayLabel(dayIndex)}</p>
	{/if}

	<!-- Fixed height: neither the notice nor the selection actions may push the grid around while painting. -->
	<div class="flex h-8 items-center gap-3 fit:h-7 fit:shrink-0">
		<p class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" role="status" aria-live="polite" data-testid="plan-notice">{notice}</p>
		{#if selected.length > 0}
			<div class="flex shrink-0 items-center gap-1.5" role="group" aria-label={t('wg.selection_bar')} data-testid="selection-bar">
				<span class="mr-1 text-[13px] font-medium" data-testid="selection-count">{t('wg.selected', { count: selected.length })}</span>
				{#if selected.length === 1}<Button variant="outline" size="sm" onclick={() => openEdit(selected[0])} data-testid="sel-edit" aria-label={t('wg.menu_edit')}><Pencil /><span class="max-sm:sr-only">{t('wg.menu_edit')}</span></Button>{/if}
				<Button variant="outline" size="sm" onclick={duplicate} data-testid="sel-duplicate" aria-label={t('wg.menu_duplicate')}><CopyPlus /><span class="max-sm:sr-only">{t('wg.menu_duplicate')}</span></Button>
				<Button variant="outline" size="sm" onclick={() => copy()} data-testid="sel-copy" aria-label={t('wg.menu_copy')}><Copy /><span class="max-sm:sr-only">{t('wg.menu_copy')}</span></Button>
				<Button variant="outline" size="sm" onclick={() => erase(selected)} data-testid="sel-delete" aria-label={t('wg.menu_delete')}><Trash /><span class="max-sm:sr-only">{t('wg.menu_delete')}</span></Button>
				<Button variant="ghost" size="sm" class="px-2" onclick={() => (selected = [])} aria-label={t('wg.selection_clear')}><X /></Button>
			</div>
		{/if}
		<details class="relative shrink-0 text-[13px]" data-testid="grid-help">
			<summary class="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"><Keyboard class="size-4" /><span class="max-sm:sr-only">{t('wg.help_title')}</span></summary>
			<ul class="absolute top-full right-0 z-40 mt-1 grid w-[min(34rem,calc(100vw-2rem))] max-sm:fixed max-sm:inset-x-4 max-sm:top-auto max-sm:bottom-24 max-sm:w-auto gap-x-6 gap-y-1 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg sm:grid-cols-2">
				{#each multi ? ['paint', 'move', 'resize', 'split', 'copy', 'select', 'snap', 'menu', 'keys', 'undo', 'touch'] : ['paint', 'move', 'resize', 'copy', 'select', 'snap_single', 'menu', 'keys', 'undo', 'touch'] as key (key)}
					<li>{t(`wg.help.${key}` as 'wg.help.paint')}</li>
				{/each}
			</ul>
		</details>
	</div>

	<WeekGrid
		{days}
		{drafts}
		{multi}
		{visible}
		{tool}
		{brush}
		bind:selected
		bind:activeDate
		{places}
		{actuals}
		{showActuals}
		issues={issueMap}
		{today}
		{nowMinute}
		{suggestion}
		{holidayNames}
		{holidayTreatments}
		{vacation}
		onpaint={paint}
		onquick={quick}
		onmove={move}
		onresize={resize}
		onerase={erase}
		onedit={openEdit}
		oneditday={openEditDay}
		onsplit={(id) => split(id)}
		onadd={(date) => openAdd(date)}
		{menu}
		onswipe={swipe}
	/>

	{#if issues.length > 0}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard reachable) -->
		<section tabindex="0" class="rounded-lg border bg-card p-3 fit:max-h-24 fit:shrink-0 fit:overflow-y-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={t('wg.issues')} data-testid="plan-issues">
			<h3 class="mb-1.5 text-[13px] font-semibold">{t('wg.issues')}</h3>
			<ul class="flex flex-col gap-1">
				{#each issues as issue, n (n)}
					<li class="flex items-start gap-2 text-[13px] {issue.severity === 'warn' ? '' : 'text-muted-foreground'}" data-kind={issue.kind}>
						<TriangleAlert class="mt-0.5 size-3.5 shrink-0 {issue.severity === 'warn' ? 'text-amber-600' : 'text-muted-foreground'}" />{issueText(issue)}
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-xs text-muted-foreground">{t('work_model.legal_disclaimer')}</p>
		</section>
	{/if}

	{#if planHints.length > 0}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard reachable) -->
		<section tabindex="0" class="rounded-lg border bg-card p-3 fit:max-h-24 fit:shrink-0 fit:overflow-y-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={t('wg.plan_hints')} data-testid="plan-hints">
			<h3 class="mb-1.5 text-[13px] font-semibold">{t('wg.plan_hints')}</h3>
			<ul class="flex flex-col gap-1">
				{#each planHints as item, n (n)}
					<li class="flex items-start gap-2 text-[13px]" data-hint={item.hint} data-date={item.date}>
						<Lightbulb class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{hintText(item)}
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-xs text-muted-foreground">{t('wg.plan_hints_note')}</p>
		</section>
	{/if}

</div>

{#if dialog}
	<BlockDialog {days} {drafts} {multi} seed={dialog.seed} editId={dialog.id} dayOnly={dialog.dayOnly} {places} anchor={dialog.anchor} returnFocus={dialog.returnFocus} onsubmit={submitDialog} ondelete={deleteFromDialog} onclose={() => (dialog = null)} />
{/if}
{#if copyDialog}
	<CopyDaysDialog
		{days}
		sourceDate={copyDialog.sourceDate}
		anchor={copyDialog.anchor}
		returnFocus={copyDialog.returnFocus}
		onsubmit={(dates) => {
			const source = copyDialog!.sourceDate;
			copyDialog = null;
			const result = copyToDates(drafts, ctx, source, dates);
			if (apply(t('wg.did_copy_days', { count: dates.length }), result)) selected = [];
		}}
		onclose={() => (copyDialog = null)}
	/>
{/if}
