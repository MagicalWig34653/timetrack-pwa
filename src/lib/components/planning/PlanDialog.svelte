<script lang="ts">
	import type { Absence, Place, PlanMode } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';
	import { findConflicts, hasBlocking, type ConflictContext } from '#lib/planning/conflicts.js';
	import { buildResult, formFromSeed, previewOf, type DialogForm, type DialogKind, type DialogResult, type DialogSeed } from '#lib/planning/dialog.js';
	import { ABSENCE_KINDS, ABSENCE_STATUSES, absenceKindLabel, absenceStatusLabel, PLAN_MODES, planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { blocksText } from '#lib/week/plan-blocks.js';
	import { untrack } from 'svelte';
	import ConflictList from './ConflictList.svelte';

	/**
	 * Precise planning in a small window: kind, period (several days), plan mode and times, break, place, absence
	 * status, half days and note, with a live conflict check. It only collects and validates; the calendar page writes
	 * (with undo).
	 */
	let {
		seed,
		places,
		ctx,
		anchor = null,
		returnFocus = null,
		busy = false,
		error = '',
		onsubmit,
		onclose
	}: {
		seed: DialogSeed;
		places: Place[];
		ctx: ConflictContext;
		anchor?: DOMRect | null;
		returnFocus?: HTMLElement | null;
		busy?: boolean;
		error?: string;
		onsubmit: (result: DialogResult) => void;
		onclose: () => void;
	} = $props();

	const editing: Absence | null = untrack(() => seed.absence ?? null);
	let form = $state<DialogForm>(untrack(() => formFromSeed(seed)));
	let errors = $state<Partial<Record<string, string>>>({});
	const kinds: DialogKind[] = ['plan', ...ABSENCE_KINDS];
	const isPlan = $derived(form.kind === 'plan');
	const planOff = $derived(isPlan && form.mode === 'off');
	const multi = $derived(form.days !== null && form.days.length > 0);

	const preview = $derived(previewOf(form, ctx, editing));
	const conflicts = $derived(findConflicts(preview.dates, preview.action, ctx));
	const blocked = $derived(hasBlocking(conflicts));
	const kindLabel = (kind: DialogKind) => (kind === 'plan' ? t('pd.kind_plan') : absenceKindLabel(kind));
	const title = $derived(editing ? t('pd.title_edit') : t('pd.title_new'));

	function submit(event: Event) {
		event.preventDefault();
		if (busy) return;
		const built = buildResult(form, ctx, editing);
		if (!built.ok) {
			errors = Object.fromEntries(Object.entries(built.errors).map(([k, v]) => [k, t(v!)]));
			return;
		}
		errors = {};
		if (blocked) return;
		onsubmit(built.result);
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
	}
</script>

<FloatingPanel titleId="pd-title" {anchor} {returnFocus} {onclose} data-testid="plan-dialog">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form class="flex flex-col gap-4 p-5" onsubmit={submit} onkeydown={keydown} novalidate aria-labelledby="pd-title">
		<div>
			<h2 id="pd-title" class="text-lg leading-tight font-semibold">{title}</h2>
			<p class="mt-0.5 text-xs text-muted-foreground" data-testid="pd-summary">
				{#if multi}{t('pd.summary_days', { count: form.days?.length ?? 0 })}{:else if form.start === form.end}{formatDateNumeric(form.start)}{:else}{formatDateNumeric(form.start)}–{formatDateNumeric(form.end)}{/if}
			</p>
		</div>
		{#if error}<Alert variant="destructive" data-testid="pd-error">{error}</Alert>{/if}

		<div class="flex flex-col gap-1.5">
			<Label for="pd-kind">{t('pd.kind')}</Label>
			<Select id="pd-kind" bind:value={form.kind} disabled={busy || editing !== null}>
				{#each kinds as kind (kind)}<option value={kind}>{kindLabel(kind)}</option>{/each}
			</Select>
		</div>

		{#if !multi}
			<div class="grid grid-cols-2 gap-3">
				<Field id="pd-start" type="date" label={t('pd.start')} bind:value={form.start} error={errors.start} disabled={busy} required />
				<Field id="pd-end" type="date" label={t('pd.end')} bind:value={form.end} error={errors.end} disabled={busy} required />
			</div>
		{/if}

		{#if isPlan}
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1.5">
					<Label for="pd-mode">{t('plan.mode')}</Label>
					<Select id="pd-mode" bind:value={form.mode} disabled={busy}>
						{#each PLAN_MODES as option (option)}<option value={option satisfies PlanMode}>{planModeLabel(option)}</option>{/each}
					</Select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="pd-place">{t('plan.place')}</Label>
					<Select id="pd-place" bind:value={form.placeId} disabled={busy}>
						<option value="">{t('timer.no_place')}</option>
						{#each places as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
					</Select>
				</div>
			</div>
			{#if !planOff}
				<div class="grid grid-cols-3 gap-3">
					<Field id="pd-from" type="time" label={t('pd.time_start')} bind:value={form.plannedStart} error={errors.time} disabled={busy} />
					<Field id="pd-to" type="time" label={t('pd.time_end')} bind:value={form.plannedEnd} disabled={busy} />
					<Field id="pd-break" inputmode="numeric" autocomplete="off" label={t('pd.break')} bind:value={form.breakMinutes} error={errors.break} disabled={busy} />
				</div>
			{/if}
			{#if form.blocks && form.blocks.length > 1}
				<p class="text-xs text-muted-foreground" data-testid="pd-blocks-hint">{t('pd.blocks_hint', { count: form.blocks.length, blocks: blocksText(form.blocks) })}</p>
			{/if}
			{#if preview.dates.length > 1 || form.start !== form.end || multi}
				<label class="flex items-center gap-2 text-sm"><Checkbox id="pd-workdays" bind:checked={form.onlyWorkdays} disabled={busy || planOff} />{t('pd.only_workdays')}</label>
			{/if}
			{#if errors.days}<p class="text-xs text-destructive" role="alert">{errors.days}</p>{/if}
		{:else}
			<div class="flex flex-col gap-1.5">
				<Label for="pd-status">{t('absence.status')}</Label>
				<Select id="pd-status" bind:value={form.status} disabled={busy}>
					{#each ABSENCE_STATUSES as option (option)}<option value={option}>{absenceStatusLabel(option)}</option>{/each}
				</Select>
			</div>
			<fieldset class="flex flex-col gap-2" disabled={busy}>
				<legend class="mb-1 text-sm font-medium">{t('absence.half_days')}</legend>
				<label class="flex items-center gap-2 text-sm"><Checkbox id="pd-half-start" bind:checked={form.halfDayStart} />{t('absence.half_start')}</label>
				<label class="flex items-center gap-2 text-sm"><Checkbox id="pd-half-end" bind:checked={form.halfDayEnd} />{t('absence.half_end')}</label>
			</fieldset>
		{/if}

		<Field id="pd-note" label={t('plan.note')} bind:value={form.note} error={errors.note} maxlength={isPlan ? 200 : 500} disabled={busy} />

		<ConflictList {conflicts} />
		{#if blocked}<p class="text-xs text-destructive" data-testid="pd-blocked">{t('pd.blocked')}</p>{/if}

		<div class="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
			<span class="mr-auto hidden text-xs text-muted-foreground sm:inline">{t('pd.submit_hint')}</span>
			<Button type="button" variant="outline" onclick={onclose} disabled={busy}>{t('common.cancel')}</Button>
			<Button type="submit" disabled={busy || blocked} data-testid="pd-submit">{t('common.save')}</Button>
		</div>
	</form>
</FloatingPanel>
