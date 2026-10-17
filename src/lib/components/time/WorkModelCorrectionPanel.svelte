<script lang="ts" module>
	export type PreviewState = 'idle' | 'invalid' | 'loading' | 'ready' | 'failed';
</script>

<script lang="ts">
	import type { WorkModelPreview } from '#lib/api/types.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatDelta } from '#lib/time/format.js';
	import { changedFieldLabels } from '#lib/time/work-model-form.js';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	/** Warning, live preview and confirmation for correcting a version in place (contract v0.16.0). */
	let {
		from,
		to,
		status,
		preview,
		message = '',
		confirmed = $bindable(false),
		disabled = false
	}: {
		from: string;
		to: string | null;
		status: PreviewState;
		preview: WorkModelPreview | null;
		message?: string;
		confirmed?: boolean;
		disabled?: boolean;
	} = $props();

	const range = $derived({ from: formatDateNumeric(from), to: to ? formatDateNumeric(to) : t('work_model.correct_open_end') });
	const fields = $derived(preview ? changedFieldLabels(preview.changedFields).join(', ') : '');
</script>

<section class="flex flex-col gap-4 rounded-xl border-2 border-destructive/60 bg-destructive/10 p-4 text-foreground" data-testid="correction-panel" aria-label={t('work_model.correct_warning_title')}>
	<div role="alert" class="flex items-start gap-3" data-testid="correction-warning">
		<TriangleAlert class="mt-0.5 size-6 shrink-0 text-destructive" aria-hidden="true" />
		<div class="flex flex-col gap-1">
			<p class="text-lg font-semibold leading-tight text-destructive">{t('work_model.correct_warning_title')}</p>
			<p class="text-sm font-medium">{t('work_model.correct_warning', range)}</p>
		</div>
	</div>

	<div class="rounded-lg border bg-card p-3 text-card-foreground" data-testid="correction-preview" aria-live="polite">
		<p class="text-xs font-medium text-muted-foreground">{t('work_model.preview_title')}</p>
		{#if status === 'loading' || status === 'idle'}
			<p class="text-sm">{t('work_model.preview_loading')}</p>
		{:else if status === 'invalid'}
			<p class="text-sm">{t('work_model.preview_invalid')}</p>
		{:else if status === 'failed'}
			<p class="text-sm font-medium text-destructive" data-testid="preview-error">{message || t('work_model.preview_failed')}</p>
		{:else if preview}
			<p class="text-base font-semibold tabular-nums" data-testid="preview-line">
				{t('work_model.preview_line', {
					before: formatDelta(preview.balanceBeforeSeconds),
					after: formatDelta(preview.balanceAfterSeconds),
					difference: preview.differenceSeconds === 0 ? '±0:00' : formatDelta(preview.differenceSeconds).replace('-', '−'),
					days: preview.affectedDays
				})}
			</p>
			{#if preview.differenceSeconds === 0}<p class="text-sm text-muted-foreground">{t('work_model.preview_none')}</p>{/if}
			{#if fields}<p class="text-sm text-muted-foreground">{t('work_model.preview_fields', { fields })}</p>{/if}
			{#if preview.previousValidTo}<p class="text-sm text-muted-foreground">{t('work_model.preview_previous', { date: formatDateNumeric(preview.previousValidTo) })}</p>{/if}
		{/if}
	</div>

	<div class="flex items-center gap-2">
		<Checkbox id="wm-confirm" bind:checked={confirmed} {disabled} />
		<Label for="wm-confirm" class="font-medium">{t('work_model.confirm')}</Label>
	</div>
</section>
