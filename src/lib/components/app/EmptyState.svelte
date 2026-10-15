<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	/** Empty state: icon, one sentence, optional action. Keeps the same look on every list. */
	let {
		title,
		description,
		icon: Icon,
		action,
		testid
	}: { title: string; description?: string; icon?: Component<{ class?: string; 'aria-hidden'?: 'true' }>; action?: Snippet; testid?: string } = $props();
</script>

<div class="flex flex-col items-center gap-2 rounded-[10px] border border-dashed px-6 py-10 text-center" data-testid={testid}>
	{#if Icon}<Icon class="size-6 text-muted-foreground" aria-hidden="true" />{/if}
	<p class="text-[15px] font-medium">{title}</p>
	{#if description}<p class="max-w-md text-[13px] text-muted-foreground">{description}</p>{/if}
	{#if action}<div class="mt-2">{@render action()}</div>{/if}
</div>
