<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { t } from '#lib/i18n/index.js';
	import { isoWeeksInYear, isValidIsoWeek, shiftWeek, weekStartDate, type IsoWeek } from '#lib/reports/weeks.js';
	import { addDays, formatDateNumeric } from '#lib/time/dates.js';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let { current, today, onselect }: { current: IsoWeek; today: IsoWeek; onselect: (week: IsoWeek) => void } = $props();

	let yearText = $state('');
	let weekText = $state('');
	let error = $state('');
	const uid = $props.id();

	$effect(() => {
		yearText = String(current.year);
		weekText = String(current.week);
		error = '';
	});

	const isToday = $derived(current.year === today.year && current.week === today.week);
	const start = $derived(weekStartDate(current.year, current.week));

	function jump(e: SubmitEvent) {
		e.preventDefault();
		const year = Number(yearText);
		const week = Number(weekText);
		if (!Number.isInteger(year) || year < 1000 || year > 9999 || !Number.isInteger(week) || week < 1) {
			error = t('reports.nav.invalid', { max: 52 });
			return;
		}
		if (!isValidIsoWeek(year, week)) {
			error = t('reports.nav.invalid', { max: isoWeeksInYear(year) });
			return;
		}
		error = '';
		onselect({ year, week });
	}
</script>

<section aria-label={t('reports.nav.label')} class="flex flex-col gap-3" data-testid="week-nav">
	<div class="flex flex-wrap items-center gap-2">
		<Button variant="outline" size="icon" aria-label={t('reports.nav.previous')} onclick={() => onselect(shiftWeek(current, -1))} data-testid="week-prev"><ChevronLeftIcon /></Button>
		<div class="min-w-0 flex-1 text-center">
			<h2 class="text-lg font-semibold tabular-nums" data-testid="week-heading">{t('reports.week_heading', { week: current.week, year: current.year })}</h2>
			<p class="text-xs text-muted-foreground" data-testid="week-range">{t('reports.nav.range', { from: formatDateNumeric(start), to: formatDateNumeric(addDays(start, 6)) })}</p>
		</div>
		<Button variant="outline" size="icon" aria-label={t('reports.nav.next')} onclick={() => onselect(shiftWeek(current, 1))} data-testid="week-next"><ChevronRightIcon /></Button>
	</div>
	<form class="flex flex-wrap items-end gap-2" onsubmit={jump} novalidate>
		<div class="flex flex-col gap-1">
			<Label for="{uid}-year" class="text-xs">{t('reports.nav.year')}</Label>
			<Input id="{uid}-year" bind:value={yearText} inputmode="numeric" class="w-24" aria-invalid={error ? true : undefined} aria-describedby={error ? `${uid}-error` : undefined} data-testid="week-year" />
		</div>
		<div class="flex flex-col gap-1">
			<Label for="{uid}-week" class="text-xs">{t('reports.nav.week')}</Label>
			<Input id="{uid}-week" bind:value={weekText} inputmode="numeric" class="w-20" aria-invalid={error ? true : undefined} aria-describedby={error ? `${uid}-error` : undefined} data-testid="week-number" />
		</div>
		<Button type="submit" variant="outline">{t('reports.nav.go')}</Button>
		<Button type="button" variant="ghost" disabled={isToday} onclick={() => onselect(today)} data-testid="week-today">{t('reports.nav.current')}</Button>
	</form>
	{#if error}<p id="{uid}-error" class="text-xs text-destructive" role="alert" data-testid="week-nav-error">{error}</p>{/if}
</section>
