<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Filter row above a list: controls on the left, result counter on the right. */
	let { children, count, label }: { children: Snippet; count?: string; label?: string } = $props();
</script>

<div class="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={label}>
	{@render children()}
	{#if count}<span class="ml-auto text-[13px] text-muted-foreground tabular-nums" aria-live="polite">{count}</span>{/if}
</div>
