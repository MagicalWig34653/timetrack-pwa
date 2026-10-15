<script lang="ts">
	import type { DayEvaluation } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDelta, formatDuration } from '#lib/time/format.js';
	import { hintLabel, markLabel } from '#lib/time/labels.js';

	let { evaluation, showHints = true, kpis = true }: { evaluation: DayEvaluation; showHints?: boolean; /** false when target/evaluated/delta are shown as KPI cards next to this summary */ kpis?: boolean } = $props();
	const markedOff = $derived(evaluation.mark === 'holiday' || evaluation.mark === 'vacation' || evaluation.mark === 'sick' || evaluation.mark === 'excused');
	const targetNote = $derived(
		!markedOff ? '' : evaluation.targetSeconds === 0 ? t('day.target_note_zero', { mark: markLabel(evaluation.mark!) }) : evaluation.mark === 'vacation' ? t('day.target_note_half') : ''
	);
	const sourceNote = $derived(
		!markedOff || !evaluation.markSource || evaluation.markSource === 'none' ? '' : t(`day.mark_source_${evaluation.markSource}` as 'day.mark_source_explicit')
	);
	const rounding = $derived(evaluation.startAdjustSeconds + evaluation.endAdjustSeconds);
</script>

<div class="flex flex-col gap-3" data-testid="day-summary">
	<div class="flex flex-wrap items-center gap-2">
		{#if evaluation.provisional}<Badge variant="secondary" data-testid="provisional-badge">{t('day.provisional')}</Badge>{/if}
		{#if evaluation.mark && evaluation.mark !== 'none'}<Badge variant="outline">{markLabel(evaluation.mark)}</Badge>{/if}
	</div>
	{#if targetNote}<p class="text-sm text-muted-foreground" data-testid="day-target-note">{targetNote}</p>{/if}
	{#if sourceNote}<p class="text-xs text-muted-foreground" data-testid="day-mark-source" data-source={evaluation.markSource}>{sourceNote}</p>{/if}
	<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
		{#if kpis}<div><dt class="text-muted-foreground">{t('day.target')}</dt><dd class="text-lg font-medium tabular-nums" data-testid="day-target">{formatDuration(evaluation.targetSeconds)}</dd></div>{/if}
		<div><dt class="text-muted-foreground">{t('day.raw')}</dt><dd class="text-lg font-medium tabular-nums" data-testid="day-raw">{formatDuration(evaluation.rawWorkSeconds)}</dd></div>
		{#if kpis}<div><dt class="text-muted-foreground">{t('day.evaluated')}</dt><dd class="text-lg font-medium tabular-nums" data-testid="day-evaluated">{formatDuration(evaluation.evaluatedWorkSeconds)}</dd></div>{/if}
		{#if rounding !== 0}
			<div>
				<dt class="text-muted-foreground">{t('day.rounding')}</dt>
				<dd class="tabular-nums" data-testid="day-rounding">{formatDelta(rounding)} <span class="text-xs text-muted-foreground">({formatDuration(evaluation.startAdjustSeconds)} + {formatDuration(evaluation.endAdjustSeconds)})</span></dd>
			</div>
		{/if}
		{#if evaluation.breakDeductionSeconds > 0}
			<div><dt class="text-muted-foreground">{t('day.break_deduction')}</dt><dd class="tabular-nums" data-testid="day-break-deduction">-{formatDuration(evaluation.breakDeductionSeconds)}</dd></div>
		{/if}
		{#if evaluation.creditSeconds > 0}
			<div><dt class="text-muted-foreground">{t('day.credit')}</dt><dd class="tabular-nums" data-testid="day-credit">+{formatDuration(evaluation.creditSeconds)}</dd></div>
		{/if}
		{#if kpis}
			<div>
				<dt class="text-muted-foreground">{t('day.delta')}</dt>
				<dd class="text-lg font-semibold tabular-nums {evaluation.deltaSeconds < 0 ? 'text-destructive' : ''}" data-testid="day-delta">{formatDelta(evaluation.deltaSeconds)}</dd>
			</div>
		{/if}
	</dl>
	{#if showHints && evaluation.breakHints.length > 0}
		<Alert data-testid="break-hints">
			<p class="font-medium">{t('hint.title')}</p>
			<ul class="mt-1 list-disc pl-5">
				{#each evaluation.breakHints as hint (hint.code)}<li>{hintLabel(hint.code)}</li>{/each}
			</ul>
			<p class="mt-2 text-xs text-muted-foreground">{t('hint.disclaimer')}</p>
		</Alert>
	{/if}
</div>
