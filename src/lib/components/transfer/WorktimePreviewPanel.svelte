<script lang="ts">
	import type { WorktimeAction, WorktimePreview } from '#lib/api/types.js';
	import Panel from '#lib/components/app/Panel.svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { WORKTIME_ACTIONS } from '#lib/transfer/worktime.js';
	import type { WorktimeFacts } from '#lib/transfer/worktime-flow.js';

	/** Plain-language summary of a work-time preview: what will be imported, the table balance, details on demand. */
	let {
		worktime,
		facts,
		duplicates,
		refreshing,
		busy,
		oncreaterule,
		modelPending = false,
		warnings,
		actions
	}: {
		worktime: WorktimePreview;
		facts: WorktimeFacts;
		duplicates: number;
		refreshing: boolean;
		busy: boolean;
		oncreaterule: (text: string, action: WorktimeAction) => void;
		/** the work model still has to be created after the import */
		modelPending?: boolean;
		/** shown right below the summary */
		warnings?: Snippet;
		/** primary action, shown before the details */
		actions?: Snippet;
	} = $props();

	const picks = $state<Record<string, WorktimeAction>>({});
	const unmapped = $derived(worktime.unmappedRemarks ?? []);
	const byAction = $derived(Object.entries(worktime.byAction ?? {}).filter(([, count]) => count > 0));
	const parts = $derived(
		[
			facts.workDays > 0 ? (facts.workDays === 1 ? t('worktime.summary_work_one') : t('worktime.summary_work', { count: facts.workDays })) : '',
			facts.vacationDays > 0 ? (facts.vacationDays === 1 ? t('worktime.summary_vacation_one') : t('worktime.summary_vacation', { count: facts.vacationDays })) : '',
			facts.sickDays > 0 ? (facts.sickDays === 1 ? t('worktime.summary_sick_one') : t('worktime.summary_sick', { count: facts.sickDays })) : '',
			facts.schoolDays > 0 ? (facts.schoolDays === 1 ? t('worktime.summary_school_one') : t('worktime.summary_school', { count: facts.schoolDays })) : '',
			facts.excusedDays > 0 ? (facts.excusedDays === 1 ? t('worktime.summary_excused_one') : t('worktime.summary_excused', { count: facts.excusedDays })) : '',
			facts.holidayDays > 0 ? (facts.holidayDays === 1 ? t('worktime.summary_holiday_one') : t('worktime.summary_holiday', { count: facts.holidayDays })) : ''
		].filter(Boolean)
	);
	const counts = $derived([
		{ id: 'days', label: t('worktime.count_days'), value: worktime.days ?? 0 },
		{ id: 'segments', label: t('worktime.count_segments'), value: worktime.segments ?? 0 },
		{ id: 'absences', label: t('worktime.count_absences'), value: worktime.absences ?? 0 },
		{ id: 'custom-days', label: t('worktime.count_custom_days'), value: worktime.customDays ?? 0 },
		{ id: 'skipped-holidays', label: t('worktime.count_skipped_holidays'), value: worktime.skippedHolidays ?? 0 }
	]);
	const actionLabel = (action: string) => t(`worktime.action.${action}` as MessageKey);
	const signed = (seconds: number | null | undefined) => (seconds == null ? null : `${seconds < 0 ? '-' : '+'}${formatDuration(Math.abs(seconds))}`);
	const total = $derived(signed(worktime.sheetBalanceSeconds));
	// older servers report only the total: it is then shown as the main value
	const split = $derived(worktime.sheetBalanceUpToTodaySeconds != null);
	const upToToday = $derived(signed(split ? worktime.sheetBalanceUpToTodaySeconds : worktime.sheetBalanceSeconds));
	const future = $derived(signed(worktime.sheetBalanceFutureSeconds));
	const nothingNew = $derived((worktime.segments ?? 0) + (worktime.absences ?? 0) + (worktime.customDays ?? 0) === 0);
</script>

