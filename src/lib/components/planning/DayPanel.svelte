<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { Absence, Place } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import type { DayInfo } from '#lib/planning/calendar.js';
	import { absenceKindLabel, absenceStatusLabel, planModeLabel } from '#lib/planning/labels.js';
	import { formatDateLong, formatDateNumeric } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { markLabel } from '#lib/time/labels.js';
	import { formatHalfDays } from '#lib/vacation/halfdays.js';
	import AbsenceForm from './AbsenceForm.svelte';
	import CustomDayForm from './CustomDayForm.svelte';
	import PlanDayForm from './PlanDayForm.svelte';

	let { info, places, onchanged, onclose }: { info: DayInfo; places: Place[]; onchanged: () => void; onclose: () => void } = $props();

	type Mode = { type: 'none' } | { type: 'absence'; absence: Absence | null } | { type: 'plan' } | { type: 'custom' };
	let mode = $state<Mode>({ type: 'none' });
	let notice = $state('');
	let error = $state('');

	// A different day starts with a clean panel.
	$effect(() => {
		void info.date;
		mode = { type: 'none' };
		notice = '';
		error = '';
	});

	function done(message: string) {
		mode = { type: 'none' };
		notice = message;
		error = '';
		onchanged();
	}

	async function removeCustom(id: string) {
		error = '';
		try {
			await api.deleteCustomDay(id);
			done(t('calendar.custom_deleted'));
		} catch (e) {
			error = errorMessage(e);
		}
	}

	async function removeAbsence(absence: Absence) {
		error = '';
		try {
			await api.deleteAbsence(absence.id);
			done(t('absence.deleted'));
		} catch (e) {
			error = errorMessage(e);
		}
	}

	const evaluation = $derived(info.evaluation);
</script>

<Card data-testid="day-panel">
	<CardHeader class="flex-row items-start justify-between gap-2">
		<CardTitle><h2 class="text-lg">{formatDateLong(info.date)}</h2></CardTitle>
		<Button variant="ghost" size="sm" onclick={onclose}>{t('common.close')}</Button>
	</CardHeader>
	<CardContent class="flex flex-col gap-4">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}

		<dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
			{#each info.holidays as holiday (holiday.name + holiday.startDate)}
				<dt class="text-muted-foreground">{t('calendar.holiday')}</dt>
				<dd>{holiday.name}</dd>
			{/each}
			{#each info.schoolHolidays as holiday (holiday.name + holiday.startDate)}
				<dt class="text-muted-foreground">{t('calendar.school_holiday')}</dt>
				<dd class="flex flex-wrap items-center gap-2">
					<span>{holiday.name} ({formatDateNumeric(holiday.startDate)}–{formatDateNumeric(holiday.endDate)})</span>
					{#if holiday.id}<Button variant="outline" size="sm" onclick={() => removeCustom(holiday.id!)}>{t('calendar.custom_delete')}</Button>{/if}
				</dd>
			{/each}
			{#each info.absences as absence (absence.id)}
				<dt class="text-muted-foreground">{absenceKindLabel(absence.kind)}</dt>
				<dd class="flex flex-wrap items-center gap-2" data-testid="panel-absence">
					<span>
						{formatDateNumeric(absence.startDate)}–{formatDateNumeric(absence.endDate)} · {absenceStatusLabel(absence.status)}
						{#if absence.kind === 'vacation'} · {t('absence.counted', { days: formatHalfDays(absence.countedHalfDays) })}{/if}
					</span>
					<Button variant="outline" size="sm" onclick={() => (mode = { type: 'absence', absence })}>{t('absence.edit')}</Button>
					<Button variant="outline" size="sm" onclick={() => removeAbsence(absence)}>{t('absence.delete')}</Button>
				</dd>
			{/each}
			<dt class="text-muted-foreground">{t('calendar.plan')}</dt>
			<dd data-testid="panel-plan">
				{#if info.plan}{planModeLabel(info.plan.mode)}{#if info.plan.note} · {info.plan.note}{/if}{:else}{t('calendar.no_plan')}{/if}
			</dd>
			{#if evaluation}
				<dt class="text-muted-foreground">{t('calendar.evaluation')}</dt>
				<dd class="tabular-nums" data-testid="panel-evaluation">
					{t('calendar.evaluation_text', { target: formatDuration(evaluation.targetSeconds), worked: formatDuration(evaluation.evaluatedWorkSeconds) })}
					{#if evaluation.mark && evaluation.mark !== 'none'} · {markLabel(evaluation.mark)}{/if}
					{#if evaluation.provisional} · {t('home.balance_provisional')}{/if}
					· <a class="underline underline-offset-4" href="/time/{info.date}">{t('calendar.open_day')}</a>
				</dd>
			{/if}
		</dl>

		{#if mode.type === 'none'}
			<div class="flex flex-wrap gap-2">
				<Button onclick={() => (mode = { type: 'absence', absence: null })}>{t('calendar.add_absence')}</Button>
				<Button variant="outline" onclick={() => (mode = { type: 'plan' })}>{info.plan ? t('calendar.edit_plan') : t('calendar.add_plan')}</Button>
				<Button variant="outline" onclick={() => (mode = { type: 'custom' })}>{t('calendar.add_custom')}</Button>
			</div>
		{:else if mode.type === 'absence'}
			{#key mode.absence?.id ?? 'new'}
				<AbsenceForm
					absence={mode.absence}
					date={info.date}
					onsaved={() => done(t('absence.saved'))}
					oncancel={() => (mode = { type: 'none' })}
					onstale={() => {
						mode = { type: 'none' };
						onchanged();
					}}
				/>
			{/key}
		{:else if mode.type === 'plan'}
			<PlanDayForm date={info.date} plan={info.plan} {places} onsaved={() => done(t('plan.saved'))} oncancel={() => (mode = { type: 'none' })} />
		{:else}
			<CustomDayForm date={info.date} onsaved={() => done(t('custom_day.saved'))} oncancel={() => (mode = { type: 'none' })} />
		{/if}
	</CardContent>
</Card>
