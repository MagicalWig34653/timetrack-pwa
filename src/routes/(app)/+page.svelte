<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { DayEvaluation, Place, Segment, Suggestion, TimeAccount } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import DaySummary from '#lib/components/time/DaySummary.svelte';
	import DayTimeline from '#lib/components/time/DayTimeline.svelte';
	import ReportsTeaser from '#lib/components/reports/ReportsTeaser.svelte';
	import SegmentList from '#lib/components/time/SegmentList.svelte';
	import TimerCard from '#lib/components/time/TimerCard.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { dayBounds, formatDateLong, todayLocal } from '#lib/time/dates.js';
	import { formatDelta } from '#lib/time/format.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	const name = $derived(sessionStore.current?.account.displayName ?? '');
	let load = $state<LoadState>({ status: 'loading' });
	let now = $state(Date.now());
	let running = $state<Segment | null>(null);
	let day = $state<DayEvaluation | null>(null);
	let segments = $state<Segment[]>([]);
	let places = $state<Place[]>([]);
	let account = $state<TimeAccount | null>(null);
	let suggestions = $state<Suggestion[]>([]);

	const timeZone = $derived(zoneStore.value);
	const today = $derived(todayLocal(timeZone, new Date(now)));

	async function refresh() {
		try {
			const zone = await zoneStore.ensure();
			const date = todayLocal(zone);
			const { start, end } = dayBounds(date, zone);
			const [timer, evaluation, daySegments, placeList, balance, open] = await Promise.all([
				api.currentTimer(),
				api.getDay(date),
				api.listSegments(start.toISOString(), end.toISOString()),
				api.listPlaces(),
				api.getTimeAccount(),
				api.listSuggestions()
			]);
			running = timer;
			day = evaluation;
			segments = daySegments;
			places = placeList;
			account = balance;
			suggestions = open;
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}

	function onTimerChange(segment: Segment | null) {
		running = segment;
		void refresh();
	}

	onMount(() => {
		void refresh();
		const tick = setInterval(() => (now = Date.now()), 1000);
		const poll = setInterval(() => void refresh(), 60_000);
		return () => {
			clearInterval(tick);
			clearInterval(poll);
		};
	});
</script>

<PageHeader title={t('home.title', { name })} description={t('home.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		{#if suggestions.length > 0}
			<Alert data-testid="suggestions-notice">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span>{t('home.suggestions_open', { count: suggestions.length })}</span>
					<Button variant="outline" size="sm" href="/suggestions">{t('home.suggestions_review')}</Button>
				</div>
			</Alert>
		{/if}

		<TimerCard {running} {places} {now} {timeZone} onchange={onTimerChange} />

		<Card>
			<CardHeader>
				<CardTitle>{t('home.today')}</CardTitle>
				<CardDescription>{formatDateLong(today)}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-5">
				{#if day}<DaySummary evaluation={day} />{/if}
				<DayTimeline date={today} {timeZone} {segments} evaluation={day} {now} />
				{#if segments.length > 0}<SegmentList {segments} {places} {timeZone} {now} />{/if}
				<div><Button variant="outline" size="sm" href="/time/{today}">{t('home.open_day')}</Button></div>
			</CardContent>
		</Card>

		{#if account}
			<Card>
				<CardHeader>
					<CardTitle>{t('home.balance')}</CardTitle>
					<CardDescription>
						{account.accountStart ? t('home.balance_since', { date: account.accountStart.split('-').reverse().join('.') }) : t('home.balance_no_start')}
					</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-wrap items-baseline gap-3">
					<span class="text-3xl font-semibold tabular-nums {account.balanceSeconds < 0 ? 'text-destructive' : ''}" data-testid="balance">{formatDelta(account.balanceSeconds)}</span>
					{#if account.provisional}<span class="text-sm text-muted-foreground">{t('home.balance_provisional')}</span>{/if}
					<Button variant="ghost" size="sm" href="/settings/account-time">{t('home.balance_manage')}</Button>
				</CardContent>
			</Card>
		{/if}

		<ReportsTeaser />
	</div>
{/if}