<section class="flex flex-col gap-4" aria-labelledby="wt-preview-heading" data-testid="worktime-preview" aria-busy={refreshing}>
	<Panel>
		<div class="flex flex-col gap-2 text-sm" aria-live="polite">
			{#if refreshing}
				<p class="text-muted-foreground" data-testid="wt-refreshing">{t('worktime.summary_refreshing')}</p>
			{:else if nothingNew || parts.length === 0}
				<p class="text-lg leading-snug font-semibold" data-testid="wt-summary">{duplicates > 0 ? t('worktime.summary_all_known') : t('worktime.summary_nothing')}</p>
			{:else}
				<p class="text-lg leading-snug font-semibold" data-testid="wt-summary">{t('worktime.summary_lead', { parts: parts.join(', ') })}</p>
			{/if}
			{#if worktime.firstDate && worktime.lastDate}
				<p class="text-muted-foreground" data-testid="wt-range-line">{t('worktime.summary_range', { from: formatDateNumeric(worktime.firstDate), to: formatDateNumeric(worktime.lastDate) })}</p>
			{/if}
			{#if duplicates > 0 && !nothingNew}<p class="text-muted-foreground">{t('worktime.summary_duplicates', { count: duplicates })}</p>{/if}
			{#if modelPending}<p class="text-muted-foreground" data-testid="wt-model-pending">{t('worktime.summary_model_note')}</p>{/if}
		</div>
	</Panel>

	{@render warnings?.()}

	{#if unmapped.length > 0}
		<section aria-labelledby="wt-unmapped-heading" data-testid="wt-unmapped">
			<h4 id="wt-unmapped-heading" class="mb-1 font-medium">{t('worktime.unmapped_title')}</h4>
			<p class="mb-2 text-sm text-muted-foreground">{t('worktime.unmapped_text')}</p>
			<ul class="flex flex-col gap-2">
				{#each unmapped as item (item.text)}
					<li class="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_12rem_auto] sm:items-center" data-testid="wt-unmapped-item">
						<span class="font-medium break-words">{item.text}</span>
						<span class="text-sm text-muted-foreground tabular-nums">{t('worktime.unmapped_col_count')}: {item.count}</span>
						<Select aria-label={t('worktime.unmapped_action_label', { text: item.text })} value={picks[item.text] ?? 'work'} onchange={(e) => (picks[item.text] = e.currentTarget.value as WorktimeAction)}>
							{#each WORKTIME_ACTIONS as action (action)}<option value={action}>{actionLabel(action)}</option>{/each}
						</Select>
						<Button type="button" variant="outline" size="sm" disabled={busy} aria-label={t('worktime.unmapped_create_label', { text: item.text })} onclick={() => oncreaterule(item.text, picks[item.text] ?? 'work')}>
							{t('worktime.unmapped_create')}
						</Button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{@render actions?.()}

	<Panel title={t('worktime.balance_title')} description={t('worktime.balance_intro')} data-testid="wt-balance">
		{#if upToToday}
			<dl class="grid gap-3 sm:grid-cols-2">
				<div data-testid="kpi-wt-balance-value"><dt class="text-[13px] font-medium text-muted-foreground">{t('worktime.balance_upto')}</dt><dd class="text-2xl font-semibold tabular-nums" data-testid="wt-balance-value">{upToToday}</dd><dd class="text-[13px] text-muted-foreground">{t('worktime.balance_upto_hint')}</dd></div>
				{#if split && future}<div><dt class="text-[13px] font-medium text-muted-foreground">{t('worktime.balance_future')}</dt><dd class="text-2xl font-semibold tabular-nums" data-testid="wt-balance-future">{future}</dd><dd class="text-[13px] text-muted-foreground">{t('worktime.balance_future_hint')}</dd></div>{/if}
			</dl>
			{#if split && total}<p class="mt-3 text-[13px] text-muted-foreground" data-testid="wt-balance-total">{t('worktime.balance_total', { balance: total })}</p>{/if}
		{/if}
		<p class="mt-3 text-[13px] text-muted-foreground">{t('worktime.balance_compare')}</p>
	</Panel>

	<details class="rounded-lg border" data-testid="wt-details">
		<summary class="min-h-11 cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('worktime.details_title')}</summary>
		<div class="flex flex-col gap-3 border-t p-3">
			<p class="text-[13px] text-muted-foreground">{t('worktime.details_help')}</p>
			<dl class="grid grid-cols-2 gap-3 sm:grid-cols-5">
				{#each counts as count (count.id)}
					<Card class="py-3"><CardContent><dt class="text-xs text-muted-foreground">{count.label}</dt><dd class="text-xl font-semibold tabular-nums" data-testid="wt-count-{count.id}">{count.value}</dd></CardContent></Card>
				{/each}
			</dl>
			<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
				{#if worktime.firstDate && worktime.lastDate}
					<div><dt class="text-muted-foreground">{t('worktime.range')}</dt><dd data-testid="wt-range">{t('worktime.range_value', { from: formatDateNumeric(worktime.firstDate), to: formatDateNumeric(worktime.lastDate) })}</dd></div>
				{/if}
				{#if worktime.dateSystem}
					<div><dt class="text-muted-foreground">{t('worktime.date_system')}</dt><dd data-testid="wt-date-system">{t(`worktime.date_system_${worktime.dateSystem}` as MessageKey)}</dd></div>
				{/if}
				{#if byAction.length > 0}
					<div class="sm:col-span-2">
						<dt class="text-muted-foreground">{t('worktime.by_action')}</dt>
						<dd class="flex flex-wrap gap-x-4 gap-y-1" data-testid="wt-by-action">
							{#each byAction as [action, count] (action)}<span data-action={action}>{t('worktime.by_action_item', { action: actionLabel(action), count })}</span>{/each}
						</dd>
					</div>
				{/if}
			</dl>
		</div>
	</details>
</section>
