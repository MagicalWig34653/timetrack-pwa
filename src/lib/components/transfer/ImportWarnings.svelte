<script lang="ts">
	import type { ImportWarning } from '#lib/api/types.js';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { t, type MessageKey } from '#lib/i18n/index.js';

	/** Aggregated import warnings (code + number of days) with a short "what does that mean" explanation; they never block the commit. */
	let { warnings, title = t('worktime.warnings_title'), intro = t('worktime.warnings_text'), testid = 'wt-warnings' }: { warnings: ImportWarning[]; title?: string; intro?: string; testid?: string } = $props();

	const items = $derived(warnings.filter((w) => w.count !== undefined && `worktime.warning.${w.code}` in KNOWN));
	// keys known in the German catalogue; unknown codes are not shown as aggregated entries
	const KNOWN: Record<string, true> = { 'worktime.warning.holiday_times_discarded': true, 'worktime.warning.school_on_holiday': true, 'worktime.warning.credit_partial_as_work': true, 'worktime.warning.pause_exceeds_day': true };
	const label = (code: string) => t(`worktime.warning.${code}` as MessageKey);
	const explain = (code: string) => t(`worktime.warning.${code}_text` as MessageKey);
</script>

{#if items.length > 0}
	<section class="flex flex-col gap-3 rounded-[10px] border border-amber-500/40 bg-amber-500/10 p-4 text-sm" aria-labelledby="{testid}-heading" data-testid={testid}>
		<div>
			<h4 id="{testid}-heading" class="font-medium">{title}</h4>
			<p class="mt-0.5 text-xs text-muted-foreground">{intro}</p>
		</div>
		<ul class="flex flex-col gap-2">
			{#each items as warning (warning.code)}
				<li class="rounded-lg border bg-card p-3 text-card-foreground" data-testid="wt-warning" data-code={warning.code} data-count={warning.count}>
					<div class="flex flex-wrap items-center gap-2">
						<StatusChip tone="warning">{warning.count === 1 ? t('worktime.warning_day_one') : t('worktime.warning_days', { count: warning.count ?? 0 })}</StatusChip>
						<span class="font-medium">{label(warning.code)}</span>
					</div>
					<details class="mt-2">
						<summary class="cursor-pointer text-xs underline underline-offset-4">{t('worktime.warning_what')}</summary>
						<p class="mt-1 text-xs text-muted-foreground">{explain(warning.code)}</p>
					</details>
				</li>
			{/each}
		</ul>
	</section>
{/if}
