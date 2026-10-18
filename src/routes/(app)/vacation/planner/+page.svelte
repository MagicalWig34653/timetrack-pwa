<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { VacationSuggestions } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import TimelineLegend from '#lib/components/planning/TimelineLegend.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import VacationSuggestionCard from '#lib/components/planning/VacationSuggestionCard.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { t } from '#lib/i18n/index.js';
	import { todayLocal } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import {
		clearFilters,
		defaultFilters,
		FETCH_LIMIT,
		filtersValid,
		formatDays,
		formatFactor,
		loadFilters,
		rangeValid,
		saveFilters,
		visibleSuggestions,
		type PlannerFilters
	} from '#lib/vacation/planner.js';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let today = $state(todayLocal(zoneStore.value));
	let filters = $state<PlannerFilters>(defaultFilters(todayLocal(zoneStore.value)));
	/** Filters the shown data was fetched with (period and limits that the server applies). */
	let applied = $state<PlannerFilters | null>(null);
	let data = $state<VacationSuggestions | null>(null);
	let notice = $state<{ text: string; partial: boolean } | null>(null);
	let sequence = 0;

	const draftValid = $derived(filtersValid(filters));
	const rangeOk = $derived(rangeValid(filters.from, filters.to));
	const view = $derived(data ? visibleSuggestions(data.suggestions, filters.minEfficiency, filters.count) : { shown: [], hidden: 0 });
	const budgetYear = $derived(data ? data.from.slice(0, 4) : '');
	const stale = $derived(
		!!applied && (applied.from !== filters.from || applied.to !== filters.to || applied.maxVacationDays !== filters.maxVacationDays || applied.minDaysOff !== filters.minDaysOff)
	);

	async function fetchSuggestions(next: PlannerFilters) {
		const mine = ++sequence;
		load = { status: 'loading' };
		try {
			const result = await api.getVacationSuggestions({
				from: next.from,
				to: next.to,
				maxVacationDays: next.maxVacationDays,
				minDaysOff: next.minDaysOff,
				limit: FETCH_LIMIT
			});
			if (mine !== sequence) return;
			data = result;
			applied = { ...next };
			load = { status: 'ready' };
		} catch (error) {
			if (mine !== sequence) return;
			load = toLoadState(error);
		}
	}

	onMount(async () => {
		try {
			today = todayLocal(await zoneStore.ensure());
		} catch {
			/* the page still works with the browser day */
		}
		filters = loadFilters(today);
		await fetchSuggestions(filters);
	});

	function apply(event?: Event) {
		event?.preventDefault();
		if (!draftValid) return;
		saveFilters(filters);
		void fetchSuggestions(filters);
	}

	/** Display-only filters take effect immediately and are remembered like the rest. */
	function liveChanged() {
		if (draftValid) saveFilters(filters);
	}

	function reset() {
		clearFilters();
		filters = defaultFilters(today);
		void fetchSuggestions(filters);
	}

	function taken(text: string, partial = false) {
		notice = text ? { text, partial } : null;
		void fetchSuggestions(applied ?? filters);
	}

	function numberInput(key: 'maxVacationDays' | 'minDaysOff' | 'count' | 'minEfficiency', event: Event) {
		const raw = (event.currentTarget as HTMLInputElement).value.replace(',', '.');
		filters[key] = raw === '' ? Number.NaN : Number(raw);
	}
</script>

