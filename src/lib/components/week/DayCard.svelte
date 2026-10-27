<script lang="ts">
	import type { TimeWeekDay } from '#lib/api/types.js';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { t } from '#lib/i18n/index.js';
	import { ABSENCE_CLASSES, absenceKindLabel, planModeLabel } from '#lib/planning/labels.js';
	import { vacationTooltip, type VacationEntry } from '#lib/week/vacation.js';
	import { absenceWarning, chipAbsences } from '#lib/week/absences.js';
	import { formatDateNumeric, localTimeOf } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { balanceTone, barShares, dayAriaLabel, dayHours, MARK_CLASSES, weekMarkLabel } from '#lib/week/overview.js';
	import TreePalm from '@lucide/svelte/icons/tree-palm';
	import HolidayBadge from './HolidayBadge.svelte';
	import MarkIcon from './MarkIcon.svelte';
	import BlockKindIcon from './BlockKindIcon.svelte';
	import { BLOCK_KIND_CLASSES, blockKindLabel } from '#lib/planning/labels.js';
	import { listsBlocks } from '#lib/week/plan-blocks.js';

	/** One day of the week overview: weekday and date, mark, hours, worked/planned/target bar, balance, first start to last end. */
	let { day, timeZone, href = `/time/${day.date}`, selected = false, review = false, vacation = null, onselect }: { day: TimeWeekDay; timeZone: string; /** vacation entries of this day from the absence list; null = not loaded (fall back to the week's own absences) */ vacation?: VacationEntry[] | null; href?: string; selected?: boolean; /** has entries that need a check */ review?: boolean; onselect?: () => void } = $props();

	function click(event: MouseEvent) {
		// plain clicks open the day panel in place; modified clicks keep the link behaviour (new tab, download ...)
		if (!onselect || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		onselect();
	}

	const hours = $derived(dayHours(day));
	const bars = $derived(barShares(day));
	const listed = $derived(vacation !== null);
	// a named holiday on a holiday-marked day replaces the plain "Feiertag" chip; half company days and free days get the name next to the mark
	const holidayChip = $derived(!!day.holidayName);
	const hideMark = $derived((day.mark === 'vacation' && (vacation?.length ?? 0) > 0) || (day.mark === 'holiday' && holidayChip));
	const halfDay = $derived(day.mark === 'vacation' && day.absences.some((a) => a.kind === 'vacation' && a.halfDay));
	const showHours = $derived(hours > 0 || day.isToday || (!day.isFuture && day.mark === 'work' && day.targetSeconds > 0));
	const showMode = $derived(!!day.planMode && !['vacation', 'sick', 'holiday', 'excused'].includes(day.mark));
	/** The plan blocks of a day, only when the plan has more than the one window the card already summarizes. */
	const planBlocks = $derived(listsBlocks(day.planBlocks) ? [...(day.planBlocks ?? [])].sort((a, b) => a.start.localeCompare(b.start)) : []);
	const dim = $derived(day.mark === 'off' && hours === 0 && day.plannedSeconds === null);
</script>

<a
	{href}
	onclick={click}
	class="day group/card ui-card rounded-[10px] border bg-card p-3 shadow-[var(--shadow-card)] transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring {day.isToday ? 'ring-2 ring-ui-accent/60' : ''} {selected ? 'bg-ui-accent-soft ring-2 ring-ui-accent' : ''} {dim ? 'bg-muted/40' : ''} {(vacation?.length ?? 0) > 0 ? 'vacation-day' : ''}"
	aria-label={dayAriaLabel(day, vacation)}
	aria-current={day.isToday ? 'date' : undefined}
	aria-expanded={onselect ? selected : undefined}
	data-selected={selected ? 'true' : undefined}
	data-testid="week-day-{day.date}"
	data-mark={day.mark}
>
	<span class="head flex items-baseline gap-x-2 lg:flex-wrap">
		<span class="text-sm font-semibold">{weekdayLabel(day.weekday)}</span>
		<span class="text-xs text-muted-foreground tabular-nums">{formatDateNumeric(day.date).slice(0, 6)}</span>
	</span>

	<span class="chip flex flex-wrap items-center gap-1.5">
		{#if !hideMark}
			<span class="inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap {MARK_CLASSES[day.mark]}" data-testid="day-mark">
				<MarkIcon mark={day.mark} class="size-3" />{weekMarkLabel(day.mark)}{#if halfDay && !listed}<span class="font-normal"> ½</span>{/if}
			</span>
		{/if}
		{#if day.holidayName}<HolidayBadge name={day.holidayName} treatment={day.companyDayTreatment ?? null} testid="day-holiday" />{/if}
		{#each vacation ?? [] as entry (entry.id)}
			<!-- icon only; the full text is a tooltip on hover and on keyboard focus of the card, and part of the card's aria-label -->
			<span class="vac group/vac relative inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-xs font-medium {entry.status === 'approved' ? MARK_CLASSES.vacation : 'vac-open ' + MARK_CLASSES.vacation}" data-testid="day-vacation" data-status={entry.status} data-half={entry.halfDay ? 'true' : undefined}>
				<TreePalm class="size-3.5" aria-hidden="true" />{#if entry.halfDay}<span aria-hidden="true">½</span>{/if}
				<span role="tooltip" class="vac-tip pointer-events-none absolute top-full left-0 z-20 mt-1 hidden w-max max-w-[14rem] rounded-md border bg-popover px-2 py-1 text-xs font-normal text-popover-foreground shadow-md group-hover/vac:block group-focus-visible/card:block" data-testid="day-vacation-tip">{vacationTooltip(entry)}</span>
			</span>
		{/each}
		{#each chipAbsences(day, listed) as absence, i (i)}
			{@const warning = absenceWarning(absence.status)}
			<span
				title={warning ? `${absenceKindLabel(absence.kind)}: ${warning}` : undefined}
				class="inline-flex h-5 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium {warning ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200' : ABSENCE_CLASSES[absence.kind]}"
				data-testid="day-absence"
				data-status={absence.status}
			>
				<span class="truncate">{absenceKindLabel(absence.kind)}{#if absence.halfDay}&nbsp;½{/if}</span>
			</span>
		{/each}
		{#if day.isToday}<StatusChip tone="accent" dot={false}>{t('weekview.today')}</StatusChip>{/if}
		{#if day.provisional && !day.isFuture}<StatusChip tone="neutral">{t('weekview.provisional')}</StatusChip>{/if}
	</span>

	<span class="hours tabular-nums" data-testid="day-hours">
		{#if showHours}
			<span class="text-[26px] leading-none font-semibold tracking-[-0.5px] lg:text-[28px]">{timeDisplay.duration(hours)}</span>
		{:else if day.isFuture && day.plannedSeconds}
			<span class="text-[20px] leading-none font-medium text-muted-foreground">{timeDisplay.duration(day.plannedSeconds)}</span>
			<span class="sr-only">{t('weekview.bar_planned')}</span>
		{:else}
			<span class="text-[20px] leading-none text-muted-foreground" aria-hidden="true">–</span>
		{/if}
	</span>

	<span class="bars block" aria-hidden="true">
		<span class="relative block h-1.5 overflow-hidden rounded-full bg-muted">
			{#if bars.planned > 0}<span class="absolute inset-y-0 left-0 rounded-full border border-dashed border-ui-accent/70 bg-ui-accent/10" style="width: {Math.max(bars.planned, 2)}%" data-testid="bar-planned"></span>{/if}
			{#if bars.actual > 0}<span class="absolute inset-y-0 left-0 rounded-full bg-ui-accent" style="width: {bars.actual}%" data-testid="bar-actual"></span>{/if}
		</span>
		{#if day.targetSeconds > 0}
			<span class="mt-1 block text-[11px] text-muted-foreground tabular-nums">{t('weekview.target_of', { time: timeDisplay.duration(day.targetSeconds) })}</span>
			{#if day.plannedSeconds}<span class="block text-[11px] text-muted-foreground tabular-nums">{t('weekview.planned', { time: timeDisplay.duration(day.plannedSeconds) })}</span>{/if}
		{:else if day.plannedSeconds}
			<span class="mt-1 block text-[11px] text-muted-foreground tabular-nums">{t('weekview.planned', { time: timeDisplay.duration(day.plannedSeconds) })}</span>
		{/if}
		{#if planBlocks.length > 0}
			<!-- every plan block of the day (contract 0.35.0): kind icon, label and times; colour is never the only signal -->
			<span class="mt-1.5 flex flex-wrap gap-1" data-testid="day-blocks">
				{#each planBlocks as block, n (n)}
					<span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] tabular-nums {BLOCK_KIND_CLASSES[block.kind]}" data-testid="day-block" data-kind={block.kind}><BlockKindIcon kind={block.kind} class="size-3" />{blockKindLabel(block.kind)} {block.start}–{block.end}</span>
				{/each}
			</span>
		{/if}
	</span>

	<span class="balance flex flex-wrap items-center gap-1.5 text-xs">
		{#if day.balanceSeconds !== null && (day.targetSeconds > 0 || hours > 0)}
			<StatusChip tone={balanceTone(day.balanceSeconds)} dot={false}>{timeDisplay.delta(day.balanceSeconds)}</StatusChip>
		{/if}
		{#if day.planActualDifferenceSeconds !== null && day.planActualDifferenceSeconds !== undefined}
			<span title={t('weekview.plan_diff_title')} data-testid="day-plan-diff"><StatusChip tone="neutral" dot={false}>{t('weekview.plan_diff', { delta: day.planActualDifferenceSeconds === 0 ? '±0' : timeDisplay.delta(day.planActualDifferenceSeconds) })}</StatusChip></span>
		{/if}
		{#if review}<StatusChip tone="warning" dot={false}>{t('segments.needs_review')}</StatusChip>{/if}
		{#if showMode && day.planMode}<span class="text-muted-foreground">{planModeLabel(day.planMode)}</span>{/if}
	</span>

	<span class="span text-xs text-muted-foreground tabular-nums">
		{#if day.firstStart && day.lastEnd}
			{t('weekview.span', { start: localTimeOf(day.firstStart, timeZone), end: localTimeOf(day.lastEnd, timeZone) })}
		{:else if !day.isFuture && day.mark === 'work' && day.targetSeconds > 0}
			{t('weekview.no_work')}
		{/if}
	</span>
</a>

<style>
	.day {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr) auto;
		grid-template-areas:
			'head chip hours'
			'head bars balance'
			'head span span';
		align-items: center;
		gap: 0.375rem 0.75rem;
		min-width: 0;
	}
	.vac-open {
		border: 1px dashed currentColor;
		background-image: repeating-linear-gradient(135deg, color-mix(in srgb, currentColor 22%, transparent) 0 3px, transparent 3px 6px);
	}
	.vacation-day {
		background-image: repeating-linear-gradient(135deg, color-mix(in srgb, #0ea5e9 12%, transparent) 0 6px, transparent 6px 14px);
	}
	.head { grid-area: head; align-self: start; flex-direction: column; }
	.chip { grid-area: chip; }
	.hours { grid-area: hours; text-align: right; }
	.bars { grid-area: bars; }
	.balance { grid-area: balance; justify-content: flex-end; }
	.span { grid-area: span; }
	@media (min-width: 1024px) {
		.day {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas: 'head' 'chip' 'hours' 'bars' 'balance' 'span';
			align-items: start;
			gap: 0.5rem;
			padding: 0.875rem 0.75rem;
		}
		.head { flex-direction: row; }
		.hours, .balance { text-align: left; justify-content: flex-start; }
		.balance { min-height: 1.25rem; }
	}
</style>
