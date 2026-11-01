<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { Absence, VacationBalance, VacationEntries, VacationSettings } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import VacationBalanceCard from '#lib/components/planning/VacationBalanceCard.svelte';
	import VacationEntryList from '#lib/components/planning/VacationEntryList.svelte';
	import VacationEntryForms from '#lib/components/planning/VacationEntryForms.svelte';
	import VacationSettingsForm from '#lib/components/planning/VacationSettingsForm.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { todayLocal } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let year = $state(Number(todayLocal(zoneStore.value).slice(0, 4)));
	let balance = $state<VacationBalance | null>(null);
	/** GET vacation/settings always answers 200; `configured: false` means the defaults are not saved yet (v0.3.1). */
	let settings = $state<VacationSettings | null>(null);
	let entries = $state<VacationEntries>({ snapshots: [], adjustments: [] });
	let today = $state(todayLocal(zoneStore.value));
	/** null when the absences cannot be read (planning module off): the balance card then shows the combined figure. */
	let absences = $state<Absence[] | null>(null);

	async function refresh() {
		try {
			const zone = await zoneStore.ensure();
			today = todayLocal(zone);
			balance = await api.getVacationBalance(year);
			settings = await api.getVacationSettings();
			entries = await api.listVacationEntries(year);
			absences = await api.listAbsences(`${year}-01-01`, `${year}-12-31`).catch(() => null);
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}
	onMount(refresh);

	function shiftYear(delta: number) {
		year += delta;
		void refresh();
	}

	function saved(next: VacationBalance) {
		year = next.year;
		balance = next;
		void refresh();
	}
</script>

<PageHeader title={t('vacation.title')} description={t('vacation.description')}>
	{#snippet primary()}
		<Button href="/vacation/planner" data-testid="open-planner">{t('planner.open')}</Button>
	{/snippet}
</PageHeader>

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else if balance}
	<div class="flex flex-col gap-4">
		<nav class="flex flex-wrap items-center gap-2" aria-label={t('vacation.year_nav')}>
			<Button variant="outline" size="icon" aria-label={t('vacation.previous_year')} onclick={() => shiftYear(-1)}><ChevronLeft /></Button>
			<span class="min-w-16 text-center font-medium tabular-nums" data-testid="vacation-year">{year}</span>
			<Button variant="outline" size="icon" aria-label={t('vacation.next_year')} onclick={() => shiftYear(1)}><ChevronRight /></Button>
			<span class="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-sm">
				<a class="underline underline-offset-4" href="/absences">{t('nav.absences')}</a>
				<a class="underline underline-offset-4" href="/calendar">{t('nav.calendar')}</a>
				<a class="underline underline-offset-4" href="/settings/vacation-form" data-testid="vacation-form-link">{t('vform.settings_link')}</a>
			</span>
		</nav>
		<VacationBalanceCard {balance} {settings} {absences} />
		<VacationEntryForms {today} onsaved={saved} />
		<VacationEntryList {year} {entries} ondeleted={refresh} />
		{#if settings}
			<div id="vacation-settings" class="scroll-mt-20">
				{#key year}
					<VacationSettingsForm {settings} {year} onsaved={(next) => { settings = next; void refresh(); }} />
				{/key}
			</div>
		{/if}
	</div>
{/if}
