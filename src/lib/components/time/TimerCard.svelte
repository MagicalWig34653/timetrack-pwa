<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { Place, Segment, SegmentKind } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { localTimeOf } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { newEventId, retryOnNetworkError } from '#lib/time/idempotent.js';
	import { kindLabel, SEGMENT_KINDS } from '#lib/time/labels.js';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';

	let {
		running,
		places,
		now,
		timeZone,
		onchange,
		retryDelayMs = 400
	}: {
		running: Segment | null;
		places: Place[];
		/** epoch ms, ticking once per second in the parent */
		now: number;
		timeZone: string;
		/** called with the new timer state (segment while running, null after stop) */
		onchange: (segment: Segment | null, stopped?: Segment) => void;
		retryDelayMs?: number;
	} = $props();

	let placeId = $state('');
	let kind = $state<SegmentKind>('work');
	let pending = $state(false);
	let error = $state('');
	// One id per click intent: kept across automatic retries so the server can deduplicate.
	let eventId: string | null = null;

	const elapsedSeconds = $derived(running ? Math.max(0, Math.floor((now - Date.parse(running.startedAt)) / 1000)) : 0);
	const runningPlace = $derived(running?.placeId ? places.find((p) => p.id === running.placeId) : undefined);

	function pickPlace(event: Event) {
		placeId = (event.currentTarget as HTMLSelectElement).value;
		const place = places.find((p) => p.id === placeId);
		if (place?.defaultSegmentKind) kind = place.defaultSegmentKind;
	}

	async function toggle() {
		if (pending) return;
		pending = true;
		error = '';
		eventId = newEventId();
		const clientEventId = eventId;
		try {
			if (running) {
				const stopped = await retryOnNetworkError(() => api.stopTimer({ clientEventId }), { delayMs: retryDelayMs });
				onchange(null, stopped);
			} else {
				const started = await retryOnNetworkError(
					() => api.startTimer({ clientEventId, kind, placeId: placeId || null }),
					{ delayMs: retryDelayMs }
				);
				onchange(started);
			}
		} catch (e) {
			error = errorMessage(e);
			// The state may have changed elsewhere (e.g. Shortcut): re-read it after a conflict.
			if (e instanceof ApiError && e.status === 409) {
				try {
					onchange(await api.currentTimer());
				} catch {
					// keep the original message
				}
			}
		} finally {
			pending = false;
			eventId = null;
		}
	}
</script>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			{t('timer.title')}
			{#if running}<Badge variant="secondary">{t('timer.running')}</Badge>{/if}
		</CardTitle>
		<CardDescription>
			{#if running}
				{t('timer.since', { time: localTimeOf(running.startedAt, timeZone) })}
				{#if runningPlace}· {runningPlace.name}{/if}
				· {kindLabel(running.kind)}
			{:else}
				{t('timer.idle')}
			{/if}
		</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-4">
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		{#if running}
			<p class="text-4xl font-semibold tabular-nums tracking-tight" data-testid="elapsed" aria-label={t('timer.elapsed_label')}>
				{formatDuration(elapsedSeconds)}
				<span class="text-lg text-muted-foreground">{String(elapsedSeconds % 60).padStart(2, '0')}</span>
			</p>
		{:else}
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="timer-place">{t('timer.place')}</Label>
					<Select id="timer-place" value={placeId} onchange={pickPlace} disabled={pending}>
						<option value="">{t('timer.no_place')}</option>
						{#each places as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
					</Select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="timer-kind">{t('timer.kind')}</Label>
					<Select id="timer-kind" bind:value={kind} disabled={pending}>
						{#each SEGMENT_KINDS as option (option)}<option value={option}>{kindLabel(option)}</option>{/each}
					</Select>
				</div>
			</div>
		{/if}
		<div>
			<Button size="lg" class="w-full sm:w-auto" variant={running ? 'destructive' : 'default'} onclick={toggle} disabled={pending} aria-busy={pending}>
				{#if running}<SquareIcon />{t('timer.stop')}{:else}<PlayIcon />{t('timer.start')}{/if}
			</Button>
		</div>
	</CardContent>
</Card>
