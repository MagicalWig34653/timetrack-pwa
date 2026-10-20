<script lang="ts">
	import { contextmenu, type MenuEntry } from '#lib/a11y/context-menu.svelte.js';
	import type { Absence } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import type { DayInfo, DayWorkState } from '#lib/planning/calendar.js';
	import type { ConflictSeverity } from '#lib/planning/conflicts.js';
	import { beginMove, beginResize, beginSelect, dragTo, exceedsThreshold, isNoop, previewRange, type DragOp } from '#lib/planning/drag.js';
	import { WORK_STATE_CLASSES } from '#lib/planning/labels.js';
	import { moveCursor, type CursorMove, type DateRange } from '#lib/planning/range-select.js';
	import { formatDateShort, isoWeekNumber } from '#lib/time/dates.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { tick } from 'svelte';
	import DayChips from './DayChips.svelte';

	/**
	 * Month/week grid (tablet and desktop) and week list (phone) with pointer drag (select, move, resize), roving keyboard
	 * cursor and per-day context menus. It holds no data: the page owns data, selection and writes and reacts to the
	 * callbacks. Drag state lives in `op` (bindable) so the page can show conflicts for the ghost.
	 */
	let {
		weeks,
		variant,
		today,
		monthOf,
		label,
		phoneWeek,
		infoOf,
		stateOf,
		describe,
		selected,
		cursor,
		ghost,
		hidden,
		rangeMode,
		absenceById,
		menuFor,
		op = $bindable(null),
		onpick,
		ondrag,
		onmove,
		onresize,
		oncursor,
		onquick
	}: {
		weeks: string[][];
		variant: 'month' | 'week';
		today: string;
		/** YYYY-MM of the shown month; days of other months are dimmed (month view only) */
		monthOf: string;
		label: string;
		phoneWeek: string[];
		infoOf: (date: string) => DayInfo;
		stateOf: (info: DayInfo) => DayWorkState;
		describe: (info: DayInfo) => string;
		selected: Set<string>;
		cursor: string;
		ghost: { dates: Set<string>; severity: Map<string, ConflictSeverity> } | null;
		hidden: Set<string>;
		rangeMode: boolean;
		absenceById: (id: string) => Absence | undefined;
		menuFor: (date: string, target: Element) => MenuEntry[] | null;
		op?: DragOp | null;
		onpick: (date: string, mods: { shift: boolean; meta: boolean }) => void;
		ondrag: (range: DateRange, additive: boolean) => void;
		onmove: (absence: Absence, range: DateRange) => void;
		onresize: (absence: Absence, range: DateRange) => void;
		oncursor: (date: string, extend: boolean) => void;
		onquick: (date: string, el: HTMLElement) => void;
	} = $props();

	let table = $state<HTMLElement | null>(null);
	let pendingFocus = $state<string | null>(null);
	let pending: DragOp | null = null;
	let origin = { x: 0, y: 0 };
	let suppressClick = false;

	const compact = $derived(variant === 'month');
	const isOtherMonth = (date: string) => variant === 'month' && date.slice(0, 7) !== monthOf;

	function dateAt(x: number, y: number): string | null {
		return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-date]')?.dataset.date ?? null;
	}

	function stop() {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', cancel);
		window.removeEventListener('keydown', escape, true);
		pending = null;
		// the click that follows a drag must not select the tile under the pointer
		setTimeout(() => (suppressClick = false), 0);
	}

	function move(event: PointerEvent) {
		if (!pending) return;
		if (!op && exceedsThreshold(event.clientX - origin.x, event.clientY - origin.y)) op = pending;
		if (!op) return;
		const date = dateAt(event.clientX, event.clientY);
		if (date && date !== op.current) op = dragTo(op, date);
	}

	function up(event: PointerEvent) {
		const current = op;
		op = null;
		if (current) {
			suppressClick = true;
			const range = previewRange(current);
			if (current.type === 'select') ondrag(range, event.metaKey || event.ctrlKey);
			else if (!isNoop(current)) {
				const absence = absenceById(current.id);
				if (absence) (current.type === 'move' ? onmove : onresize)(absence, range);
			}
		}
		stop();
	}

	function cancel() {
		op = null;
		suppressClick = true;
		stop();
	}

	function escape(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !pending) return;
		event.preventDefault();
		event.stopPropagation();
		cancel();
	}

	function down(event: PointerEvent, date: string) {
		if (event.button !== 0) return;
		// Touch scrolls the page unless range mode is on; a tap still selects through the click handler.
		if (event.pointerType === 'touch' && !rangeMode) return;
		const target = event.target as Element;
		const chip = target.closest<HTMLElement>('[data-absence-id]');
		const absence = chip ? absenceById(chip.dataset.absenceId ?? '') : undefined;
		const edge = target.closest<HTMLElement>('[data-resize]')?.dataset.resize;
		const range = absence ? { start: absence.startDate, end: absence.endDate } : null;
		if (absence && range && (edge === 'start' || edge === 'end')) pending = beginResize(absence.id, edge, range);
		else if (absence && range) pending = beginMove(absence.id, range, date);
		else pending = beginSelect(date);
		origin = { x: event.clientX, y: event.clientY };
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);
		window.addEventListener('keydown', escape, true);
	}

	function click(event: MouseEvent, date: string) {
		if (suppressClick) return;
		onpick(date, { shift: event.shiftKey, meta: event.metaKey || event.ctrlKey });
	}

	const KEYS: Record<string, CursorMove> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'week-start', End: 'week-end', PageUp: 'page-up', PageDown: 'page-down' };

	function keydown(event: KeyboardEvent, date: string) {
		// Everything else (Alt+arrows, T, ?, Delete, undo) is handled by the page's window listener.
		if (event.altKey || event.metaKey || event.ctrlKey || !(event.key in KEYS)) return;
		event.preventDefault();
		const next = moveCursor(date, KEYS[event.key]);
		pendingFocus = next;
		oncursor(next, event.shiftKey);
	}

	$effect(() => {
		void weeks;
		if (!pendingFocus) return;
		const el = table?.querySelector<HTMLElement>(`[data-date="${pendingFocus}"]`);
		if (el) {
			pendingFocus = null;
			void tick().then(() => el.focus());
		}
	});

	const ghostClass = (date: string) => {
		if (!ghost?.dates.has(date)) return '';
		const severity = ghost.severity.get(date);
		if (severity === 'block') return 'ring-2 ring-inset ring-destructive bg-destructive/15';
		if (severity === 'warn') return 'ring-2 ring-inset ring-amber-500 bg-amber-500/15';
		return 'ring-2 ring-inset ring-primary bg-primary/15';
	};
	const base = 'flex h-full w-full flex-col gap-1 p-1.5 text-left transition-[background-color,box-shadow] duration-150 hover:brightness-95 dark:hover:brightness-125 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none select-none';
