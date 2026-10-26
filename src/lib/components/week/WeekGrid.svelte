<script lang="ts">
	import './planner-colors.css';
	import { contextMenu, contextmenu, type MenuEntry } from '#lib/a11y/context-menu.svelte.js';
	import type { AbsenceStatus, Place, PlanMode, PlanWeekDay, SegmentKind } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import { holidayHint } from '#lib/planning/company-days.js';
	import { exceedsThreshold } from '#lib/planning/drag.js';
	import { planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import {
		blockRect,
		boxBetween,
		boxesIntersect,
		clock,
		columnAt,
		type GridMetrics,
		type MinuteRange,
		minutesToY,
		moveRange,
		nudgeStep,
		paintRange,
		resizeRange,
		snap,
		stepFor,
		visibleHours,
		yToMinutes
	} from '#lib/week/grid.js';
	import { type Brush, moveBlocks, rangeOf } from '#lib/week/grid-edit.js';
	import type { DayIssue } from '#lib/week/limits.js';
	import { type DayDraft, plannedSecondsOf, type WindowSuggestion } from '#lib/week/plan-draft.js';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import Plus from '@lucide/svelte/icons/plus';
	import { onMount, tick } from 'svelte';
	import { MARK_CLASSES } from '#lib/week/overview.js';

	export interface Actual {
		start: number;
		end: number;
		kind: SegmentKind;
		running: boolean;
	}
	export type GridTool = 'select' | 'draw' | 'erase';

	/**
	 * Time grid of one week (P11). Pure view and pointer layer: every change leaves through a callback and the page
	 * applies it to the drafts (with undo). One block per day, because the server stores one plan per day.
	 */
	let {
		days,
		drafts,
		visible,
		tool,
		brush,
		selected = $bindable([]),
		activeDate = $bindable(null),
		places,
		actuals,
		showActuals,
		issues,
		today,
		nowMinute,
		suggestion,
		holidayNames,
		holidayTreatments,
		vacation = {},
		onpaint,
		onquick,
		onmove,
		onresize,
		onerase,
		onedit,
		onadd,
		menu,
		onswipe
	}: {
		days: PlanWeekDay[];
		drafts: DayDraft[];
		/** Week indexes (0 = Monday) of the shown columns; one on phones. */
		visible: number[];
		tool: GridTool;
		brush: Brush;
		selected?: string[];
		activeDate?: string | null;
		places: Place[];
		actuals: Record<string, Actual[]>;
		showActuals: boolean;
		issues: Map<string, DayIssue[]>;
		today: string;
		nowMinute: number | null;
		suggestion: WindowSuggestion;
		holidayNames: Record<string, string>;
		/** half/full for company days (contract 0.32.0); a half day is not blocked, so it gets its own variant of the holiday chip */
		holidayTreatments: Record<string, 'half' | 'full'>;
		/** vacation status per date (planned/requested/approved/taken) */
		vacation?: Record<string, AbsenceStatus>;
		onpaint: (dates: string[], range: MinuteRange) => void;
		onquick: (date: string, minute: number) => void;
		onmove: (sources: string[], deltaDays: number, deltaMinutes: number, copy: boolean) => boolean;
		onresize: (date: string, range: MinuteRange) => void;
		onerase: (dates: string[]) => void;
		onedit: (date: string) => void;
		onadd: (date: string) => void;
		menu: (context: { date: string | null; minute: number; onBlock: boolean }) => MenuEntry[];
		onswipe: (direction: -1 | 1) => void;
	} = $props();

	// ---- metrics -------------------------------------------------------------------------------------------
	let coarse = $state(false);
	onMount(() => {
		const query = window.matchMedia('(pointer: coarse)');
		coarse = query.matches;
		const listener = () => (coarse = query.matches);
		query.addEventListener('change', listener);
		return () => query.removeEventListener('change', listener);
	});

	const allRanges = $derived.by(() => {
		const list: MinuteRange[] = [];
		drafts.forEach((draft, i) => {
			const range = days[i]?.blockedBy === null ? rangeOf(draft) : null;
			if (range) list.push(range);
		});
		if (showActuals) for (const items of Object.values(actuals)) for (const a of items) list.push({ start: a.start, end: a.end });
		return list;
	});
	const hours = $derived(visibleHours(allRanges));
	const metrics = $derived<GridMetrics>({ ...hours, hourHeight: coarse ? 56 : 48 });
	const height = $derived((metrics.endHour - metrics.startHour) * metrics.hourHeight);
	const hourMarks = $derived(Array.from({ length: metrics.endHour - metrics.startHour }, (_, i) => metrics.startHour + i));

	// ---- element refs --------------------------------------------------------------------------------------
	let scroller = $state<HTMLElement | null>(null);
	let colsEl = $state<HTMLElement | null>(null);

	// Start the viewport around the first block (or 07:00) when a week is shown.
	let scrolledFor = '';
	$effect(() => {
		const key = days[0]?.date;
		if (!scroller || !key || key === scrolledFor) return;
		scrolledFor = key;
		const first = allRanges.length ? Math.min(...allRanges.map((r) => r.start)) : 7 * 60;
		scroller.scrollTop = Math.max(0, minutesToY(Math.min(first, 8 * 60) - 60, metrics));
	});

	// ---- data per column -----------------------------------------------------------------------------------
	const placeName = (id: string | null) => places.find((p) => p.id === id)?.name ?? '';
	const dateAt = (col: number) => days[visible[Math.min(Math.max(col, 0), visible.length - 1)]].date;
	const indexOfDate = (date: string) => days.findIndex((d) => d.date === date);
	const netSeconds = (draft: DayDraft) => plannedSecondsOf(draft) ?? 0;

	// ---- interaction state ---------------------------------------------------------------------------------
	type Drag =
		| { kind: 'paint'; colA: number; colB: number; minA: number; minB: number }
		| { kind: 'move'; sources: string[]; grabDate: string; grabCol: number; grabMin: number; col: number; min: number }
		| { kind: 'resize'; date: string; edge: 'start' | 'end'; origin: MinuteRange; min: number }
		| { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: string[] }
		| { kind: 'erase'; dates: string[] };

	let drag = $state<Drag | null>(null);
	let mods = $state({ shift: false, free: false, alt: false });
	let swallowNextClick = false;
	const step = $derived(stepFor({ shift: mods.shift, free: mods.free }));

	interface Press {
		id: number;
		x: number;
		y: number;
		touch: boolean;
		part: 'empty' | 'block' | 'handle';
		date: string;
		col: number;
		minute: number;
		edge?: 'start' | 'end';
		additive: boolean;
		timer?: ReturnType<typeof setTimeout>;
		armed: boolean;
		moved: boolean;
		wasSelected: boolean;
	}
	let press: Press | null = null;
	let lastPoint = { x: 0, y: 0 };

	function locate(clientX: number, clientY: number) {
		const rect = colsEl!.getBoundingClientRect();
		const col = columnAt(clientX, rect.left, rect.width, visible.length);
		return { col, date: dateAt(col), minute: yToMinutes(clientY - rect.top, metrics), x: clientX - rect.left, y: clientY - rect.top };
	}

	const updateMods = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => (mods = { shift: e.shiftKey, free: e.ctrlKey || e.metaKey, alt: e.altKey });

	function clearPress() {
		if (press?.timer) clearTimeout(press.timer);
		press = null;
	}

	function pointerdown(e: PointerEvent) {
		lastPoint = { x: e.clientX, y: e.clientY };
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const target = e.target as Element;
		if (target.closest('[data-nodrag]')) return;
		updateMods(e);
		const pos = locate(e.clientX, e.clientY);
		const handle = target.closest<HTMLElement>('[data-handle]');
		const block = target.closest<HTMLElement>('[data-block]');
		const touch = e.pointerType === 'touch';
		const part: Press['part'] = handle ? 'handle' : block ? 'block' : 'empty';
		const date = block?.dataset.date ?? pos.date;
		press = {
			id: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			touch,
			part,
			date,
			col: pos.col,
			minute: pos.minute,
			edge: handle ? (handle.dataset.handle as 'start' | 'end') : undefined,
			additive: e.shiftKey || e.ctrlKey || e.metaKey,
			armed: !touch,
			moved: false,
			wasSelected: selected.includes(date)
		};
		activeDate = date;
		colsEl!.setPointerCapture(e.pointerId);
		if (tool === 'erase') {
			// The eraser acts at once and keeps erasing what the pointer passes over.
			const hit = block ? [date] : [];
			drag = { kind: 'erase', dates: hit };
			press.armed = true;
			press.moved = true;
			return;
		}
		if (touch && part !== 'handle') {
			// Touch scrolls the page by default; a long press arms the gesture (paint on empty, move on a block).
			press.timer = setTimeout(() => {
				if (!press) return;
				press.armed = true;
				navigator.vibrate?.(8);
				beginDrag(press, { x: press.x, y: press.y });
			}, 350);
		} else if (touch && part === 'handle') {
			press.armed = true;
		}
	}

	function beginDrag(p: Press, at: { x: number; y: number }) {
		const pos = locate(at.x, at.y);
		if (p.part === 'handle') {
			const index = indexOfDate(p.date);
			const origin = rangeOf(drafts[index]);
			if (!origin) return;
			drag = { kind: 'resize', date: p.date, edge: p.edge!, origin, min: pos.minute };
			selected = [p.date];
		} else if (p.part === 'block') {
			if (!selected.includes(p.date)) selected = p.additive ? [...selected, p.date] : [p.date];
			drag = { kind: 'move', sources: [...selected], grabDate: p.date, grabCol: p.col, grabMin: p.minute, col: pos.col, min: pos.minute };
		} else if (tool === 'select' || mods.alt) {
			const origin = locate(p.x, p.y);
			drag = { kind: 'marquee', x0: origin.x, y0: origin.y, x1: pos.x, y1: pos.y, base: p.additive ? [...selected] : [] };
		} else {
			drag = { kind: 'paint', colA: p.col, colB: pos.col, minA: p.minute, minB: pos.minute };
		}
	}

	function autoScroll(clientY: number) {
		if (!scroller) return;
		const rect = scroller.getBoundingClientRect();
		const edge = 56;
		if (clientY < rect.top + edge) scroller.scrollTop -= Math.min(18, (rect.top + edge - clientY) / 2 + 4);
		else if (clientY > rect.bottom - edge) scroller.scrollTop += Math.min(18, (clientY - (rect.bottom - edge)) / 2 + 4);
	}

	function pointermove(e: PointerEvent) {
		lastPoint = { x: e.clientX, y: e.clientY };
		if (!press || e.pointerId !== press.id) return;
		updateMods(e);
		const dx = e.clientX - press.x;
		const dy = e.clientY - press.y;
		if (!drag) {
			if (!exceedsThreshold(dx, dy)) return;
			if (press.touch && !press.armed) {
				// Not armed yet: the finger is scrolling or swiping. A clear horizontal swipe changes the day on phones.
				if (press.timer) clearTimeout(press.timer);
				if (Math.abs(dy) > Math.abs(dx)) clearPress();
				else if (Math.abs(dx) > 56 && visible.length === 1) {
					clearPress();
					onswipe(dx < 0 ? 1 : -1);
				}
				return;
			}
			press.moved = true;
			beginDrag(press, { x: press.x, y: press.y });
		}
		const pos = locate(e.clientX, e.clientY);
		autoScroll(e.clientY);
		if (!drag) return;
		switch (drag.kind) {
			case 'paint':
				drag = { ...drag, colB: pos.col, minB: pos.minute };
				break;
			case 'move':
				drag = { ...drag, col: pos.col, min: pos.minute };
				break;
			case 'resize':
				drag = { ...drag, min: pos.minute };
				break;
			case 'marquee': {
				const next = { ...drag, x1: pos.x, y1: pos.y };
				drag = next;
				selected = marqueeSelection(next);
				break;
			}
			case 'erase': {
				const block = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-block]');
				if (block?.dataset.date && !drag.dates.includes(block.dataset.date)) drag = { ...drag, dates: [...drag.dates, block.dataset.date] };
				break;
			}
		}
		press.moved = true;
	}

	function marqueeSelection(m: Extract<Drag, { kind: 'marquee' }>): string[] {
		const rect = colsEl!.getBoundingClientRect();
		const box = boxBetween(m.x0, m.y0, m.x1, m.y1);
		const hit = [...colsEl!.querySelectorAll<HTMLElement>('[data-block]:not([data-ghost])')]
			.filter((el) => {
				const r = el.getBoundingClientRect();
				return boxesIntersect(box, { left: r.left - rect.left, top: r.top - rect.top, right: r.right - rect.left, bottom: r.bottom - rect.top });
			})
			.map((el) => el.dataset.date!);
		return [...new Set([...m.base, ...hit])];
	}

	// What the current gesture would commit; also used for the live ghost.
	const moveDelta = $derived.by(() => {
		if (drag?.kind !== 'move') return null;
		const deltaDays = visible.length > 1 ? visible[drag.col] - visible[drag.grabCol] : 0;
		const grabIndex = indexOfDate(drag.grabDate);
		const origin = rangeOf(drafts[grabIndex]);
		const deltaMinutes = origin ? snap(origin.start + (drag.min - drag.grabMin), step) - origin.start : 0;
		return { deltaDays, deltaMinutes };
	});

	interface Ghost {
		date: string;
		range: MinuteRange;
		mode: PlanMode;
		status: 'ok' | 'replace' | 'invalid';
	}
	const preview = $derived.by((): { ghosts: Ghost[]; hidden: string[]; edges: number[]; column?: string } | null => {
		if (!drag) return null;
		switch (drag.kind) {
			case 'paint': {
				const range = paintRange(snap(drag.minA, step), snap(drag.minB, step), step);
				const lo = Math.min(drag.colA, drag.colB);
				const hi = Math.max(drag.colA, drag.colB);
				const ghosts = visible.slice(lo, hi + 1).map<Ghost>((i) => ({
					date: days[i].date,
					range,
					mode: brush.mode === 'off' ? 'office' : brush.mode,
					status: days[i].blockedBy !== null ? 'invalid' : drafts[i].mode !== '' ? 'replace' : 'ok'
				}));
				return { ghosts, hidden: [], edges: [range.start, range.end] };
			}
			case 'move': {
				const delta = moveDelta!;
				const { sources, grabDate } = drag;
				const result = moveBlocks(drafts, days, sources, delta.deltaDays, delta.deltaMinutes, mods.alt);
				const ghosts: Ghost[] = [];
				for (const date of sources) {
					const index = indexOfDate(date);
					const range = rangeOf(drafts[index]);
					if (!range) continue;
					const targetIndex = index + delta.deltaDays;
					if (targetIndex < 0 || targetIndex > 6) continue;
					const moved = moveRange(range, delta.deltaMinutes, 1);
					ghosts.push({ date: days[targetIndex].date, range: moved, mode: drafts[index].mode as PlanMode, status: !result.ok ? 'invalid' : result.replaced.includes(days[targetIndex].date) ? 'replace' : 'ok' });
				}
				const primary = ghosts.find((g) => g.date === days[indexOfDate(grabDate) + delta.deltaDays]?.date);
				return { ghosts, hidden: mods.alt ? [] : sources, edges: primary ? [primary.range.start, primary.range.end] : [], column: primary?.date };
			}
			case 'resize': {
				const range = resizeRange(drag.origin, drag.edge, drag.min, step);
				return { ghosts: [], hidden: [], edges: [drag.edge === 'start' ? range.start : range.end], column: drag.date };
			}
			default:
				return null;
		}
	});
	const resizeOverride = $derived(drag?.kind === 'resize' ? { date: drag.date, range: resizeRange(drag.origin, drag.edge, drag.min, step) } : null);

	function pointerup(e: PointerEvent) {
		if (!press || e.pointerId !== press.id) return;
		const p = press;
		clearPress();
		const finished = drag;
		drag = null;
		try {
			colsEl?.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
		const menuOpen = contextMenu.current !== null;
		if (finished) swallowNextClick = true;
		if (finished?.kind === 'paint') {
			const range = paintRange(snap(finished.minA, step), snap(finished.minB, step), step);
			const lo = Math.min(finished.colA, finished.colB);
			const hi = Math.max(finished.colA, finished.colB);
			onpaint(visible.slice(lo, hi + 1).map((i) => days[i].date), range);
		} else if (finished?.kind === 'move') {
			const deltaDays = visible.length > 1 ? visible[finished.col] - visible[finished.grabCol] : 0;
			const origin = rangeOf(drafts[indexOfDate(finished.grabDate)]);
			const deltaMinutes = origin ? snap(origin.start + (finished.min - finished.grabMin), step) - origin.start : 0;
			if (deltaDays !== 0 || deltaMinutes !== 0 || mods.alt) onmove(finished.sources, deltaDays, deltaMinutes, mods.alt);
		} else if (finished?.kind === 'resize') {
			const range = resizeRange(finished.origin, finished.edge, finished.min, step);
			if (range.start !== finished.origin.start || range.end !== finished.origin.end) onresize(finished.date, range);
		} else if (finished?.kind === 'erase') {
			if (finished.dates.length) onerase(finished.dates);
		} else if (!p.moved && !menuOpen) {
			click(p, e);
		}
		mods = { shift: false, free: false, alt: false };
	}

	/** A press without a drag: select, deselect, or quick-paint after a touch long press. */
	function click(p: Press, e: PointerEvent) {
		if (p.part === 'empty') {
			if (p.touch && p.armed) onquick(p.date, snap(p.minute, 15));
			else selected = [];
			return;
		}
		if (p.part === 'handle') return;
		if (p.additive || (e.shiftKey || e.ctrlKey || e.metaKey)) selected = selected.includes(p.date) ? selected.filter((d) => d !== p.date) : [...selected, p.date];
		else selected = [p.date];
	}

	function pointercancel() {
		clearPress();
		drag = null;
	}

	function dblclick(e: MouseEvent) {
		// Pointer capture retargets the click events to the grid, so look at what is under the pointer.
		const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
		if (target.closest('[data-nodrag]')) return;
		const block = target.closest<HTMLElement>('[data-block]');
		if (block?.dataset.date) {
			onedit(block.dataset.date);
			return;
		}
		if (tool === 'draw') {
			const pos = locate(e.clientX, e.clientY);
			onquick(pos.date, snap(pos.minute, 15));
		}
	}

	// Scrolling must not start once a gesture is armed (touch).
	function touchmove(e: TouchEvent) {
		if (drag) e.preventDefault();
	}
	$effect(() => {
		const el = colsEl;
		if (!el) return;
		el.addEventListener('touchmove', touchmove, { passive: false });
		return () => el.removeEventListener('touchmove', touchmove);
	});

	// Esc cancels a gesture; modifier keys change the snap and copy mode live.
	$effect(() => {
		const key = (e: KeyboardEvent) => {
			if (drag && e.type === 'keydown' && e.key === 'Escape') {
				e.stopPropagation();
				clearPress();
				drag = null;
				return;
			}
			if (drag) updateMods(e);
		};
		window.addEventListener('keydown', key, true);
		window.addEventListener('keyup', key, true);
		return () => {
			window.removeEventListener('keydown', key, true);
			window.removeEventListener('keyup', key, true);
		};
	});

	// ---- keyboard on blocks --------------------------------------------------------------------------------
	async function keydown(e: KeyboardEvent) {
		const block = (e.target as Element).closest<HTMLElement>('[data-block]');
		if (!block?.dataset.date || e.defaultPrevented) return;
		const date = block.dataset.date;
		const index = indexOfDate(date);
		const range = rangeOf(drafts[index]);
		const sources = selected.includes(date) ? [...selected] : [date];
		const small = nudgeStep({ shift: e.shiftKey });
		const refocus = async (target: string) => {
			await tick();
			colsEl?.querySelector<HTMLElement>(`[data-block][data-date="${target}"]:not([data-ghost])`)?.focus();
		};
		switch (e.key) {
			case 'ArrowUp':
			case 'ArrowDown': {
				if (!range) return;
				const delta = (e.key === 'ArrowUp' ? -1 : 1) * small;
				e.preventDefault();
				if (e.altKey) onresize(date, resizeRange(range, 'end', range.end + delta, 1));
				else if (e.ctrlKey || e.metaKey) onresize(date, resizeRange(range, 'start', range.start + delta, 1));
				else onmove(sources, 0, delta, false);
				break;
			}
			case 'ArrowLeft':
			case 'ArrowRight': {
				if (e.ctrlKey || e.metaKey) return;
				e.preventDefault();
				const dir = e.key === 'ArrowLeft' ? -1 : 1;
				const target = days[index + dir];
				if (!target) return;
				if (onmove(sources, dir, 0, e.altKey)) {
					if (!e.altKey) selected = sources.map((s) => days[indexOfDate(s) + dir].date);
					void refocus(target.date);
				}
				break;
			}
			case 'Delete':
			case 'Backspace':
				e.preventDefault();
				onerase(sources);
				break;
			case 'Enter':
			case 'F2':
				e.preventDefault();
				onedit(date);
				break;
			case ' ':
				e.preventDefault();
				selected = e.ctrlKey || e.metaKey || e.shiftKey ? (selected.includes(date) ? selected.filter((d) => d !== date) : [...selected, date]) : [date];
				break;
		}
	}

	// ---- context menu --------------------------------------------------------------------------------------
	function menuItems(target: Element): MenuEntry[] {
		const block = target.closest<HTMLElement>('[data-block]');
		const pos = locate(lastPoint.x, lastPoint.y);
		const date = block?.dataset.date ?? pos.date;
		if (block) {
			if (!selected.includes(date)) selected = [date];
			activeDate = date;
			return menu({ date, minute: pos.minute, onBlock: true });
		}
		if (target.closest('[data-nodrag]')) return [];
		activeDate = date;
		return menu({ date, minute: pos.minute, onBlock: false });
	}

	// ---- presentation helpers ------------------------------------------------------------------------------
	const dayPlanned = (i: number) => (days[i].blockedBy !== null ? 0 : netSeconds(drafts[i]));
	const dayDiff = (i: number) => dayPlanned(i) - days[i].targetSeconds;
	const sollBand = (i: number) => {
		const day = days[i];
		if (day.blockedBy !== null || day.targetSeconds === 0) return null;
		const start = suggestion.start;
		const [h, m] = start.split(':').map(Number);
		const from = h * 60 + m;
		return blockRect({ start: from, end: from + Math.round(day.targetSeconds / 60) + suggestion.breakMinutes }, metrics);
	};
	const actualColor: Record<SegmentKind, string> = { work: 'var(--ui-accent)', travel: '#d97706', school: '#4f46e5' };
	const blockLabel = (i: number, range: MinuteRange) => {
		const draft = drafts[i];
		const place = placeName(draft.placeId);
		const parts = [
			planModeLabel(draft.mode as PlanMode),
			`${weekdayLabel(days[i].weekday)} ${formatDateNumeric(days[i].date)}`,
			t('wg.block_time', { start: clock(range.start), end: clock(range.end) }),
			t('wg.block_net', { time: timeDisplay.duration(netSeconds(draft)) })
		];
		if (draft.breakMinutes > 0) parts.push(t('wg.block_break', { minutes: draft.breakMinutes }));
		if (place) parts.push(place);
		const hint = issues.get(draft.date);
		if (hint?.some((x) => x.severity === 'warn')) parts.push(t('wg.block_has_hint'));
		return parts.join(', ');
	};
	const markClass = (block: NonNullable<PlanWeekDay['blockedBy']>) => MARK_CLASSES[block];
	const timeBubbles = $derived(preview?.edges ?? []);
	const ghostSummary = (g: Ghost) => `${clock(g.range.start)}–${clock(g.range.end)}`;
	const marquee = $derived(drag?.kind === 'marquee' ? boxBetween(drag.x0, drag.y0, drag.x1, drag.y1) : null);
	const eraseSet = $derived(drag?.kind === 'erase' ? drag.dates : []);
	const compactAt = 40;
	const blocksOf = (i: number) => {
		const draft = drafts[i];
		if (days[i].blockedBy !== null) return null;
		const range = rangeOf(draft);
		if (!range) return null;
		return resizeOverride?.date === draft.date ? resizeOverride.range : range;
	};
</script>

<div class="wg" class:wg-dragging={drag !== null} data-testid="week-grid" data-tool={tool} data-start-hour={metrics.startHour} data-hour-height={metrics.hourHeight} role="group" aria-label={t('wg.label')} aria-describedby="wg-help">
	<p id="wg-help" class="sr-only">{t('wg.help')}</p>
	<div class="wg-scroll" bind:this={scroller} data-testid="week-grid-scroll" style="--hh: {metrics.hourHeight}px; --cols: {visible.length}">
		<div class="wg-head">
			<div class="wg-corner" aria-hidden="true"></div>
			{#each visible as i (days[i].date)}
				{@const day = days[i]}
				{@const planned = dayPlanned(i)}
				{@const diff = dayDiff(i)}
				<div class="wg-dayhead" data-today={day.date === today} data-testid="dayhead-{day.date}">
					<div class="wg-dayline">
						<span class="wg-wd">{weekdayLabel(day.weekday)}</span>
						<span class="wg-dn" aria-label={formatDateNumeric(day.date)}>{Number(day.date.slice(8))}</span>
						<button type="button" class="wg-add" data-nodrag onclick={() => onadd(day.date)} aria-label={t('wg.add_day', { day: weekdayLabel(day.weekday) })} data-testid="add-{day.date}" disabled={day.blockedBy !== null}><Plus class="size-3.5" /></button>
					</div>
					<div class="wg-sum" aria-label={t('wg.day_sum', { plan: timeDisplay.duration(planned), target: timeDisplay.duration(day.targetSeconds) })}>
						<span class="wg-plan" data-testid="day-plan-{day.date}">{planned > 0 ? timeDisplay.duration(planned) : '–'}</span>
						<span class="wg-target" data-testid="day-target-{day.date}">{t('wg.of_target', { time: timeDisplay.duration(day.targetSeconds) })}</span>
						{#if planned > 0 || (day.targetSeconds > 0 && day.blockedBy === null)}
							<span class="wg-diff" data-sign={diff === 0 ? 'zero' : diff < 0 ? 'under' : 'over'} data-testid="day-diff-{day.date}">{diff === 0 ? '±0' : timeDisplay.delta(diff)}</span>
						{/if}
					</div>
				</div>
			{/each}
			<div class="wg-corner" aria-hidden="true"></div>
			{#each visible as i (days[i].date)}
				{@const day = days[i]}
				{@const draft = drafts[i]}
				<div class="wg-allday" data-testid="allday-{day.date}">
					{#if day.blockedBy}
						<span class="wg-chip {markClass(day.blockedBy)}" title={holidayNames[day.date] ? holidayHint(holidayNames[day.date], holidayTreatments[day.date]) : ''} data-testid="blocked-chip-{day.date}">{day.blockedBy === 'holiday' && holidayNames[day.date] ? holidayNames[day.date] : t(`weekview.mark.${day.blockedBy}`)}{#if day.blockedBy === 'vacation' && vacation[day.date]} ({t(`absence.status.${vacation[day.date]}`)}){/if}</span>
					{:else if vacation[day.date]}
						<span class="wg-chip {markClass('vacation')} wg-chip-open" data-testid="vacation-chip-{day.date}" data-status={vacation[day.date]}>{t('weekview.mark.vacation')} ({t(`absence.status.${vacation[day.date]}`)})</span>
					{:else if holidayNames[day.date]}
						<span class="wg-chip {markClass('holiday')} {holidayTreatments[day.date] === 'half' ? 'wg-chip-half' : ''}" title={holidayHint(holidayNames[day.date], holidayTreatments[day.date])} data-treatment={holidayTreatments[day.date]} data-testid="holiday-chip-{day.date}">{holidayNames[day.date]}{#if holidayTreatments[day.date] === 'half'}<span aria-hidden="true"> ½</span><span class="sr-only">, {holidayHint(holidayNames[day.date], 'half')}</span>{/if}</span>
					{:else if draft.mode !== '' && !rangeOf(draft)}
						<button type="button" class="wg-chip wg-chip-plan" data-nodrag data-plan-mode={draft.mode} onclick={() => onedit(day.date)} data-testid="chip-{day.date}">
							<span class="wg-dot"></span>{planModeLabel(draft.mode as PlanMode)}{draft.mode === 'off' ? '' : ` · ${t('wg.no_times')}`}
						</button>
					{/if}
				</div>
			{/each}
		</div>

		<div class="wg-body" style="height: {height}px">
			<div class="wg-times" aria-hidden="true">
				{#each hourMarks as hour (hour)}
					<span class="wg-hour" style="top: {(hour - metrics.startHour) * metrics.hourHeight}px">{hour > metrics.startHour ? `${String(hour).padStart(2, '0')}:00` : ''}</span>
				{/each}
				{#each timeBubbles as minute (minute)}
					<span class="wg-bubble" style="top: {minutesToY(minute, metrics)}px">{clock(minute)}</span>
				{/each}
			</div>

			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="wg-cols"
				bind:this={colsEl}
				role="presentation"
				onpointerdown={pointerdown}
				onpointermove={pointermove}
				onpointerup={pointerup}
				onpointercancel={pointercancel}
				ondblclick={dblclick}
				onkeydown={keydown}
				onclickcapture={(e) => {
					if (swallowNextClick) {
						swallowNextClick = false;
						e.stopPropagation();
					}
				}}
				use:contextmenu={menuItems}
				style="--cols: {visible.length}"
				data-testid="week-grid-cols"
			>
				{#each visible as i, col (days[i].date)}
					{@const day = days[i]}
					{@const band = sollBand(i)}
					{@const range = blocksOf(i)}
					<div class="wg-col" data-date={day.date} data-today={day.date === today} data-blocked={day.blockedBy ?? undefined} data-vacation={!day.blockedBy && vacation[day.date] ? vacation[day.date] : undefined} data-off={day.targetSeconds === 0 && day.blockedBy === null ? '' : undefined} data-testid="col-{day.date}">
						{#if band}<div class="wg-soll" style="top: {band.top}px; height: {band.height}px" aria-hidden="true"></div>{/if}

						{#if showActuals}
							{#each actuals[day.date] ?? [] as actual, n (n)}
								{@const r = blockRect(actual, metrics)}
								<div class="wg-actual" data-kind={actual.kind} data-running={actual.running} style="top: {r.top}px; height: {Math.max(r.height, 3)}px; --ac: {actualColor[actual.kind]}" aria-hidden="true" data-testid="actual-{day.date}"></div>
							{/each}
						{/if}

						{#if range}
							{@const draft = drafts[i]}
							{@const rect = blockRect(range, metrics)}
							{@const hint = issues.get(day.date)?.some((x) => x.severity === 'warn') ?? false}
							<div
								class="wg-block"
								role="button"
								tabindex="0"
								data-block
								data-date={day.date}
								data-plan-mode={draft.mode}
								data-selected={selected.includes(day.date)}
								data-moving={preview?.hidden.includes(day.date) || eraseSet.includes(day.date) || undefined}
								data-compact={rect.height < compactAt}
								data-testid="block-{day.date}"
								aria-label={blockLabel(i, range)}
								aria-pressed={selected.includes(day.date)}
								style="top: {rect.top}px; height: {rect.height}px"
							>
								<span class="wg-handle wg-handle-start" data-handle="start" data-testid="handle-start-{day.date}" aria-hidden="true"><i></i></span>
								<div class="wg-body-text">
									<p class="wg-title"><span class="wg-mode">{planModeLabel(draft.mode as PlanMode)}</span><span class="wg-net">{timeDisplay.duration(netSeconds(draft))}</span></p>
									<p class="wg-time" data-testid="block-time-{day.date}">{clock(range.start)}–{clock(range.end)}</p>
									{#if placeName(draft.placeId)}<p class="wg-meta">{placeName(draft.placeId)}</p>{/if}
									{#if draft.breakMinutes > 0}<p class="wg-meta wg-break">{t('wg.break_chip', { minutes: draft.breakMinutes })}</p>{/if}
								</div>
								{#if hint}<span class="wg-warn" aria-hidden="true"><AlertTriangle class="size-3.5" /></span>{/if}
								<span class="wg-handle wg-handle-end" data-handle="end" data-testid="handle-end-{day.date}" aria-hidden="true"><i></i></span>
							</div>
						{/if}

						{#each preview?.ghosts.filter((g) => g.date === day.date) ?? [] as ghost (ghost.date + ghost.mode)}
							{@const gr = blockRect(ghost.range, metrics)}
							<div class="wg-block wg-ghost" data-block data-ghost data-plan-mode={ghost.mode} data-status={ghost.status} style="top: {gr.top}px; height: {gr.height}px" data-testid="ghost-{day.date}" aria-hidden="true">
								<div class="wg-body-text"><p class="wg-time">{ghostSummary(ghost)}</p>{#if ghost.status === 'replace'}<p class="wg-meta">{t('wg.ghost_replaces')}</p>{:else if ghost.status === 'invalid'}<p class="wg-meta">{t('wg.ghost_blocked')}</p>{/if}</div>
							</div>
						{/each}

						{#each preview?.edges ?? [] as minute (minute)}
							{#if preview?.column === undefined || preview.column === day.date || preview.ghosts.some((g) => g.date === day.date)}
								<div class="wg-guide" style="top: {minutesToY(minute, metrics)}px" aria-hidden="true"></div>
							{/if}
						{/each}

						{#if day.date === today && nowMinute !== null && nowMinute >= metrics.startHour * 60 && nowMinute <= metrics.endHour * 60}
							<div class="wg-now" style="top: {minutesToY(nowMinute, metrics)}px" data-testid="now-line" aria-hidden="true"></div>
						{/if}
					</div>
				{/each}
				{#if marquee}<div class="wg-marquee" style="left: {marquee.left}px; top: {marquee.top}px; width: {marquee.right - marquee.left}px; height: {marquee.bottom - marquee.top}px" aria-hidden="true"></div>{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.wg {
		--grid-line: color-mix(in srgb, var(--foreground) 11%, transparent);
		--grid-line-soft: color-mix(in srgb, var(--foreground) 5%, transparent);
		--gutter: 3.25rem;
		position: relative;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}
	.wg-scroll {
		position: relative;
		overflow: auto;
		height: clamp(440px, calc(100dvh - 19rem), 900px);
		overscroll-behavior: contain;
	}
	.wg-head {
		position: sticky;
		top: 0;
		z-index: 30;
		display: grid;
		grid-template-columns: var(--gutter) repeat(var(--cols), minmax(0, 1fr));
		background: color-mix(in srgb, var(--card) 92%, transparent);
		-webkit-backdrop-filter: var(--bf-header, none);
		backdrop-filter: var(--bf-header, none);
		border-bottom: 1px solid var(--border);
	}
	.wg-corner {
		grid-column: 1;
	}
	.wg-dayhead {
		min-width: 0;
		padding: 8px 8px 6px;
		border-left: 1px solid var(--grid-line-soft);
	}
	.wg-dayline {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.wg-wd {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.wg-dn {
		display: inline-grid;
		place-items: center;
		min-width: 26px;
		height: 26px;
		border-radius: 999px;
		font-size: 17px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.wg-dayhead[data-today='true'] .wg-dn {
		background: var(--ui-accent);
		color: var(--ui-accent-foreground);
	}
	.wg-dayhead[data-today='true'] .wg-wd {
		color: var(--ui-accent-ink);
	}
	.wg-add {
		margin-left: auto;
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 999px;
		color: var(--muted-foreground);
		opacity: 0;
		transition: opacity 120ms, background-color 120ms;
	}
	.wg-dayhead:hover .wg-add,
	.wg-add:focus-visible {
		opacity: 1;
	}
	.wg-add:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	.wg-add:disabled {
		display: none;
	}
	.wg-add:focus-visible {
		outline: 2px solid var(--ring);
	}
	@media (pointer: coarse) {
		.wg-add {
			opacity: 1;
			width: 32px;
			height: 32px;
		}
	}
	.wg-sum {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 6px;
		margin-top: 2px;
		font-variant-numeric: tabular-nums;
	}
	.wg-plan {
		font-size: 13px;
		font-weight: 600;
	}
	.wg-target {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.wg-diff {
		margin-left: auto;
		font-size: 11px;
		font-weight: 600;
		padding: 0 6px;
		border-radius: 999px;
		line-height: 17px;
	}
	.wg-diff[data-sign='zero'] {
		background: color-mix(in srgb, #059669 14%, transparent);
		color: #047857;
	}
	.wg-diff[data-sign='under'] {
		background: color-mix(in srgb, #d97706 16%, transparent);
		color: #b45309;
	}
	.wg-diff[data-sign='over'] {
		background: color-mix(in srgb, var(--ui-accent) 14%, transparent);
		color: var(--ui-accent-ink);
	}
	:global(.dark) .wg-diff[data-sign='zero'] {
		color: #6ee7b7;
	}
	:global(.dark) .wg-diff[data-sign='under'] {
		color: #fbbf24;
	}
	.wg-allday {
		min-width: 0;
		min-height: 28px;
		padding: 2px 5px 5px;
		border-left: 1px solid var(--grid-line-soft);
		display: flex;
		align-items: flex-start;
	}
	.wg-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 100%;
		height: 20px;
		padding: 0 8px;
		border-radius: 6px;
		font-size: 11.5px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wg-chip-half {
		border: 1px dashed currentColor;
	}
	.wg-chip-plan {
		background: color-mix(in srgb, var(--pm) 14%, var(--card));
		color: var(--foreground);
		cursor: pointer;
	}
	.wg-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--pm);
		flex: none;
	}

	.wg-body {
		position: relative;
		display: grid;
		grid-template-columns: var(--gutter) minmax(0, 1fr);
	}
	.wg-times {
		position: relative;
	}
	.wg-hour {
		position: absolute;
		right: 8px;
		transform: translateY(-50%);
		font-size: 11px;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.wg-bubble {
		position: absolute;
		right: 4px;
		transform: translateY(-50%);
		z-index: 25;
		padding: 1px 6px;
		border-radius: 6px;
		background: var(--ui-accent);
		color: var(--ui-accent-foreground);
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		box-shadow: 0 2px 8px #0003;
	}
	.wg-cols {
		position: relative;
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		touch-action: pan-y;
		cursor: crosshair;
	}
	.wg[data-tool='select'] .wg-cols {
		cursor: default;
	}
	.wg[data-tool='erase'] .wg-cols {
		cursor: not-allowed;
	}
	.wg-dragging .wg-cols {
		cursor: grabbing;
	}
	.wg-col {
		position: relative;
		border-left: 1px solid var(--grid-line-soft);
		background-image:
			linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px),
			linear-gradient(to bottom, var(--grid-line-soft) 1px, transparent 1px);
		background-size:
			100% var(--hh),
			100% calc(var(--hh) / 2);
	}
	.wg-col[data-today='true'] {
		background-color: color-mix(in srgb, var(--ui-accent) 4%, transparent);
	}
	.wg-col[data-off] {
		background-color: color-mix(in srgb, var(--muted) 55%, transparent);
	}
	.wg-col[data-blocked] {
		background-color: color-mix(in srgb, var(--muted) 40%, transparent);
		background-image:
			repeating-linear-gradient(135deg, color-mix(in srgb, var(--foreground) 6%, transparent) 0 6px, transparent 6px 14px),
			linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
		background-size:
			auto,
			100% var(--hh);
		cursor: not-allowed;
	}
	/* planned or requested vacation that does not block the day yet: lighter dashed hatching, still editable */
	.wg-col[data-vacation] {
		background-image: repeating-linear-gradient(135deg, color-mix(in srgb, #0ea5e9 14%, transparent) 0 6px, transparent 6px 14px);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #0ea5e9 35%, transparent);
	}
	.wg-chip-open {
		border: 1px dashed currentColor;
	}
	.wg-soll {
		position: absolute;
		left: 0;
		right: 0;
		pointer-events: none;
		background: color-mix(in srgb, var(--ui-accent) 6%, transparent);
		border-top: 1px dashed color-mix(in srgb, var(--ui-accent) 30%, transparent);
		border-bottom: 1px dashed color-mix(in srgb, var(--ui-accent) 30%, transparent);
	}
	.wg-actual {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 1;
		pointer-events: none;
		border: 1.5px dashed color-mix(in srgb, var(--ac) 70%, transparent);
		border-radius: 6px;
		background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--ac) 16%, transparent) 0 5px, color-mix(in srgb, var(--ac) 5%, transparent) 5px 10px);
	}
	.wg-actual::after {
		content: '';
		position: absolute;
		top: -1px;
		bottom: -1px;
		right: -1px;
		width: 5px;
		border-radius: 0 6px 6px 0;
		background: var(--ac);
	}

	.wg-block {
		position: absolute;
		left: 4px;
		right: 7px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--pm) 35%, transparent);
		border-left: 4px solid var(--pm);
		background: color-mix(in srgb, var(--pm) 16%, var(--card));
		color: var(--foreground);
		font-size: 12px;
		line-height: 1.25;
		box-shadow: 0 1px 2px #0000001a;
		cursor: grab;
		transition: box-shadow 140ms, transform 140ms, opacity 140ms, background-color 140ms;
		outline: none;
	}
	.wg-block:hover {
		background: color-mix(in srgb, var(--pm) 22%, var(--card));
		box-shadow: 0 3px 10px #0002;
	}
	.wg-block:focus-visible {
		box-shadow:
			0 0 0 2px var(--background),
			0 0 0 4px var(--ring);
	}
	.wg-block[data-selected='true'] {
		z-index: 8;
		border-color: var(--pm);
		background: color-mix(in srgb, var(--pm) 26%, var(--card));
		box-shadow:
			0 0 0 2px var(--background),
			0 0 0 4px var(--pm),
			0 6px 16px #0003;
	}
	.wg-block[data-moving] {
		opacity: 0.35;
		border-style: dashed;
	}
	.wg-ghost {
		z-index: 12;
		pointer-events: none;
		cursor: grabbing;
		background: color-mix(in srgb, var(--pm) 28%, var(--card));
		border: 2px dashed var(--pm);
		border-left-width: 4px;
		box-shadow: 0 8px 22px #0003;
	}
	.wg-ghost[data-status='replace'] {
		border-color: #d97706;
		background: repeating-linear-gradient(135deg, color-mix(in srgb, #d97706 24%, var(--card)) 0 6px, color-mix(in srgb, var(--pm) 20%, var(--card)) 6px 12px);
	}
	.wg-ghost[data-status='invalid'] {
		border-color: var(--destructive);
		background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--destructive) 26%, var(--card)) 0 6px, color-mix(in srgb, var(--destructive) 10%, var(--card)) 6px 12px);
	}
	.wg-body-text {
		min-width: 0;
		padding: 4px 7px 3px;
		flex: 1;
		overflow: hidden;
	}
	.wg-title {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px;
		font-weight: 650;
	}
	.wg-mode {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wg-net {
		font-weight: 500;
		font-size: 11px;
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
		font-variant-numeric: tabular-nums;
	}
	.wg-time {
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, var(--foreground) 80%, transparent);
	}
	.wg-meta {
		margin-top: 1px;
		font-size: 11px;
		color: color-mix(in srgb, var(--foreground) 62%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wg-block[data-compact='true'] .wg-body-text {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-block: 0;
	}
	.wg-block[data-compact='true'] .wg-title {
		flex: none;
	}
	.wg-block[data-compact='true'] .wg-net,
	.wg-block[data-compact='true'] .wg-meta {
		display: none;
	}
	.wg-warn {
		position: absolute;
		top: 4px;
		right: 5px;
		color: #d97706;
	}
	.wg-handle {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 2;
		height: 9px;
		cursor: ns-resize;
		display: grid;
		place-items: center;
	}
	.wg-handle-start {
		top: 0;
	}
	.wg-handle-end {
		bottom: 0;
	}
	.wg-handle i {
		width: 22px;
		height: 3px;
		border-radius: 3px;
		background: var(--pm);
		opacity: 0;
		transition: opacity 120ms;
	}
	.wg-block:hover .wg-handle i,
	.wg-block[data-selected='true'] .wg-handle i,
	.wg-block:focus-visible .wg-handle i {
		opacity: 0.85;
	}
	.wg-block[data-compact='true'] .wg-handle {
		height: 6px;
	}
	.wg-block[data-compact='true'] .wg-handle i {
		height: 2px;
		width: 16px;
	}
	@media (pointer: coarse) {
		.wg-handle {
			height: 24px;
			touch-action: none;
		}
		.wg-block[data-compact='true'] .wg-handle {
			height: 14px;
		}
		.wg-handle i {
			opacity: 0.7;
			width: 28px;
			height: 4px;
		}
	}
	.wg-guide {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 11;
		height: 0;
		border-top: 1.5px dashed var(--ui-accent);
		pointer-events: none;
	}
	.wg-now {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 15;
		height: 0;
		border-top: 2px solid #ef4444;
		pointer-events: none;
	}
	.wg-now::before {
		content: '';
		position: absolute;
		left: -5px;
		top: -6px;
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: #ef4444;
	}
	.wg-marquee {
		position: absolute;
		z-index: 20;
		pointer-events: none;
		border: 1px solid var(--ui-accent);
		border-radius: 4px;
		background: color-mix(in srgb, var(--ui-accent) 12%, transparent);
	}
	@media (prefers-reduced-motion: reduce) {
		.wg-block,
		.wg-add,
		.wg-handle i {
			transition: none;
		}
	}
</style>
