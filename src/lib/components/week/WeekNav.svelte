<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { addDays, formatDateNumeric, isoWeekLabel, isoWeekNumber } from '#lib/time/dates.js';

	/** Week selector shared by overview and planner: previous/next, "Diese Woche", KW label with date range, date jump. */
	let {
		monday,
		currentMonday,
		basePath,
		onpick
	}: { monday: string; currentMonday: string; basePath: string; onpick: (date: string) => void } = $props();

	const href = (date: string) => `${basePath}?week=${isoWeekLabel(date)}`;
</script>

<nav class="mb-5 flex flex-wrap items-center gap-2 print:hidden" aria-label={t('weekview.nav_label')} data-testid="week-nav">
	<Button variant="outline" size="icon" href={href(addDays(monday, -7))} aria-label={t('weekview.prev')} data-testid="week-prev"><ChevronLeft /></Button>
	<Button variant="outline" size="icon" href={href(addDays(monday, 7))} aria-label={t('weekview.next')} data-testid="week-next"><ChevronRight /></Button>
	<div class="mx-1 min-w-0 flex-1 basis-40 sm:flex-none">
		<p class="text-[17px] leading-tight font-semibold" data-testid="week-kw">{t('weekview.kw', { week: isoWeekNumber(monday) })}</p>
		<p class="text-[13px] text-muted-foreground tabular-nums" data-testid="week-range">{t('weekview.range', { from: formatDateNumeric(monday), to: formatDateNumeric(addDays(monday, 6)) })}</p>
	</div>
	{#if monday !== currentMonday}
		<Button variant="outline" size="sm" href={href(currentMonday)} data-testid="week-today">{t('weekview.this_week')}</Button>
	{/if}
	<label class="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
		<span class="sr-only sm:not-sr-only">{t('weekview.jump')}</span>
		<input
			type="date"
			value={monday}
			onchange={(e) => e.currentTarget.value && onpick(e.currentTarget.value)}
			class="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30"
		/>
	</label>
</nav>
