<script lang="ts">
	import { contextmenu, type MenuEntry } from '#lib/a11y/context-menu.svelte.js';
	import type { Absence } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import type { DayInfo, DayWorkState } from '#lib/planning/calendar.js';
	import type { ConflictSeverity } from '#lib/planning/conflicts.js';
	import { beginMove, beginResize, beginSelect, dragTo, exceedsThreshold, isNoop, previewRange, type DragOp } from '#lib/planning/drag.js';
	import { ABSENCE_CLASSES, absenceKindLabel, HOLIDAY_CLASS, PLAN_CLASSES, planModeLabel, SCHOOL_HOLIDAY_CLASS, WORK_STATE_CLASSES } from '#lib/planning/labels.js';
	import { holidayHint } from '#lib/planning/company-days.js';
	import { monthPills, visibleText } from '#lib/planning/month-pills.js';
	import { moveCursor, type CursorMove, type DateRange } from '#lib/planning/range-select.js';
	import { weekdayIndex } from '#lib/planning/month-pills.js';
	import { formatDateShort, isoWeekNumber } from '#lib/time/dates.js';
	import { dotsOf, DOT_CLASSES } from '#lib/planning/dots.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { tick } from 'svelte';
	import type { WeekBalance } from '#lib/planning/week-balance.js';
	import { cellModel, type CellModel } from '#lib/planning/cell-model.js';
	import type { WorkModel } from '#lib/api/types.js';
	import DayChips from './DayChips.svelte';
	import WeekBalanceLabel from './WeekBalanceLabel.svelte';

	/**
	 * Month grid (tablet and desktop) and week list (phone) with pointer drag (select, move, resize), roving keyboard
	 * cursor and per-day context menus. It holds no data: the page owns data, selection and writes and reacts to the
	 * callbacks. Drag state lives in `op` (bindable) so the page can show conflicts for the ghost.
	 */
	let {
		weeks,
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
		balanceOf,
		models = [],
		weekHref,
		op = $bindable(null),
		onpick,
		ondrag,
		onmove,
		onresize,
		oncursor,
		onquick
	}: {
		weeks: string[][];
		today: string;
		/** YYYY-MM of the shown month; days of other months are dimmed */
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
		/** hour difference of a week against its Soll (shown under the KW number) */
		balanceOf: (week: string[]) => WeekBalance | null;
		models?: WorkModel[];
		/** link target that opens the week of a date (week number click) */
		weekHref: (date: string) => string;
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

	// One view model per visible day, computed once per data change instead of once per render of a cell.
	const models_ = $derived(models);
	const cellOf = (date: string): CellModel => cellModel(infoOf(date), models_);
	const cells = $derived(new Map(weeks.flat().map((d) => [d, cellOf(d)])));
	const cellClass = (m: CellModel | undefined) => (m ? `${m.vacation === 'open' ? 'cell-vac-open' : ''} ${m.vacation === 'booked' ? 'cell-vac-booked' : ''} ${m.holiday !== 'none' ? 'cell-holiday' : ''} ${m.free ? 'cell-free' : ''}` : '');

	const phoneBalance = $derived(balanceOf(phoneWeek));
	const isOtherMonth = (date: string) => date.slice(0, 7) !== monthOf;
	const isWeekend = (date: string) => weekdayIndex(date) >= 5;

	// Pills per cell as many as the row height allows (measured), so nothing is cut off mid-pill.
	let gridHeight = $state(0);
	const maxPills = $derived(gridHeight > 0 ? Math.min(5, Math.max(1, Math.floor((gridHeight / weeks.length - 30) / 19))) : 3);
	const pillLabels = {
		absence: (a: Absence) => absenceKindLabel(a.kind),
		plan: planModeLabel,
		holidayHint: (name: string, treatment: string | null | undefined) => holidayHint(name, treatment as never)
	};
	const pillsOf = (date: string) => monthPills(infoOf(date), hidden, pillLabels, maxPills);

	// Soft fade when the month changes; skipped for reduced motion. The grid stays mounted, so focus and drag survive.
	let body = $state<HTMLElement | null>(null);
	$effect(() => {
		const el = body;
		if (!el || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => (gridHeight = el.clientHeight));
		observer.observe(el);
		gridHeight = el.clientHeight;
		return () => observer.disconnect();
	});
	let lastMonth = '';
	$effect(() => {
		const month = monthOf;
		if (lastMonth && lastMonth !== month && body && typeof body.animate === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			body.animate([{ opacity: 0.35, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
		}
		lastMonth = month;
	});

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
	const base = 'relative flex h-full w-full flex-col gap-1 px-1.5 py-1 text-left shadow-[inset_1px_0_0_var(--grid-line)] transition-colors duration-150 hover:bg-foreground/[0.06] focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset select-none';
	/** Calm per-state tints of the cell; the legend keeps the stronger tile colours. */
	const TINT: Record<DayWorkState, string> = { work: '', free: 'bg-muted/60', vacation_booked: 'bg-sky-500/10', vacation_planned: 'bg-sky-500/[0.06]', sick: 'bg-rose-500/10', absence: 'bg-violet-500/10' };
</script>

<!-- month grid (tablet and desktop): CSS grid with ARIA grid roles; rows share the available height (1fr) on landscape desktops -->
<div
	bind:this={table}
	class="wg-month hidden h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-card sm:flex {op ? (op.type === 'select' ? 'cursor-crosshair' : 'cursor-grabbing') : ''}"
	style={rangeMode ? 'touch-action: none' : ''}
	data-testid="month-grid"
	data-variant="month"
	data-dragging={op ? op.type : undefined}
	role="grid"
	aria-label={label}
>
	<div class="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b bg-muted/30" role="row">
		<span role="columnheader" class="px-2 py-1.5 text-[11px] font-medium text-muted-foreground"><abbr title={t('cal.week_number')} class="no-underline">{t('cal.week_short')}</abbr></span>
		{#each [1, 2, 3, 4, 5, 6, 7] as weekday (weekday)}
			<span role="columnheader" class="px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{weekdayLabel(weekday)}</span>
		{/each}
	</div>
	<div bind:this={body} class="grid min-h-0 flex-1" style="grid-template-rows: repeat({weeks.length}, minmax(var(--row-min, 6.75rem), 1fr)); min-height: calc(6 * var(--row-min, 6.75rem))" data-testid="month-rows">
		{#each weeks as week (week[0])}
			{@const balance = balanceOf(week)}
			<div class="grid min-h-0 grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b last:border-b-0" role="row">
				<div role="rowheader" class="flex min-w-0 flex-col items-start gap-0.5 bg-muted/20 px-2 py-1.5" data-testid="week-number">
					<a
						href={weekHref(week[0])}
						class="rounded px-1 text-[12px] font-semibold text-muted-foreground tabular-nums hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						aria-label={t('cal.open_week_n', { n: isoWeekNumber(week[0]) })}
						title={t('cal.open_week')}
						data-testid="week-link">{isoWeekNumber(week[0])}</a>
					{#if balance}<WeekBalanceLabel {balance} week={isoWeekNumber(week[0])} />{/if}
				</div>
				{#each week as date (date)}
					{@const info = infoOf(date)}
					{@const cell = cells.get(date)}
					{@const shown = pillsOf(date)}
					<div role="gridcell" class="min-h-0 min-w-0">
						<button
							type="button"
							class="{base} {TINT[stateOf(info)]} {isOtherMonth(date) ? 'bg-muted/40' : ''} {cellClass(cell)} {selected.has(date) ? 'bg-primary/10 ring-2 ring-primary ring-inset' : ''} {ghostClass(date)}"
							aria-label="{visibleText(date, shown.pills, shown.more)}, {describe(info)}"
							data-work-state={stateOf(info)}
							aria-pressed={selected.has(date)}
							data-date={date}
							data-today={date === today ? 'true' : undefined}
							data-other-month={isOtherMonth(date) ? 'true' : undefined}
							tabindex={date === cursor ? 0 : -1}
							onpointerdown={(e) => down(e, date)}
							onclick={(e) => click(e, date)}
							ondblclick={(e) => onquick(date, e.currentTarget)}
							onkeydown={(e) => keydown(e, date)}
							onfocus={() => date !== cursor && oncursor(date, false)}
							use:contextmenu={(target) => menuFor(date, target)}
						>
							<span class="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] tabular-nums {date === today ? 'font-semibold text-primary ring-2 ring-primary' : isOtherMonth(date) || isWeekend(date) ? 'font-normal text-muted-foreground' : 'font-medium'}">{Number(date.slice(8))}</span>
							<span class="-mx-1.5 flex min-h-0 min-w-0 flex-col gap-[3px] overflow-hidden">
								{#each shown.pills as pill (pill.key)}
									{#if pill.kind === 'absence' && pill.absence}
										{@const absence = pill.absence}
										<span
											class="pill relative {ABSENCE_CLASSES[absence.kind]} {pill.open ? 'pill-open' : ''} {pill.continuesLeft ? 'rounded-l-none' : 'ml-1.5 rounded-l-md'} {pill.continuesRight ? 'rounded-r-none' : 'mr-1.5 rounded-r-md'} cursor-grab active:cursor-grabbing"
											data-chip="absence"
											data-absence-id={absence.id}
											data-status={absence.status}
											data-continues-left={pill.continuesLeft ? 'true' : undefined}
											data-continues-right={pill.continuesRight ? 'true' : undefined}
										>
											{#if absence.startDate === date}<span class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l bg-current/0 hover:bg-current/30" data-resize="start" aria-hidden="true"></span>{/if}
											{pill.label}{#if pill.half && pill.label}<span aria-hidden="true"> ½</span>{/if}
											{#if absence.endDate === date}<span class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r bg-current/0 hover:bg-current/30" data-resize="end" aria-hidden="true"></span>{/if}
										</span>
									{:else if pill.kind === 'holiday'}
										<span class="pill mx-1.5 rounded-md {HOLIDAY_CLASS} {pill.half ? 'border border-dashed border-current' : ''}" data-chip="holiday" data-treatment={pill.treatment ?? undefined} title={holidayHint(pill.label, pill.treatment as never)}>{pill.label}{#if pill.half}<span aria-hidden="true"> ½</span><span class="sr-only">, {holidayHint(pill.label, 'half')}</span>{/if}</span>
									{:else if pill.kind === 'school_holiday'}
										<span class="pill mx-1.5 rounded-md {SCHOOL_HOLIDAY_CLASS}" data-chip="school-holiday">{pill.label}</span>
									{:else if pill.planMode}
										<span class="pill mx-1.5 gap-1 rounded-md {PLAN_CLASSES[pill.planMode]}" data-chip="plan"><span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>{pill.label}</span>
									{/if}
								{/each}
								{#if shown.more > 0 && !shown.moreInCorner}<span class="mx-1.5 px-1 text-[11px] leading-[18px] text-muted-foreground" aria-hidden="true" data-testid="pill-more">+{shown.more}</span>{/if}
							</span>
							{#if shown.moreInCorner}<span class="absolute top-1.5 right-1.5 text-[11px] leading-[18px] text-muted-foreground" aria-hidden="true" data-testid="pill-more">+{shown.more}</span>{/if}
						</button>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<!-- compact month grid (phone): iOS-like cells with coloured dots; the week list below shows the details of one week -->
	<div class="sm:hidden" data-testid="phone-month" role="grid" aria-label={label} style={rangeMode ? 'touch-action: none' : ''}>
		<div class="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground" role="row">
			{#each [1, 2, 3, 4, 5, 6, 7] as weekday (weekday)}<span role="columnheader" class="py-1">{weekdayLabel(weekday)}</span>{/each}
		</div>
		{#each weeks as week (week[0])}
			<div class="grid grid-cols-7" role="row">
				{#each week as date (date)}
					{@const info = infoOf(date)}
					{@const state = stateOf(info)}
					{@const dots = dotsOf(info, hidden)}
					{@const pcell = cells.get(date)}
					<div role="gridcell" class="p-px">
						<button
							type="button"
							class="relative flex h-16 w-full flex-col items-center gap-1 rounded-lg px-0.5 pt-1.5 select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none {state === 'free' ? 'bg-muted/70' : ''} {state === 'sick' ? 'bg-rose-500/10' : ''} {state === 'vacation_booked' ? 'bg-sky-500/15' : ''} {cellClass(pcell)} {isOtherMonth(date) ? 'bg-muted/20' : ''} {selected.has(date) ? 'ring-2 ring-primary ring-inset bg-primary/10' : ''} {ghostClass(date)}"
							aria-label={describe(info)}
							aria-pressed={selected.has(date)}
							data-date={date}
							data-phone-cell
							data-today={date === today ? 'true' : undefined}
							onpointerdown={(e) => down(e, date)}
							onclick={(e) => click(e, date)}
							ondblclick={(e) => onquick(date, e.currentTarget)}
							use:contextmenu={(target) => menuFor(date, target)}
						>
							<span class="text-sm tabular-nums {date === today ? 'inline-flex size-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground' : isOtherMonth(date) ? 'font-normal text-muted-foreground' : 'font-medium'}">{Number(date.slice(8))}</span>
							<span class="flex min-h-2 flex-wrap items-center justify-center gap-0.5" aria-hidden="true">
								{#each dots.slice(0, 4) as dot, index (index)}
									<span class="size-1.5 rounded-full {DOT_CLASSES[dot.color]} {dot.hollow ? 'bg-transparent! ring-1 ring-current' : ''}" data-dot={dot.kind}></span>
								{/each}
							</span>
						</button>
					</div>
				{/each}
			</div>
		{/each}
	</div>

<!-- week list (phone) -->
{#if phoneBalance}
	<p class="mb-2 flex items-baseline gap-2 text-xs text-muted-foreground sm:hidden" data-testid="phone-week-balance">
		<span>{t('cal.week_n', { n: isoWeekNumber(phoneWeek[0]) })}</span>
		<WeekBalanceLabel balance={phoneBalance} week={isoWeekNumber(phoneWeek[0])} class="text-xs" />
	</p>
{/if}
<ul class="mt-4 flex flex-col gap-2 sm:hidden" data-testid="week-days" style={rangeMode ? 'touch-action: none' : ''}>
	{#each phoneWeek as date (date)}
		{@const info = infoOf(date)}
		<li>
			<button
				type="button"
				class="flex min-h-14 w-full items-start gap-3 rounded-lg border bg-card p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none {WORK_STATE_CLASSES[stateOf(info)]} {selected.has(date) ? 'ring-2 ring-primary' : ''} {ghostClass(date)}"
				aria-describedby="wk-{date}"
				data-work-state={stateOf(info)}
				aria-pressed={selected.has(date)}
				data-date={date}
				onpointerdown={(e) => down(e, date)}
				onclick={(e) => click(e, date)}
				ondblclick={(e) => onquick(date, e.currentTarget)}
				use:contextmenu={(target) => menuFor(date, target)}
			>
				<span id="wk-{date}" class="sr-only">{describe(info)}</span>
				<span class="w-16 shrink-0 text-sm {date === today ? 'font-semibold' : 'text-foreground/80'}">{formatDateShort(date)}</span>
				<DayChips {info} {hidden} />
			</button>
		</li>
	{/each}
</ul>

<style>
	.wg-month {
		--grid-line: color-mix(in srgb, var(--foreground) 9%, transparent);
	}
	/* One pill: fixed height, truncated label. Absence bars reach over the cell padding to join their neighbours. */
	.pill {
		display: flex;
		align-items: center;
		height: 18px;
		flex: none;
		min-width: 0;
		padding: 0 6px;
		overflow: hidden;
		font-size: 11px;
		font-weight: 500;
		line-height: 18px;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* Planned or requested vacation: hatched; booked: solid. */
	.pill-open {
		background-image: repeating-linear-gradient(135deg, color-mix(in srgb, currentColor 16%, transparent) 0 4px, transparent 4px 9px);
	}
	/* Cell level cues stay light: the bar carries the status, the cell only hints at it. */
	:global(.cell-vac-open) {
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #0ea5e9 22%, transparent);
	}
	:global(.cell-vac-booked) {
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #0ea5e9 40%, transparent);
	}
	:global(.cell-holiday) {
		background-color: color-mix(in srgb, #f59e0b 9%, transparent);
	}
	@media (prefers-reduced-motion: reduce) {
		.pill {
			transition: none;
		}
	}
</style>
