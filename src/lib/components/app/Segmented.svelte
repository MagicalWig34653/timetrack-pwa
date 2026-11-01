<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface SegmentItem {
		id: string;
		label: string;
		icon?: Component<{ class?: string }>;
		testid?: string;
	}
</script>

<script lang="ts">
	/**
	 * The one segmented control for view modes (calendar month/year, planner grid/list): a muted track with a raised
	 * active segment. A button group with aria-pressed, so every item is reachable with Tab and activated with Enter/Space.
	 */
	let { items, value, label, onchange, class: className = '' }: { items: SegmentItem[]; value: string; label: string; onchange: (id: string) => void; class?: string } = $props();
</script>

<div class="inline-flex shrink-0 rounded-lg bg-muted p-0.5 {className}" role="group" aria-label={label}>
	{#each items as item (item.id)}
		<button
			type="button"
			class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-pressed={value === item.id}
			onclick={() => onchange(item.id)}
			data-testid={item.testid}
		>
			{#if item.icon}<item.icon class="size-4" />{/if}{item.label}
		</button>
	{/each}
</div>
