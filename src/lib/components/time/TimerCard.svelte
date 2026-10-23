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
	import {
		continueErrorMessage,
		continueNeedsReload,
		continueSegment,
		gapSeconds,
		LONG_GAP_SECONDS,
		restartLike
	} from '#lib/time/continue.js';
	import { newEventId, retryOnNetworkError } from '#lib/time/idempotent.js';
	import { kindLabel, SEGMENT_KINDS } from '#lib/time/labels.js';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SquareIcon from '@lucide/svelte/icons/square';

	let {
		running,
		places,
		now,
		timeZone,
		onchange,
		last = null,
		retryDelayMs = 400
	}: {
		running: Segment | null;
		places: Place[];
		/** epoch ms, ticking once per second in the parent */
		now: number;
		timeZone: string;
		/** called with the new timer state (segment while running, null after stop) */
		onchange: (segment: Segment | null, stopped?: Segment) => void;
		/** the finished segment that "Fortführen" would reopen (latest of today), if any */
		last?: Segment | null;
		retryDelayMs?: number;
	} = $props();

	let placeId = $state('');
	let kind = $state<SegmentKind>('work');
	let pending = $state(false);
	let error = $state('');
	let notice = $state('');
	// One id per click intent: kept across automatic retries so the server can deduplicate.
	let eventId: string | null = null;

	const elapsedSeconds = $derived(running ? Math.max(0, Math.floor((now - Date.parse(running.startedAt)) / 1000)) : 0);
	const runningPlace = $derived(running?.placeId ? places.find((p) => p.id === running.placeId) : undefined);

	const lastPlace = $derived(last?.placeId ? places.find((p) => p.id === last.placeId) : undefined);
	const lastGap = $derived(last ? gapSeconds(last, now) : 0);
	const longGap = $derived(lastGap > LONG_GAP_SECONDS);
	const continueLabel = $derived(
		last ? t('timer.continue', { kind: kindLabel(last.kind), time: localTimeOf(last.endedAt!, timeZone) }) : ''
	);

	/** Reopens the last segment (mode `reopen`) or starts a new one like it (mode `restart`, the gap stays a pause). */
	async function continueLast(mode: 'reopen' | 'restart') {
		if (pending || !last) return;
		pending = true;
		error = '';
		notice = '';
		const gap = formatDuration(lastGap);
		try {
			if (mode === 'restart') {
				const started = await restartLike(last, retryDelayMs);
				notice = t('timer.restarted');
				onchange(started);
			} else {
				const outcome = await continueSegment(last, retryDelayMs);
				notice = outcome.mode === 'reopened' ? t('timer.continued') : t('timer.continue_fallback', { duration: gap });
				onchange(outcome.segment);
			}
		} catch (e) {
			error = continueErrorMessage(e);
			// The list is stale (another device, Shortcut, trigger link): re-read the timer, which also reloads the day.
			if (continueNeedsReload(e)) {
				try {
					onchange(await api.currentTimer());
				} catch {
					// keep the original message
				}
			}
		} finally {
			pending = false;
		}
	}

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
			{#if running}<span class="glow-filter size-2 rounded-full bg-ui-accent" aria-hidden="true" data-testid="timer-dot"></span><Badge variant="secondary">{t('timer.running')}</Badge>{/if}
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
		{#if notice}<Alert data-testid="continue-notice">{notice}</Alert>{/if}
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
		{#if !running && last?.endedAt}
			<div class="flex flex-col gap-2 border-t pt-4" data-testid="continue-panel">
				{#if longGap}
					<p class="text-sm" data-testid="continue-hint">
						{t('timer.continue_long_hint', { time: localTimeOf(last.endedAt, timeZone), duration: formatDuration(lastGap) })}
					</p>
					<p class="text-sm text-muted-foreground">{continueLabel}{#if lastPlace} · {lastPlace.name}{/if}</p>
					<div class="flex flex-wrap gap-2">
						<Button variant="outline" onclick={() => continueLast('reopen')} disabled={pending} data-testid="continue-reopen">
							<RotateCcwIcon />{t('timer.continue_long')}
						</Button>
						<Button variant="outline" onclick={() => continueLast('restart')} disabled={pending} data-testid="continue-restart">
							<PlayIcon />{t('timer.restart_long')}
						</Button>
					</div>
				{:else}
					<div>
						<Button variant="outline" onclick={() => continueLast('reopen')} disabled={pending} data-testid="continue-reopen">
							<RotateCcwIcon />{continueLabel}
						</Button>
					</div>
					{#if lastPlace || lastGap >= 60}
						<p class="text-sm text-muted-foreground" data-testid="continue-hint">
							{#if lastPlace}{lastPlace.name}{#if lastGap >= 60} · {/if}{/if}{#if lastGap >= 60}{t('timer.continue_gap', { duration: formatDuration(lastGap) })}{/if}
						</p>
					{/if}
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>
