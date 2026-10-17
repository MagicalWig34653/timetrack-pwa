<script lang="ts">
	import type { TimeWeekDay } from '#lib/api/types.js';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { t } from '#lib/i18n/index.js';
	import { planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric, localTimeOf } from '#lib/time/dates.js';
	import { formatDelta, formatDuration } from '#lib/time/format.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { balanceTone, barShares, dayAriaLabel, dayHours, MARK_CLASSES, weekMarkLabel } from '#lib/week/overview.js';
	import MarkIcon from './MarkIcon.svelte';

	/** One day of the week overview: weekday and date, mark, hours, worked/planned/target bar, balance, first start to last end. */
	let { day, timeZone }: { day: TimeWeekDay; timeZone: string } = $props();

	const hours = $derived(dayHours(day));
	const bars = $derived(barShares(day));
	const halfDay = $derived(day.mark === 'vacation' && day.absences.some((a) => a.kind === 'vacation' && a.halfDay));
	const showHours = $derived(hours > 0 || day.isToday || (!day.isFuture && day.mark === 'work' && day.targetSeconds > 0));
	const showMode = $derived(!!day.planMode && !['vacation', 'sick', 'holiday', 'excused'].includes(day.mark));
	const dim = $derived(day.mark === 'off' && hours === 0 && day.plannedSeconds === null);
</script>

<a
	href="/time/{day.date}"
	class="day ui-card rounded-[10px] border bg-card p-3 shadow-[var(--shadow-card)] transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring {day.isToday ? 'ring-2 ring-ui-accent/60' : ''} {dim ? 'opacity-75' : ''}"
	aria-label={dayAriaLabel(day)}
	aria-current={day.isToday ? 'date' : undefined}
	data-testid="week-day-{day.date}"
	data-mark={day.mark}
>
	<span class="head flex items-baseline gap-x-2 lg:flex-wrap">
		<span class="text-sm font-semibold">{weekdayLabel(day.weekday)}</span>
		<span class="text-xs text-muted-foreground tabular-nums">{formatDateNumeric(day.date).slice(0, 6)}</span>
	</span>

	<span class="chip flex flex-wrap items-center gap-1.5">
		<span class="inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap {MARK_CLASSES[day.mark]}" data-testid="day-mark">
			<MarkIcon mark={day.mark} class="size-3" />{weekMarkLabel(day.mark)}{#if halfDay}<span class="font-normal"> ½</span>{/if}
		</span>
		{#if day.isToday}<StatusChip tone="accent" dot={false}>{t('weekview.today')}</StatusChip>{/if}
		{#if day.provisional && !day.isFuture}<StatusChip tone="neutral">{t('weekview.provisional')}</StatusChip>{/if}
	</span>

	<span class="hours tabular-nums" data-testid="day-hours">
		{#if showHours}
			<span class="text-[26px] leading-none font-semibold tracking-[-0.5px] lg:text-[28px]">{formatDuration(hours)}</span>
		{:else if day.isFuture && day.plannedSeconds}
			<span class="text-[20px] leading-none font-medium text-muted-foreground">{formatDuration(day.plannedSeconds)}</span>
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
			<span class="mt-1 block text-[11px] text-muted-foreground tabular-nums">{t('weekview.target_of', { time: formatDuration(day.targetSeconds) })}</span>
			{#if day.plannedSeconds}<span class="block text-[11px] text-muted-foreground tabular-nums">{t('weekview.planned', { time: formatDuration(day.plannedSeconds) })}</span>{/if}
		{:else if day.plannedSeconds}
			<span class="mt-1 block text-[11px] text-muted-foreground tabular-nums">{t('weekview.planned', { time: formatDuration(day.plannedSeconds) })}</span>
		{/if}
	</span>

	<span class="balance flex flex-wrap items-center gap-1.5 text-xs">
		{#if day.balanceSeconds !== null && (day.targetSeconds > 0 || hours > 0)}
			<StatusChip tone={balanceTone(day.balanceSeconds)} dot={false}>{formatDelta(day.balanceSeconds)}</StatusChip>
		{/if}
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
