<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Section title (21 px / 600) with optional trailing action. */
	let { title, level = 2, action }: { title: string; level?: 2 | 3; action?: Snippet } = $props();
</script>

<div class="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2 first:mt-0">
	<svelte:element this={`h${level}`} class="text-[21px] leading-tight font-semibold">{title}</svelte:element>
	{#if action}{@render action()}{/if}
</div>
