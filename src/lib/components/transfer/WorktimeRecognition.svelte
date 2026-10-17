<script lang="ts">
	import type { ImportJob } from '#lib/api/types.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import type { WorktimeFacts } from '#lib/transfer/worktime-flow.js';
	import { FileSpreadsheet } from '@lucide/svelte';

	/**
	 * Result of step 1 for a recognised work-time table. The card IS the template choice: recognition -> template
	 * applied -> options preset. Alternative: assign the columns yourself (generic wizard).
	 */
	let {
		job,
		facts,
		loading,
		failed,
		busy,
		onnext,
		ongeneric,
		onotherfile
	}: {
		job: ImportJob;
		facts: WorktimeFacts | null;
		loading: boolean;
		failed: boolean;
		busy: boolean;
		onnext: () => void;
		ongeneric: () => void;
		onotherfile: () => void;
	} = $props();

	const rows = $derived(
		facts
			? [
					{ id: 'sheets', label: t('import.recognized.sheets'), value: String(facts.sheets) },
					{ id: 'weeks', label: t('import.recognized.weeks'), value: String(facts.weeks) },
					{ id: 'time-days', label: t('import.recognized.time_days'), value: String(facts.timeDays) },
					{ id: 'vacation-days', label: t('import.recognized.vacation_days'), value: String(facts.vacationDays) },
					{ id: 'sick-days', label: t('import.recognized.sick_days'), value: String(facts.sickDays) },
					{ id: 'school-days', label: t('import.recognized.school_days'), value: String(facts.schoolDays) },
					{ id: 'first-day', label: t('import.recognized.first_day'), value: facts.firstDay ? formatDateNumeric(facts.firstDay) : '–' }
				]
			: []
	);
</script>

<section class="flex flex-col gap-4 rounded-[10px] border border-ui-accent/50 bg-ui-accent-soft/30 p-[17px] sm:p-[22px]" aria-labelledby="recognized-title" data-testid="profile-banner">
	<div class="flex items-start gap-3">
		<FileSpreadsheet class="mt-0.5 size-5 shrink-0 text-ui-accent-ink" aria-hidden="true" />
		<div class="min-w-0">
			<h3 id="recognized-title" class="text-[17px] leading-snug font-semibold">{t('import.recognized.title')}</h3>
			<p class="mt-1 text-sm text-muted-foreground" data-testid="profile-file">{job.filename}</p>
		</div>
	</div>

	<div class="rounded-lg border bg-card p-3 text-sm" data-testid="profile-template">
		<p class="font-medium">{t('import.recognized.template')}</p>
		<p class="mt-1 text-[13px] text-muted-foreground">{t('import.recognized.cause')}</p>
	</div>

	<div>
		<h4 class="mb-2 text-sm font-medium">{t('import.recognized.found')}</h4>
		{#if loading}
			<p class="text-sm text-muted-foreground" role="status" data-testid="profile-counting">{t('import.recognized.counting')}</p>
		{:else if rows.length > 0}
			<dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4" data-testid="profile-facts">
				{#each rows as row (row.id)}
					<div><dt class="text-[13px] text-muted-foreground">{row.label}</dt><dd class="text-lg font-semibold tabular-nums" data-testid="profile-fact-{row.id}">{row.value}</dd></div>
				{/each}
			</dl>
		{:else if failed}
			<p class="text-sm text-muted-foreground">{t('import.recognized.preview_failed')}</p>
		{/if}
	</div>

	<div class="flex flex-col gap-1">
		<div class="flex flex-wrap items-center gap-3">
			<Button type="button" onclick={onnext} disabled={busy || loading} data-testid="profile-next">{t('import.recognized.next')}</Button>
			<Button type="button" variant="ghost" size="sm" onclick={onotherfile} disabled={busy}>{t('import.recognized.other_file')}</Button>
		</div>
		<p class="text-[13px] text-muted-foreground">{t('import.recognized.next_hint')}</p>
	</div>

	<p class="border-t pt-3 text-sm text-muted-foreground">
		{t('import.recognized.other_table')}
		<Button type="button" variant="link" class="h-auto px-1 py-0" onclick={ongeneric} disabled={busy} data-testid="profile-switch-generic">{t('import.recognized.map_columns')}</Button>
	</p>
</section>