<PageHeader title={t('planner.title')} description={t('planner.description')}>
	{#snippet secondary()}
		<Button href="/vacation" variant="outline"><ChevronLeft aria-hidden="true" />{t('planner.back')}</Button>
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-4">
	{#if data}
		<Card data-testid="planner-budget">
			<CardHeader><CardTitle>{t('planner.budget_title', { year: budgetYear })}</CardTitle></CardHeader>
			<CardContent class="flex flex-col gap-3">
				<dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<div><dt class="text-sm text-muted-foreground">{t('planner.budget_entitlement')}</dt><dd class="text-2xl font-semibold tabular-nums" data-testid="budget-entitlement">{formatDays(data.budget.entitlementDays)}</dd></div>
					<div><dt class="text-sm text-muted-foreground">{t('planner.budget_taken')}</dt><dd class="text-2xl font-semibold tabular-nums" data-testid="budget-taken">{formatDays(data.budget.takenDays)}</dd></div>
					<div><dt class="text-sm text-muted-foreground">{t('planner.budget_planned')}</dt><dd class="text-2xl font-semibold tabular-nums" data-testid="budget-planned">{formatDays(data.budget.plannedDays)}</dd></div>
					<div><dt class="text-sm text-muted-foreground">{t('planner.budget_remaining')}</dt><dd class="text-2xl font-semibold tabular-nums {data.budget.remainingDays < 0 ? 'text-destructive' : ''}" data-testid="budget-remaining">{formatDays(data.budget.remainingDays)}</dd></div>
				</dl>
				<p class="text-xs text-muted-foreground">{t('planner.budget_note')}</p>
			</CardContent>
		</Card>
	{/if}

	<Card data-testid="planner-filters">
		<CardHeader><CardTitle>{t('planner.filters_title')}</CardTitle></CardHeader>
		<CardContent>
			<form class="flex flex-col gap-4" onsubmit={apply}>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<div class="flex flex-col gap-1.5">
						<Label for="pl-from">{t('planner.filter_from')}</Label>
						<Input id="pl-from" type="date" bind:value={filters.from} required />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="pl-to">{t('planner.filter_to')}</Label>
						<Input id="pl-to" type="date" bind:value={filters.to} required />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="pl-max">{t('planner.filter_max_days')}</Label>
						<Input id="pl-max" type="number" inputmode="numeric" min="1" max="60" step="1" value={Number.isNaN(filters.maxVacationDays) ? '' : filters.maxVacationDays} oninput={(e) => numberInput('maxVacationDays', e)} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="pl-off">{t('planner.filter_min_off')}</Label>
						<Input id="pl-off" type="number" inputmode="numeric" min="1" max="60" step="1" value={Number.isNaN(filters.minDaysOff) ? '' : filters.minDaysOff} oninput={(e) => numberInput('minDaysOff', e)} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="pl-eff">{t('planner.filter_min_efficiency')}</Label>
						<Input id="pl-eff" type="number" inputmode="decimal" min="1" max="10" step="0.5" value={Number.isNaN(filters.minEfficiency) ? '' : filters.minEfficiency} oninput={(e) => numberInput('minEfficiency', e)} onchange={liveChanged} />
						<p class="text-xs text-muted-foreground">{t('planner.filter_min_efficiency_hint')}</p>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="pl-count">{t('planner.filter_count')}</Label>
						<Input id="pl-count" type="number" inputmode="numeric" min="1" max="100" step="1" value={Number.isNaN(filters.count) ? '' : filters.count} oninput={(e) => numberInput('count', e)} onchange={liveChanged} />
					</div>
				</div>
				{#if !rangeOk}<p class="text-sm text-destructive" data-testid="filter-range-error">{t('planner.filter_range_invalid')}</p>
				{:else if !draftValid}<p class="text-sm text-destructive" data-testid="filter-number-error">{t('planner.filter_number_invalid')}</p>{/if}
				<div class="flex flex-wrap items-center gap-2">
					<Button type="submit" disabled={!draftValid || load.status === 'loading'} data-testid="filter-apply" variant={stale ? 'default' : 'outline'}>{t('planner.filter_apply')}</Button>
					<Button type="button" variant="ghost" onclick={reset}>{t('planner.filter_reset')}</Button>
					<span class="text-xs text-muted-foreground">{t('planner.filter_saved')}</span>
				</div>
			</form>
		</CardContent>
	</Card>

	{#if notice}
		<Alert variant={notice.partial ? 'warning' : 'success'} data-testid="planner-notice" class="flex flex-wrap items-center justify-between gap-2">
			<span>{notice.text}</span>
			<a class="underline underline-offset-4" href="/absences">{t('planner.take_open_absences')}</a>
		</Alert>
	{/if}

	{#if load.status === 'unavailable'}
		<Unavailable />
	{:else if load.status === 'error'}
		<Alert variant="destructive" data-testid="planner-error" class="flex flex-wrap items-center justify-between gap-2">
			<span>{load.message}</span>
			<Button variant="outline" size="sm" onclick={() => fetchSuggestions(applied ?? filters)}>{t('planner.retry')}</Button>
		</Alert>
	{:else if load.status === 'loading' && !data}
		<p class="text-sm text-muted-foreground" data-testid="planner-loading">{t('planner.loading')}</p>
	{:else if data}
		<div class="flex flex-col gap-3" aria-busy={load.status === 'loading'}>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-lg font-semibold" data-testid="planner-count">{view.shown.length === 1 ? t('planner.results_one') : t('planner.results', { count: view.shown.length })}</h2>
				<TimelineLegend />
			</div>
			{#if view.hidden > 0}
				<p class="text-sm text-muted-foreground" data-testid="planner-hidden">
					{view.hidden === 1 ? t('planner.hidden_low_one', { factor: formatFactor(filters.minEfficiency) }) : t('planner.hidden_low', { count: view.hidden, factor: formatFactor(filters.minEfficiency) })}
					<button type="button" class="underline underline-offset-4" data-testid="planner-show-all" onclick={() => { filters.minEfficiency = 1; liveChanged(); }}>{t('planner.show_low')}</button>
				</p>
			{/if}
			{#if view.shown.length === 0}
				<Alert data-testid="planner-empty">{data.suggestions.length > 0 ? t('planner.empty_hidden') : t('planner.empty')}</Alert>
			{:else}
				<div class="grid gap-4 xl:grid-cols-2">
					{#each view.shown as suggestion (suggestion.id)}
						<VacationSuggestionCard {suggestion} ontaken={taken} />
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
