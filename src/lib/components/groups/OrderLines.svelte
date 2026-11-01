<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AggregatedItem, Order, OrderEntry } from '#lib/api/types.js';
	import { formatCents } from '#lib/groups/format.js';
	import { t } from '#lib/i18n/index.js';

	/**
	 * Grouped overview of an order round (same dishes summed, with the names) plus the single entries by person and the totals.
	 * `lineAction` renders per summed line (public: "Übernehmen"), `entryAction` per single entry (own entries / owner removal).
	 */
	let {
		order,
		lineAction,
		entryAction
	}: { order: Order; lineAction?: Snippet<[AggregatedItem]>; entryAction?: Snippet<[OrderEntry]> } = $props();

	const quantity = $derived(order.entries.reduce((sum, entry) => sum + entry.quantity, 0));
</script>

<section class="flex flex-col gap-2" aria-labelledby="order-summary-title" data-testid="order-summary">
	<h2 id="order-summary-title" class="text-base font-semibold">{t('groups.summary_title')}</h2>
	{#if order.aggregated.length === 0}
		<p class="text-sm text-muted-foreground" data-testid="order-empty">{t('groups.order_empty')}</p>
	{:else}
		<ul class="divide-y rounded-[10px] border">
			{#each order.aggregated as line (`${line.item}|${line.note}|${line.priceCents}`)}
				<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5" data-testid="order-line">
					<div class="min-w-0">
						<p class="break-words">
							<span class="font-semibold tabular-nums">{line.quantity}×</span>
							<span class="font-medium">{line.item}</span>{#if line.note}{' '}<span class="text-muted-foreground">({line.note})</span>{/if}
						</p>
						<p class="text-xs text-muted-foreground">{line.names.join(', ')}</p>
					</div>
					<div class="flex shrink-0 items-center gap-3">
						{#if line.priceCents !== null && line.priceCents !== undefined}
							<span class="text-sm tabular-nums" title={t('groups.line_total_hint')}>{formatCents(line.priceCents * line.quantity)}</span>
						{/if}
						{#if lineAction}{@render lineAction(line)}{/if}
					</div>
				</li>
			{/each}
		</ul>
		<p class="text-sm" data-testid="order-total">
			<span class="font-semibold">{t('groups.total_label')}</span>
			<span class="tabular-nums" data-testid="order-total-value">{formatCents(order.totalCents)}</span>
			<span class="text-muted-foreground">· {t('groups.total_pieces', { count: quantity })}{#if order.unpricedQuantity > 0} · {t('groups.total_unpriced', { count: order.unpricedQuantity })}{/if}</span>
		</p>
	{/if}
</section>

{#if order.entries.length > 0}
	<section class="flex flex-col gap-2" aria-labelledby="order-entries-title" data-testid="order-entries">
		<h2 id="order-entries-title" class="text-base font-semibold">{t('groups.entries_title')}</h2>
		<ul class="divide-y rounded-[10px] border">
			{#each order.entries as entry (entry.id)}
				<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2" data-testid="order-entry">
					<p class="min-w-0 text-sm break-words">
						<span class="font-medium">{entry.name}</span><span class="text-muted-foreground">:</span>
						<span class="tabular-nums">{entry.quantity}×</span> {entry.item}{#if entry.note}{' '}<span class="text-muted-foreground">({entry.note})</span>{/if}
						{#if entry.priceCents !== null && entry.priceCents !== undefined}{' '}<span class="text-muted-foreground">· {formatCents(entry.priceCents)}</span>{/if}
					</p>
					{#if entryAction}<div class="flex shrink-0 items-center gap-1">{@render entryAction(entry)}</div>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
