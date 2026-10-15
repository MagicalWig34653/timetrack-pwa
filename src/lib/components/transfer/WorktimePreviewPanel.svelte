<script lang="ts">
	import type { WorktimeAction, WorktimePreview } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { WORKTIME_ACTIONS } from '#lib/transfer/worktime.js';

	let { worktime, busy, oncreaterule }: { worktime: WorktimePreview; busy: boolean; oncreaterule: (text: string, action: WorktimeAction) => void } = $props();

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
	const balance = $derived(worktime.sheetBalanceSeconds == null ? null : `${worktime.sheetBalanceSeconds < 0 ? '-' : '+'}${formatDuration(Math.abs(worktime.sheetBalanceSeconds))}`);
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

	<Alert data-testid="wt-balance">
		<p class="font-medium">{t('worktime.balance_title')}</p>
		{#if balance}<p class="mt-1" data-testid="wt-balance-value">{t('worktime.balance_text', { balance })}</p>{/if}
		<p class="mt-1 text-xs">{t('worktime.balance_rounding')}</p>
	</Alert>

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
