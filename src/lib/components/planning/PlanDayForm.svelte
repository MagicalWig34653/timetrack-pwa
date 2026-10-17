<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { Place, PlanDay, PlanMode } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { PLAN_MODES, planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { untrack } from 'svelte';

	let {
		date,
		plan = null,
		places = [],
		onsaved,
		oncancel
	}: { date: string; plan?: PlanDay | null; places?: Place[]; onsaved: () => void; oncancel: () => void } = $props();

	const initial = untrack(() => plan);
	let mode = $state<PlanMode>(initial?.mode ?? 'office');
	let placeId = $state(initial?.placeId ?? '');
	let note = $state(initial?.note ?? '');
	let formError = $state('');
	let pending = $state(false);

	async function save(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		pending = true;
		try {
			// PUT replaces the whole entry: planned times set in the week planner are carried over (the server drops them for mode off).
			await api.putPlanDay(date, {
				mode,
				placeId: placeId || null,
				note: note.trim() || null,
				...(initial?.plannedStart && initial.plannedEnd
					? { plannedStart: initial.plannedStart, plannedEnd: initial.plannedEnd, plannedBreakMinutes: initial.plannedBreakMinutes ?? null }
					: {})
			});
			onsaved();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function remove() {
		if (pending) return;
		formError = '';
		pending = true;
		try {
			await api.deletePlanDay(date);
			onsaved();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<form class="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4" onsubmit={save} novalidate aria-label={t('plan.form_title')} data-testid="plan-form">
	<h3 class="font-medium">{t('plan.form_title_date', { date: formatDateNumeric(date) })}</h3>
	<p class="text-xs text-muted-foreground">{t('plan.form_hint')}</p>
	{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="plan-mode">{t('plan.mode')}</Label>
			<Select id="plan-mode" bind:value={mode} disabled={pending}>
				{#each PLAN_MODES as option (option)}<option value={option}>{planModeLabel(option)}</option>{/each}
			</Select>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="plan-place">{t('plan.place')}</Label>
			<Select id="plan-place" bind:value={placeId} disabled={pending}>
				<option value="">{t('timer.no_place')}</option>
				{#each places as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
			</Select>
		</div>
	</div>
	<Field id="plan-note" label={t('plan.note')} bind:value={note} maxlength={200} disabled={pending} />
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={pending}>{t('common.save')}</Button>
		{#if initial}<Button type="button" variant="outline" onclick={remove} disabled={pending}>{t('plan.remove')}</Button>{/if}
		<Button type="button" variant="outline" onclick={oncancel} disabled={pending}>{t('common.cancel')}</Button>
	</div>
</form>
