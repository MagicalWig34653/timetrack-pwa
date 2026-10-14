<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { Place, Segment, SegmentKind } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { fromLocalInputValue, localTimeOf, toLocalInputValue } from '#lib/time/dates.js';
	import { kindLabel, SEGMENT_KINDS } from '#lib/time/labels.js';
	import { untrack } from 'svelte';

	let {
		segment = null,
		date,
		places,
		timeZone,
		onsaved,
		oncancel
	}: {
		/** null = create a manual segment, otherwise correct this segment */
		segment?: Segment | null;
		/** local day used as default for new segments */
		date: string;
		places: Place[];
		timeZone: string;
		onsaved: (segment: Segment) => void;
		oncancel: () => void;
	} = $props();

	// Initial values are read once: the form is re-created per editing session.
	/* svelte-ignore state_referenced_locally */
	const initial = segment;
	let kind = $state<SegmentKind>(initial?.kind ?? 'work');
	let placeId = $state(initial?.placeId ?? '');
	let startedAt = $state(untrack(() => (initial ? toLocalInputValue(initial.startedAt, timeZone) : `${date}T08:00`)));
	let endedAt = $state(untrack(() => (initial?.endedAt ? toLocalInputValue(initial.endedAt, timeZone) : '')));
	let note = $state(initial?.note ?? '');
	let reason = $state('');
	let pending = $state(false);
	let formError = $state('');
	let errors = $state<{ startedAt?: string; endedAt?: string; reason?: string }>({});
	/** Server copy that superseded ours (412 stale_version). */
	let conflict = $state<Segment | null>(null);

	const correcting = $derived(initial !== null);

	function validate() {
		const next: typeof errors = {};
		const start = fromLocalInputValue(startedAt, timeZone);
		const end = endedAt ? fromLocalInputValue(endedAt, timeZone) : null;
		if (!start) next.startedAt = t('segment_form.start_required');
		if (endedAt && !end) next.endedAt = t('segment_form.end_invalid');
		else if (start && end && end.getTime() <= start.getTime()) next.endedAt = t('segment_form.end_before_start');
		if (correcting && !reason.trim()) next.reason = t('segment_form.reason_required');
		errors = next;
		return Object.keys(next).length === 0 ? { start: start!, end } : null;
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		const valid = validate();
		if (!valid) return;
		pending = true;
		try {
			const common = {
				kind,
				placeId: placeId || null,
				startedAt: valid.start.toISOString(),
				endedAt: valid.end ? valid.end.toISOString() : null,
				note: note.trim() || null
			};
			const saved = initial
				? await api.correctSegment(initial.id, { ...common, reason: reason.trim() }, (conflict ?? initial).version)
				: await api.createSegment(common);
			conflict = null;
			onsaved(saved);
		} catch (e) {
			if (initial && e instanceof ApiError && e.code === 'stale_version') {
				await loadConflict();
			} else formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function loadConflict() {
		if (!initial) return;
		try {
			const around = Date.parse(initial.rawStartedAt);
			const list = await api.listSegments(new Date(around - 36 * 3600_000).toISOString(), new Date(around + 36 * 3600_000).toISOString(), true);
			conflict = list.find((s) => s.id === initial.id) ?? null;
			if (!conflict) formError = errorMessage(new ApiError(404, 'not_found'));
		} catch (e) {
			formError = errorMessage(e);
		}
	}

	const range = (s: Segment) => `${localTimeOf(s.startedAt, timeZone)}–${s.endedAt ? localTimeOf(s.endedAt, timeZone) : t('timeline.running')}`;
	const myRange = $derived.by(() => {
		const start = fromLocalInputValue(startedAt, timeZone);
		const end = endedAt ? fromLocalInputValue(endedAt, timeZone) : null;
		return `${start ? localTimeOf(start, timeZone) : '?'}–${end ? localTimeOf(end, timeZone) : t('timeline.running')}`;
	});
</script>

<form class="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4" onsubmit={submit} novalidate aria-label={correcting ? t('segment_form.correct_title') : t('segment_form.create_title')}>
	<h3 class="font-medium">{correcting ? t('segment_form.correct_title') : t('segment_form.create_title')}</h3>
	{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}
	{#if conflict}
		<Alert variant="warning" data-testid="stale-conflict">
			<p class="font-medium">{t('segment_form.stale_title')}</p>
			<p class="mt-1">{t('segment_form.stale_text')}</p>
			<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				<dt class="text-muted-foreground">{t('segment_form.stale_current')}</dt>
				<dd class="tabular-nums">{#if conflict.voided}{t('segments.voided')}{:else}{range(conflict)} · {kindLabel(conflict.kind)}{/if}</dd>
				<dt class="text-muted-foreground">{t('segment_form.stale_mine')}</dt>
				<dd class="tabular-nums">{myRange} · {kindLabel(kind)}</dd>
			</dl>
			<p class="mt-2 text-xs">{t('segment_form.stale_hint')}</p>
		</Alert>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		<Field id="seg-start" type="datetime-local" label={t('segment_form.start')} bind:value={startedAt} error={errors.startedAt} disabled={pending} required />
		<Field id="seg-end" type="datetime-local" label={t('segment_form.end')} hint={t('segment_form.end_hint')} bind:value={endedAt} error={errors.endedAt} disabled={pending} />
		<div class="flex flex-col gap-1.5">
			<Label for="seg-kind">{t('segment_form.kind')}</Label>
			<Select id="seg-kind" bind:value={kind} disabled={pending}>
				{#each SEGMENT_KINDS as option (option)}<option value={option}>{kindLabel(option)}</option>{/each}
			</Select>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="seg-place">{t('segment_form.place')}</Label>
			<Select id="seg-place" bind:value={placeId} disabled={pending}>
				<option value="">{t('timer.no_place')}</option>
				{#each places as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
			</Select>
		</div>
	</div>
	<Field id="seg-note" label={t('segment_form.note')} bind:value={note} maxlength={500} disabled={pending} />
	{#if correcting}
		<Field id="seg-reason" label={t('segment_form.reason')} hint={t('segment_form.reason_hint')} bind:value={reason} error={errors.reason} maxlength={200} disabled={pending} required />
	{/if}
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={pending}>
			{#if conflict}{t('segment_form.apply_to_new')}{:else}{t('common.save')}{/if}
		</Button>
		<Button type="button" variant="outline" onclick={oncancel} disabled={pending}>
			{conflict ? t('segment_form.discard') : t('common.cancel')}
		</Button>
	</div>
</form>
