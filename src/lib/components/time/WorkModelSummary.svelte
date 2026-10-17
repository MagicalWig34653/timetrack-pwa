<script lang="ts">
	import type { WorkModel } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDuration } from '#lib/time/format.js';
	import { weekdayLabel } from '#lib/time/labels.js';

	/** Read-only key values of one work model version, shown prominently on its card. */
	let { model }: { model: WorkModel } = $props();

	const days = $derived([...model.workdays].sort((a, b) => a - b));
	const consecutive = $derived(days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1));
	const workdays = $derived(consecutive ? `${weekdayLabel(days[0])}–${weekdayLabel(days[days.length - 1])}` : days.map(weekdayLabel).join(', '));
	const hasOverrides = $derived(Object.keys(model.dailyTargetSeconds ?? {}).length > 0);
	const daily = $derived(formatDuration(Math.round(model.weeklyTargetSeconds / Math.max(1, model.workdays.length))));
	const breaks = $derived((model.fixedBreaks ?? []).map((b) => `${b.start}–${b.end}`).join(', '));
	const school = $derived(
		t('work_model.school_value', {
			threshold: formatDuration(model.schoolFullDayThresholdSeconds ?? 10800),
			credit: model.schoolCreditSeconds == null ? t('work_model.credit_daily_target') : formatDuration(model.schoolCreditSeconds)
		})
	);
	const tiles = $derived([
		{ key: 'weekly', label: t('work_model.weekly'), value: `${formatDuration(model.weeklyTargetSeconds)} h`, note: '' },
		{ key: 'workdays', label: t('work_model.workdays'), value: workdays, note: '' },
		{ key: 'daily', label: t('work_model.daily'), value: `${daily} h`, note: hasOverrides ? t('work_model.daily_override_short') : '' },
		{
			key: 'rounding',
			label: t('work_model.rounding'),
			value: model.roundingEnabled === false ? t('common.off') : t('work_model.rounding_value', { minutes: model.roundingMinutes ?? 15 }),
			note: ''
		},
		{ key: 'breaks', label: t('work_model.fixed_breaks'), value: breaks || t('common.none'), note: '' },
		{ key: 'school', label: t('work_model.school'), value: school, note: '' }
	]);
</script>

<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="model-summary">
	{#each tiles as tile (tile.key)}
		<div class="rounded-lg border bg-muted/30 px-3 py-2" data-testid="model-summary-{tile.key}">
			<dt class="text-xs text-muted-foreground">{tile.label}</dt>
			<dd class="text-base font-semibold tabular-nums leading-snug">{tile.value}</dd>
			{#if tile.note}<dd class="text-xs text-muted-foreground">{tile.note}</dd>{/if}
		</div>
	{/each}
</dl>
<p class="text-xs text-muted-foreground">
	{t('work_model.travel')}: {model.travelCountsAsWork === false ? t('common.no') : t('common.yes')} · {t('work_model.day_boundary')}: {t('work_model.minutes', { minutes: model.dayBoundaryMinutes ?? 0 })} · {model.timezone ?? 'Europe/Berlin'}
</p>
