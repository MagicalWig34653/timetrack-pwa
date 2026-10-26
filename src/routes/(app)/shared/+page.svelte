<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { IncomingShare, SharedView } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import NeverShared from '#lib/components/planning/NeverShared.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { PLAN_CLASSES, planModeLabel, SHARE_SCOPE_KEYS, scopeLabel } from '#lib/planning/labels.js';
	import { addDays, formatDateNumeric, formatDateShort, isValidDate, localTimeOf, startOfWeek, todayLocal } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let incoming = $state<IncomingShare[]>([]);
	let selectedId = $state<string | null>(null);
	let from = $state('');
	let to = $state('');
	let view = $state<SharedView | null>(null);
	let viewError = $state('');
	let viewPending = $state(false);
	let rangeError = $state('');

	const selected = $derived(incoming.find((s) => s.id === selectedId) ?? null);
	const timeZone = $derived(zoneStore.value);

	async function refresh() {
		try {
			const zone = await zoneStore.ensure();
			incoming = await api.listIncomingShares();
			if (!from) {
				from = startOfWeek(todayLocal(zone));
				to = addDays(from, 27);
			}
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	async function open(share: IncomingShare) {
		selectedId = share.id;
		await loadView();
	}

	async function loadView() {
		if (!selectedId) return;
		viewError = '';
		rangeError = '';
		if (!isValidDate(from) || !isValidDate(to) || to < from) {
			rangeError = t('shared.error_range');
			return;
		}
		viewPending = true;
		try {
			view = await api.viewShared(selectedId, from, to);
		} catch (e) {
			view = null;
			if (e instanceof ApiError && e.status === 404) {
				// Revoked (or never ours): the share is gone immediately.
				viewError = t('shared.gone');
				selectedId = null;
				await refresh();
			} else viewError = errorMessage(e);
		} finally {
			viewPending = false;
		}
	}

	const ranges = (item: { startDate: string; endDate: string }) =>
		item.startDate === item.endDate ? formatDateNumeric(item.startDate) : `${formatDateNumeric(item.startDate)}–${formatDateNumeric(item.endDate)}`;
</script>

<PageHeader title={t('shared.title')} description={t('shared.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<NeverShared variant="incoming" />
		{#if viewError}<Alert variant="warning" data-testid="shared-error">{viewError}</Alert>{/if}

		{#if incoming.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="incoming-empty">{t('shared.empty')}</p>
		{:else}
			<ul class="grid gap-3 sm:grid-cols-2" data-testid="incoming-list" aria-label={t('shared.list_label')}>
				{#each incoming as share (share.id)}
					<li>
						<button
							type="button"
							class="flex w-full flex-col items-start gap-2 rounded-lg border bg-card p-3 text-left hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none {selectedId === share.id ? 'ring-2 ring-primary' : ''}"
							aria-pressed={selectedId === share.id}
							onclick={() => open(share)}
						>
							<span class="font-medium">{share.ownerDisplayName}</span>
							<span class="flex flex-wrap gap-1">
								{#each SHARE_SCOPE_KEYS.filter((k) => share.scopes[k]) as key (key)}<Badge variant="secondary">{scopeLabel(key)}</Badge>{/each}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if selected}
			<Card data-testid="shared-view">
				<CardHeader>
					<CardTitle><h2 class="text-lg">{t('shared.view_title', { name: selected.ownerDisplayName })}</h2></CardTitle>
					<CardDescription>{t('shared.view_text')}</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-5">
					<form class="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" onsubmit={(e) => { e.preventDefault(); void loadView(); }} novalidate aria-label={t('shared.range')}>
						<Field id="shared-from" type="date" label={t('shared.from')} bind:value={from} disabled={viewPending} />
						<Field id="shared-to" type="date" label={t('shared.to')} bind:value={to} error={rangeError} disabled={viewPending} />
						<div><Button type="submit" disabled={viewPending}>{t('shared.load')}</Button></div>
					</form>

					{#if view}
						{#if view.plan}
							<section aria-labelledby="shared-plan-h">
								<h3 id="shared-plan-h" class="mb-2 font-medium">{scopeLabel('plan')}</h3>
								{#if view.plan.length === 0}
									<p class="text-sm text-muted-foreground">{t('shared.none_in_range')}</p>
								{:else}
									<ul class="grid gap-1 text-sm sm:grid-cols-2" data-testid="shared-plan">
										{#each view.plan as day (day.date)}
											<li class="flex items-center justify-between gap-2 rounded border px-2 py-1">
												<span class="tabular-nums">{formatDateShort(day.date)}</span>
												<span class="rounded px-1.5 py-0.5 text-xs {PLAN_CLASSES[day.mode]}">{planModeLabel(day.mode)}</span>
											</li>
										{/each}
									</ul>
								{/if}
							</section>
						{/if}
						{#if view.actual}
							<section aria-labelledby="shared-actual-h">
								<h3 id="shared-actual-h" class="mb-2 font-medium">{scopeLabel('actual')}</h3>
								{#if view.actual.length === 0}
									<p class="text-sm text-muted-foreground">{t('shared.none_in_range')}</p>
								{:else}
									<table class="w-full text-sm" data-testid="shared-actual">
										<thead>
											<tr class="text-left text-xs text-muted-foreground">
												<th scope="col" class="py-1 font-medium">{t('shared.col_date')}</th>
												<th scope="col" class="py-1 font-medium">{t('shared.col_time')}</th>
												<th scope="col" class="py-1 text-right font-medium">{t('shared.col_duration')}</th>
											</tr>
										</thead>
										<tbody>
											{#each view.actual as day (day.date)}
												<tr class="border-t">
													<td class="py-1 tabular-nums">{formatDateShort(day.date)}</td>
													<td class="py-1 tabular-nums">
														{#if day.evaluatedStart && day.evaluatedEnd}{localTimeOf(day.evaluatedStart, timeZone)}–{localTimeOf(day.evaluatedEnd, timeZone)}{:else}–{/if}
													</td>
													<td class="py-1 text-right tabular-nums">{timeDisplay.duration(day.evaluatedWorkSeconds)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								{/if}
							</section>
						{/if}
						{#if view.vacation}
							<section aria-labelledby="shared-vacation-h">
								<h3 id="shared-vacation-h" class="mb-2 font-medium">{scopeLabel('vacation')}</h3>
								{#if view.vacation.length === 0}
									<p class="text-sm text-muted-foreground">{t('shared.none_in_range')}</p>
								{:else}
									<ul class="flex flex-col gap-1 text-sm" data-testid="shared-vacation">
										{#each view.vacation as period (period.startDate + period.endDate)}
											<li class="tabular-nums">{ranges(period)}</li>
										{/each}
									</ul>
								{/if}
							</section>
						{/if}
						{#if !view.plan && !view.actual && !view.vacation}
							<p class="text-sm text-muted-foreground">{t('shared.nothing_shared')}</p>
						{/if}
					{/if}
				</CardContent>
			</Card>
		{/if}
	</div>
{/if}
