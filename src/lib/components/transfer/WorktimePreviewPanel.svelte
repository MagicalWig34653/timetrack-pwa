<script lang="ts">
	import type { WorkModel, WorktimeAction, WorktimePreview } from '#lib/api/types.js';
	import Banner from '#lib/components/app/Banner.svelte';
	import KpiCard from '#lib/components/app/KpiCard.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { WORKTIME_ACTIONS } from '#lib/transfer/worktime.js';
	import { modelStartHint } from '#lib/transfer/worktime-flow.js';

	let { worktime, busy, oncreaterule, models = null }: { worktime: WorktimePreview; busy: boolean; oncreaterule: (text: string, action: WorktimeAction) => void; models?: WorkModel[] | null } = $props();

	const picks = $state<Record<string, WorktimeAction>>({});
	const unmapped = $derived(worktime.unmappedRemarks ?? []);
	const byAction = $derived(Object.entries(worktime.byAction ?? {}).filter(([, count]) => count > 0));
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
	const hint = $derived(models ? modelStartHint(worktime.firstContentDate, models) : null);
	const firstDate = $derived(worktime.firstContentDate ?? '');
</script>

<section class="flex flex-col gap-4" aria-labelledby="wt-preview-heading" data-testid="worktime-preview">
	<h3 id="wt-preview-heading" class="font-medium">{t('worktime.preview_title')}</h3>
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

	<Panel title={t('worktime.balance_title')} description={t('worktime.balance_intro')} data-testid="wt-balance">
		{#if upToToday}
			<div class="grid gap-3 sm:grid-cols-2">
				<KpiCard title={t('worktime.balance_upto')} value={upToToday} hint={t('worktime.balance_upto_hint')} testid="wt-balance-value" />
				{#if split && future}<KpiCard title={t('worktime.balance_future')} value={future} hint={t('worktime.balance_future_hint')} testid="wt-balance-future" />{/if}
			</div>
			{#if split && total}<p class="mt-3 text-xs text-muted-foreground" data-testid="wt-balance-total">{t('worktime.balance_total', { balance: total })}</p>{/if}
		{/if}
		<p class="mt-3 text-xs text-muted-foreground">{t('worktime.balance_rounding')}</p>
	</Panel>

	{#if hint}
		<div data-testid="wt-model-start" data-kind={hint.kind}>
			<Banner tone={hint.kind === 'ok' ? 'success' : 'warning'}>
				<p class="font-medium">{t('worktime.model_start_title')}</p>
				<p class="mt-0.5">{t('worktime.model_start_first', { date: formatDateNumeric(firstDate) })}</p>
				<p class="mt-0.5 text-xs">
					{#if hint.kind === 'none'}{t('worktime.model_start_none', { date: formatDateNumeric(firstDate) })}
					{:else if hint.kind === 'ok'}{t('worktime.model_start_ok', { modelFrom: formatDateNumeric(hint.modelFrom) })}
					{:else if hint.kind === 'late'}{t('worktime.model_start_late', { modelFrom: formatDateNumeric(hint.modelFrom) })}
					{:else if hint.beforeWeek}{t('worktime.model_start_text', { modelFrom: formatDateNumeric(hint.modelFrom), date: formatDateNumeric(firstDate) })}
					{:else}{t('worktime.model_start_midweek', { days: hint.emptyDays, date: formatDateNumeric(firstDate) })}{/if}
				</p>
				
					{#if hint && hint.kind !== 'ok'}
						<a class="mt-2 inline-flex h-8 items-center rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted" href="/settings/work-model?validFrom={firstDate}" target="_blank" rel="noopener" data-testid="wt-model-start-link">{t('worktime.model_start_link', { date: formatDateNumeric(firstDate) })}</a>
					{/if}
				
			</Banner>
		</div>
	{/if}

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
</section>
