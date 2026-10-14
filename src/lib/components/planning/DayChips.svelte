<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import type { DayInfo } from '#lib/planning/calendar.js';
	import { ABSENCE_CLASSES, absenceKindLabel, absenceStatusLabel, HOLIDAY_CLASS, PLAN_CLASSES, planModeLabel, SCHOOL_HOLIDAY_CLASS } from '#lib/planning/labels.js';
	import { formatDuration } from '#lib/time/format.js';

	let { info, compact = false }: { info: DayInfo; compact?: boolean } = $props();

	const chip = 'block max-w-full truncate rounded px-1.5 py-0.5 text-left leading-tight';
	const text = $derived(compact ? 'text-[11px]' : 'text-xs');
	const worked = $derived(info.evaluation && info.evaluation.evaluatedWorkSeconds > 0 ? info.evaluation.evaluatedWorkSeconds : 0);
</script>

<span class="flex min-w-0 flex-col gap-0.5 {text}">
	{#each info.holidays as holiday (holiday.name + holiday.startDate)}
		<span class="{chip} {HOLIDAY_CLASS}" data-chip="holiday">{holiday.name}</span>
	{/each}
	{#each info.schoolHolidays as holiday (holiday.name + holiday.startDate)}
		<span class="{chip} {SCHOOL_HOLIDAY_CLASS}" data-chip="school-holiday">{holiday.name}</span>
	{/each}
	{#each info.absences as absence (absence.id)}
		<span class="{chip} {ABSENCE_CLASSES[absence.kind]}" data-chip="absence">
			{absenceKindLabel(absence.kind)}{#if !compact} ({absenceStatusLabel(absence.status)}){/if}
		</span>
	{/each}
	{#if info.plan}
		<span class="{chip} {PLAN_CLASSES[info.plan.mode]}" data-chip="plan">{planModeLabel(info.plan.mode)}</span>
	{/if}
	{#if worked > 0}
		<span class="px-1.5 tabular-nums text-muted-foreground" data-chip="worked">{t('calendar.worked', { time: formatDuration(worked) })}</span>
	{/if}
</span>
