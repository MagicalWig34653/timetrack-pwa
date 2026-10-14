<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { VacationBalance, VacationSettings } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import VacationBalanceCard from '#lib/components/planning/VacationBalanceCard.svelte';
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
	/** null = not configured on the server (404); the form then offers the ADR-0005 defaults as a suggestion. */
	let settings = $state<VacationSettings | null>(null);
	let settingsLoaded = $state(false);
	let today = $state(todayLocal(zoneStore.value));

	async function refresh() {
		try {
			const zone = await zoneStore.ensure();
			today = todayLocal(zone);
			balance = await api.getVacationBalance(year);
			try {
				settings = await api.getVacationSettings();
			} catch (e) {
				// The balance endpoint exists, so a 404 here means "not configured yet".
				if (e instanceof ApiError && e.status === 404) settings = null;
				else throw e;
			}
			settingsLoaded = true;
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

<PageHeader title={t('vacation.title')} description={t('vacation.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else if balance}
	<div class="flex flex-col gap-4">
		<nav class="flex items-center gap-2" aria-label={t('vacation.year_nav')}>
			<Button variant="outline" size="icon" aria-label={t('vacation.previous_year')} onclick={() => shiftYear(-1)}><ChevronLeft /></Button>
			<span class="min-w-16 text-center font-medium tabular-nums" data-testid="vacation-year">{year}</span>
			<Button variant="outline" size="icon" aria-label={t('vacation.next_year')} onclick={() => shiftYear(1)}><ChevronRight /></Button>
			<span class="ml-auto flex gap-2 text-sm">
				<a class="underline underline-offset-4" href="/absences">{t('nav.absences')}</a>
				<a class="underline underline-offset-4" href="/calendar">{t('nav.calendar')}</a>
			</span>
		</nav>
		{#if settingsLoaded && settings === null}
			<Alert variant="warning" data-testid="settings-missing">{t('vacation.not_configured')}</Alert>
		{/if}
		<VacationBalanceCard {balance} {settings} />
		<VacationEntryForms {today} onsaved={saved} />
		<VacationSettingsForm {settings} onsaved={(next) => { settings = next; void refresh(); }} />
	</div>
{/if}
