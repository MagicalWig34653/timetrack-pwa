<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { holidayHint } from '#lib/planning/company-days.js';
	import type { DayInfo } from '#lib/planning/calendar.js';
	import { ABSENCE_CLASSES, absenceKindLabel, absenceStatusLabel, HOLIDAY_CLASS, PLAN_CLASSES, planModeLabel, SCHOOL_HOLIDAY_CLASS } from '#lib/planning/labels.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';

	let { info, compact = false, hidden = new Set<string>(), draggable = false }: { info: DayInfo; compact?: boolean; hidden?: Set<string>; draggable?: boolean } = $props();

	const chip = 'block max-w-full truncate rounded px-1.5 py-0.5 text-left leading-tight';
	const text = $derived(compact ? 'text-[11px]' : 'text-xs');
	const worked = $derived(info.evaluation && info.evaluation.evaluatedWorkSeconds > 0 ? info.evaluation.evaluatedWorkSeconds : 0);
</script>

<span class="flex min-w-0 flex-col gap-0.5 {text}">
	{#if !hidden.has('holiday')}
		{#each info.holidays as holiday (holiday.name + holiday.startDate)}
			<span class="{chip} {HOLIDAY_CLASS} {holiday.companyTreatment === 'half' ? 'border border-dashed border-current' : ''}" data-chip="holiday" data-treatment={holiday.companyTreatment ?? undefined} title={holidayHint(holiday.name, holiday.companyTreatment)}>{holiday.name}{#if holiday.companyTreatment === 'half'}<span aria-hidden="true"> ½</span><span class="sr-only">, {holidayHint(holiday.name, 'half')}</span>{/if}</span>
		{/each}
	{/if}
	{#if !hidden.has('school_holiday')}
		{#each info.schoolHolidays as holiday (holiday.name + holiday.startDate)}
			<span class="{chip} {SCHOOL_HOLIDAY_CLASS}" data-chip="school-holiday">{holiday.name}</span>
		{/each}
	{/if}
	{#each info.absences.filter((a) => !hidden.has(a.kind)) as absence (absence.id)}
		<!-- pointer only: the keyboard alternative is Alt+arrow keys on the day and the edit window (see the shortcut help) -->
		<span
			class="{chip} relative {ABSENCE_CLASSES[absence.kind]} {draggable ? 'cursor-grab active:cursor-grabbing' : ''}"
			data-chip="absence"
			data-absence-id={draggable ? absence.id : undefined}
		>
			{#if draggable && absence.startDate === info.date}<span class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l bg-current/30" data-resize="start" aria-hidden="true"></span>{/if}
			{absenceKindLabel(absence.kind)}{#if !compact} ({absenceStatusLabel(absence.status)}){/if}
			{#if draggable && absence.endDate === info.date}<span class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r bg-current/30" data-resize="end" aria-hidden="true"></span>{/if}
		</span>
	{/each}
	{#if info.plan && !hidden.has('plan')}
		<span class="{chip} {PLAN_CLASSES[info.plan.mode]}" data-chip="plan">
			{planModeLabel(info.plan.mode)}{#if !compact && info.plan.plannedStart && info.plan.plannedEnd}<span class="tabular-nums"> {info.plan.plannedStart}–{info.plan.plannedEnd}</span>{/if}
		</span>
	{/if}
	{#if worked > 0 && !hidden.has('worked')}
		<span class="px-1.5 tabular-nums text-foreground/80" data-chip="worked">{t('calendar.worked', { time: timeDisplay.duration(worked) })}</span>
	{/if}
</span>
