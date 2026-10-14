<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import type { DayEvaluation } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import DayNav from '#lib/components/time/DayNav.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { t } from '#lib/i18n/index.js';
	import { addDays, formatDateNumeric, formatDateShort, isoWeekday, isValidDate, localTimeOf, startOfWeek, todayLocal } from '#lib/time/dates.js';
	import { formatDelta, formatDuration } from '#lib/time/format.js';
	import { markLabel } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';

	const timeZone = $derived(zoneStore.value);
	const requested = $derived(page.url.searchParams.get('week') ?? '');
	// ?week=YYYY-MM-DD selects the week containing that day; default is the current week.
	const anchor = $derived(isValidDate(requested) ? requested : todayLocal(timeZone));
	const weekStart = $derived(startOfWeek(anchor));
	const weekEnd = $derived(addDays(weekStart, 6));
	const today = $derived(todayLocal(timeZone));

	let load = $state<LoadState>({ status: 'loading' });
	let days = $state<DayEvaluation[]>([]);

	$effect(() => {
		const from = weekStart;
		const to = weekEnd;
		load = { status: 'loading' };
		void (async () => {
			try {
				await zoneStore.ensure();
				const result = await api.listDays(from, to);
				if (from === weekStart) {
					days = result;
					load = { status: 'ready' };
				}
			} catch (error) {
				load = toLoadState(error);
			}
		})();
	});

	// Future days do not count towards totals (the target of a day that has not happened is no deficit).
	const elapsed = $derived(days.filter((d) => d.date <= today));
	const totals = $derived({
		target: elapsed.reduce((sum, d) => sum + d.targetSeconds, 0),
		evaluated: elapsed.reduce((sum, d) => sum + d.evaluatedWorkSeconds + d.creditSeconds, 0),
		delta: elapsed.reduce((sum, d) => sum + d.deltaSeconds, 0)
	});
</script>

<PageHeader
	title={t('week.title')}
	description={t('week.range', { from: formatDateNumeric(weekStart), to: formatDateNumeric(weekEnd) })}
/>
<DayNav
	label={t('datenav.week_label')}
	prevHref="/time?week={addDays(weekStart, -7)}"
	nextHref="/time?week={addDays(weekStart, 7)}"
	todayHref="/time"
	date={anchor}
	onpick={(picked) => goto(`/time?week=${picked}`)}
/>

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<Card>
		<CardContent class="p-0">
			<ul class="divide-y" data-testid="week-list">
				{#each days as day (day.date)}
					<li>
						<a
							href="/time/{day.date}"
							class="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 sm:grid-cols-[9rem_1fr_auto_auto_auto]"
							aria-current={day.date === today ? 'date' : undefined}
						>
							<span class="font-medium sm:order-1 {day.date === today ? 'underline underline-offset-4' : ''}">
								{formatDateShort(day.date)}
								{#if isoWeekday(day.date) > 5}<span class="sr-only"> {t('week.weekend')}</span>{/if}
							</span>
							<span class="text-right font-medium tabular-nums sm:order-5 {day.date <= today && day.deltaSeconds < 0 ? 'text-destructive' : ''}" title={t('day.delta')}>
								{day.date <= today ? formatDelta(day.deltaSeconds) : '–'}
							</span>
							<span class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground sm:order-2">
								{#if day.evaluatedStart && day.evaluatedEnd}
									<span class="tabular-nums">{localTimeOf(day.evaluatedStart, timeZone)}–{localTimeOf(day.evaluatedEnd, timeZone)}</span>
								{:else if day.segmentIds.length === 0}
									<span>{t('week.no_entries')}</span>
								{/if}
								{#if day.mark && day.mark !== 'none'}<Badge variant="outline">{markLabel(day.mark)}</Badge>{/if}
								{#if day.provisional && day.date <= today}<Badge variant="secondary">{t('day.provisional')}</Badge>{/if}
								{#if day.breakHints.length > 0}<Badge variant="outline">{t('week.hints', { count: day.breakHints.length })}</Badge>{/if}
							</span>
							<span class="text-right text-sm tabular-nums sm:order-3" title={t('day.target')}>
								<span class="text-muted-foreground">{t('week.target_short')}</span> {formatDuration(day.targetSeconds)}
							</span>
							<span class="hidden text-right text-sm tabular-nums sm:order-4 sm:inline" title={t('day.evaluated')}>
								<span class="text-muted-foreground">{t('week.evaluated_short')}</span> {formatDuration(day.evaluatedWorkSeconds + day.creditSeconds)}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</CardContent>
	</Card>
	<dl class="mt-4 grid grid-cols-3 gap-4 text-sm" data-testid="week-totals">
		<div><dt class="text-muted-foreground">{t('week.total_target')}</dt><dd class="text-lg font-medium tabular-nums">{formatDuration(totals.target)}</dd></div>
		<div><dt class="text-muted-foreground">{t('week.total_evaluated')}</dt><dd class="text-lg font-medium tabular-nums">{formatDuration(totals.evaluated)}</dd></div>
		<div><dt class="text-muted-foreground">{t('week.total_delta')}</dt><dd class="text-lg font-semibold tabular-nums {totals.delta < 0 ? 'text-destructive' : ''}">{formatDelta(totals.delta)}</dd></div>
	</dl>
	<p class="mt-3 text-xs text-muted-foreground">{t('week.note')}</p>
{/if}