</script>

<!-- month/week grid (tablet and desktop) -->
<table
	bind:this={table}
	class="hidden w-full table-fixed border-collapse sm:table {op ? (op.type === 'select' ? 'cursor-crosshair' : 'cursor-grabbing') : ''}"
	style={rangeMode ? 'touch-action: none' : ''}
	data-testid="month-grid"
	data-variant={variant}
	data-dragging={op ? op.type : undefined}
	aria-label={label}
>
	<thead>
		<tr>
			<th scope="col" class="w-9 border-b px-1 py-1.5 text-left text-[11px] font-normal text-muted-foreground"><abbr title={t('cal.week_number')} class="no-underline">{t('cal.week_short')}</abbr></th>
			{#each [1, 2, 3, 4, 5, 6, 7] as weekday (weekday)}
				<th scope="col" class="border-b px-1 py-1.5 text-left text-xs font-medium text-muted-foreground">{weekdayLabel(weekday)}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each weeks as week (week[0])}
			<tr>
				<th scope="row" class="border border-r-0 px-1 py-1.5 text-left align-top text-[11px] font-normal text-muted-foreground tabular-nums" data-testid="week-number" aria-label={t('cal.week_n', { n: isoWeekNumber(week[0]) })}>{isoWeekNumber(week[0])}</th>
				{#each week as date (date)}
					{@const info = infoOf(date)}
					<td class="{variant === 'week' ? 'h-60' : 'h-28'} border p-0 align-top">
						<button
							type="button"
							class="{base} {WORK_STATE_CLASSES[stateOf(info)]} {isOtherMonth(date) ? 'opacity-60' : ''} {selected.has(date) ? 'ring-2 ring-primary ring-inset' : ''} {ghostClass(date)}"
							aria-label={describe(info)}
							data-work-state={stateOf(info)}
							aria-pressed={selected.has(date)}
							data-date={date}
							data-today={date === today ? 'true' : undefined}
							tabindex={date === cursor ? 0 : -1}
							onpointerdown={(e) => down(e, date)}
							onclick={(e) => click(e, date)}
							ondblclick={(e) => onquick(date, e.currentTarget)}
							onkeydown={(e) => keydown(e, date)}
							onfocus={() => date !== cursor && oncursor(date, false)}
							use:contextmenu={(target) => menuFor(date, target)}
						>
							<span class="text-xs {date === today ? 'inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground' : isOtherMonth(date) ? 'text-muted-foreground' : 'font-medium'}">{Number(date.slice(8))}</span>
							<DayChips {info} {compact} {hidden} draggable />
						</button>
					</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<!-- week list (phone) -->
<ul class="flex flex-col gap-2 sm:hidden" data-testid="week-days" style={rangeMode ? 'touch-action: none' : ''}>
	{#each phoneWeek as date (date)}
		{@const info = infoOf(date)}
		<li>
			<button
				type="button"
				class="flex min-h-14 w-full items-start gap-3 rounded-lg border bg-card p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none {WORK_STATE_CLASSES[stateOf(info)]} {selected.has(date) ? 'ring-2 ring-primary' : ''} {ghostClass(date)}"
				aria-label={describe(info)}
				data-work-state={stateOf(info)}
				aria-pressed={selected.has(date)}
				data-date={date}
				onpointerdown={(e) => down(e, date)}
				onclick={(e) => click(e, date)}
				ondblclick={(e) => onquick(date, e.currentTarget)}
				use:contextmenu={(target) => menuFor(date, target)}
			>
				<span class="w-16 shrink-0 text-sm {date === today ? 'font-semibold' : 'text-muted-foreground'}">{formatDateShort(date)}</span>
				<DayChips {info} {hidden} />
			</button>
		</li>
	{/each}
</ul>
