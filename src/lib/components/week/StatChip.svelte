<script lang="ts">
	import type { Component } from 'svelte';

	/** Summary chip of the week overview: icon, one number, one caption. */
	let {
		icon: Icon,
		value,
		caption,
		testid
	}: { icon: Component<{ class?: string; 'aria-hidden'?: 'true' }>; value: string; caption: string; testid?: string } = $props();
</script>

<li class="flex min-w-0 items-center gap-3 rounded-[10px] border bg-card px-3.5 py-2.5 shadow-[var(--shadow-card)]" data-testid={testid}>
	<span class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ui-accent-soft text-ui-accent-ink"><Icon class="size-4" aria-hidden="true" /></span>
	<span class="min-w-0">
		<span class="block text-[17px] leading-tight font-semibold tabular-nums">{value}</span>
		<span class="block truncate text-xs text-muted-foreground">{caption}</span>
	</span>
</li>
