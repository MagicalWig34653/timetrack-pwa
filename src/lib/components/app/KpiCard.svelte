<script lang="ts">
	import type { Component } from 'svelte';
	import Dur from './Dur.svelte';

	/** KPI card (DESIGN.md "Kennzahlenkarten"): title with icon, big tabular number, one explanatory hint. */
	let {
		title,
		value,
		seconds,
		delta = false,
		hint,
		note,
		icon: Icon,
		tone = 'default',
		testid
	}: { title: string; /** Plain text value, or pass `seconds` for a clickable duration that follows the global time display. */ value?: string; seconds?: number; delta?: boolean; hint?: string; /** second line, e.g. today's difference that is not yet part of the figure */ note?: string | null; icon?: Component<{ class?: string; 'aria-hidden'?: 'true' }>; tone?: 'default' | 'negative'; testid?: string } = $props();
</script>

<div class="ui-card flex min-w-0 flex-col gap-1 rounded-[10px] border bg-card p-[17px] shadow-[var(--shadow-card)] sm:p-5" data-testid={testid ? `kpi-${testid}` : undefined}>
	<div class="flex items-center justify-between gap-2 text-[13px] font-medium text-muted-foreground">
		<span>{title}</span>
		{#if Icon}<Icon class="size-4 shrink-0" aria-hidden="true" />{/if}
	</div>
	<p class="text-[34px] leading-tight font-semibold tracking-[-0.7px] tabular-nums {tone === 'negative' ? 'text-destructive' : ''}" data-testid={testid}>{#if seconds !== undefined}<Dur {seconds} {delta} />{:else}{value}{/if}</p>
	{#if hint}<p class="text-[13px] text-muted-foreground">{hint}</p>{/if}
	{#if note}<p class="text-[13px] text-muted-foreground" data-testid={testid ? `${testid}-today` : undefined}>{note}</p>{/if}
</div>
