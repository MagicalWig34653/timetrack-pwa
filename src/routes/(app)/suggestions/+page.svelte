<script lang="ts">
	import { api } from '#lib/api/client.js';
	import { ApiError } from '#lib/api/errors.js';
	import type { Place, Suggestion } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, fromLocalInputValue, localDateOf, localTimeOf, toLocalInputValue } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let suggestions = $state<Suggestion[]>([]);
	let places = $state<Place[]>([]);
	let notice = $state('');
	let error = $state('');
	let pending = $state(false);

	let acceptingId = $state<string | null>(null);
	let startValue = $state('');
	let endValue = $state('');
	let fieldErrors = $state<{ start?: string; end?: string }>({});

	const timeZone = $derived(zoneStore.value);
	const placeName = (id?: string | null) => (id ? (places.find((p) => p.id === id)?.name ?? t('place.archived_or_unknown')) : t('timer.no_place'));
	const when = (instant: string) => `${formatDateNumeric(localDateOf(instant, timeZone))} ${localTimeOf(instant, timeZone)}`;

	async function refresh() {
		try {
			await zoneStore.ensure();
			[suggestions, places] = await Promise.all([api.listSuggestions(), api.listPlaces()]);
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	function openAccept(s: Suggestion) {
		acceptingId = s.id;
		error = '';
		fieldErrors = {};
		startValue = s.proposedStartedAt ? toLocalInputValue(s.proposedStartedAt, timeZone) : '';
		endValue = s.proposedEndedAt ? toLocalInputValue(s.proposedEndedAt, timeZone) : '';
	}

	async function accept(s: Suggestion, event: Event) {
		event.preventDefault();
		if (pending) return;
		fieldErrors = {};
		const body: { startedAt?: string; endedAt?: string } = {};
		const start = startValue ? fromLocalInputValue(startValue, timeZone) : null;
		const end = endValue ? fromLocalInputValue(endValue, timeZone) : null;
		if (s.type === 'start') {
			if (!start) fieldErrors.start = t('segment_form.start_required');
			else body.startedAt = start.toISOString();
			if (endValue && !end) fieldErrors.end = t('segment_form.end_invalid');
			else if (end) body.endedAt = end.toISOString();
			if (start && end && end <= start) fieldErrors.end = t('segment_form.end_before_start');
		} else {
			if (!end) fieldErrors.end = t('segment_form.end_invalid');
			else body.endedAt = end.toISOString();
		}
		if (fieldErrors.start || fieldErrors.end) return;
		pending = true;
		error = '';
		try {
			await api.acceptSuggestion(s.id, body);
			acceptingId = null;
			notice = t('suggestions.accepted');
			await refresh();
		} catch (e) {
			error = errorMessage(e);
			if (e instanceof ApiError && e.code === 'suggestion_resolved') {
				// Already decided elsewhere (second device): drop the form and show the current list.
				acceptingId = null;
				await refresh();
			}
		} finally {
			pending = false;
		}
	}

	async function reject(s: Suggestion) {
		if (pending) return;
		pending = true;
		error = '';
		try {
			await api.rejectSuggestion(s.id);
			notice = t('suggestions.rejected');
			await refresh();
		} catch (e) {
			error = errorMessage(e);
			if (e instanceof ApiError && e.code === 'suggestion_resolved') await refresh();
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('suggestions.title')} description={t('suggestions.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<Alert>{t('suggestions.note')}</Alert>
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		{#if suggestions.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="suggestions-empty">{t('suggestions.empty')}</p>
		{/if}
		<ul class="flex flex-col gap-3" data-testid="suggestion-list">
			{#each suggestions as s (s.id)}
				<li>
					<Card>
						<CardHeader>
							<CardTitle class="flex flex-wrap items-center gap-2">
								{s.type === 'start' ? t('suggestions.type_start') : t('suggestions.type_end')}
								<Badge variant="outline">{placeName(s.placeId)}</Badge>
							</CardTitle>
							<CardDescription>
								{#if s.type === 'start' && s.proposedStartedAt}{t('suggestions.proposed_start', { time: when(s.proposedStartedAt) })}{/if}
								{#if s.type === 'end' && s.proposedEndedAt}{t('suggestions.proposed_end', { time: when(s.proposedEndedAt) })}{/if}
								· {t('suggestions.created', { time: when(s.createdAt) })}
							</CardDescription>
						</CardHeader>
						<CardContent>
							{#if acceptingId === s.id}
								<form class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" onsubmit={(e) => accept(s, e)} novalidate aria-label={t('suggestions.accept_title')}>
									<div class="grid gap-3 sm:grid-cols-2">
										{#if s.type === 'start'}
											<Field id="sug-start-{s.id}" type="datetime-local" label={t('segment_form.start')} bind:value={startValue} error={fieldErrors.start} disabled={pending} />
										{/if}
										<Field id="sug-end-{s.id}" type="datetime-local" label={t('segment_form.end')} hint={s.type === 'start' ? t('segment_form.end_hint') : undefined} bind:value={endValue} error={fieldErrors.end} disabled={pending} />
									</div>
									<div class="flex gap-2">
										<Button type="submit" size="sm" disabled={pending}>{t('suggestions.accept_confirm')}</Button>
										<Button type="button" variant="outline" size="sm" onclick={() => (acceptingId = null)}>{t('common.cancel')}</Button>
									</div>
								</form>
							{:else}
								<div class="flex flex-wrap gap-2">
									<Button size="sm" onclick={() => openAccept(s)} disabled={pending}>{t('suggestions.accept')}</Button>
									<Button variant="outline" size="sm" onclick={() => reject(s)} disabled={pending}>{t('suggestions.reject')}</Button>
								</div>
							{/if}
						</CardContent>
					</Card>
				</li>
			{/each}
		</ul>
	</div>
{/if}
