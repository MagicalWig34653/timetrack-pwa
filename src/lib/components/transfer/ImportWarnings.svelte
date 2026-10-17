<script lang="ts">
	import type { ImportWarning } from '#lib/api/types.js';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { t, type MessageKey } from '#lib/i18n/index.js';

	/**
	 * Aggregated import warnings (code + number of days). Each one is: what happened (one sentence), what follows (one sentence)
	 * and the answer to "Muss ich etwas tun?". Warnings never block the commit.
	 */
	let { warnings, title = t('worktime.warnings_title'), intro = t('worktime.warnings_text'), testid = 'wt-warnings' }: { warnings: ImportWarning[]; title?: string; intro?: string; testid?: string } = $props();

	// codes with a German text; other codes are not shown as aggregated entries
	const KNOWN: Record<string, true> = { holiday_times_discarded: true, school_on_holiday: true, credit_partial_as_work: true, pause_exceeds_day: true };
	const items = $derived(warnings.filter((w) => w.count !== undefined && w.code in KNOWN));
	const label = (code: string) => t(`worktime.warning.${code}` as MessageKey);
	const consequence = (code: string) => t(`worktime.warning.${code}_text` as MessageKey);
	const todo = (code: string) => t(`worktime.warning.${code}_todo` as MessageKey);
</script>

{#if items.length > 0}
	<section class="flex flex-col gap-3 rounded-[10px] border border-amber-500/40 bg-amber-500/10 p-4 text-sm" aria-labelledby="{testid}-heading" data-testid={testid}>
		<div>
			<h4 id="{testid}-heading" class="font-medium">{title}</h4>
			<p class="mt-0.5 text-[13px] text-muted-foreground">{intro}</p>
		</div>
		<ul class="flex flex-col gap-2">
			{#each items as warning (warning.code)}
				<li class="rounded-lg border bg-card p-3 text-card-foreground" data-testid="wt-warning" data-code={warning.code} data-count={warning.count}>
					<div class="flex flex-wrap items-center gap-2">
						<StatusChip tone="warning">{warning.count === 1 ? t('worktime.warning_day_one') : t('worktime.warning_days', { count: warning.count ?? 0 })}</StatusChip>
						<span class="font-medium">{label(warning.code)}</span>
					</div>
					<p class="mt-1.5 text-[13px]">{consequence(warning.code)}</p>
					<p class="mt-1.5 text-[13px] text-muted-foreground"><span class="font-medium text-foreground">{t('worktime.warning_todo')}</span> {todo(warning.code)}</p>
				</li>
			{/each}
		</ul>
	</section>
{/if}
