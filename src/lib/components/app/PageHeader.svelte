<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Page head (DESIGN.md "Seitenkopf"): title, one explanatory line, primary action and at most one secondary action.
	 * The primary action is accent-coloured; both stack below the title on phones.
	 */
	let {
		title,
		description,
		primary,
		secondary,
		compact = false
	}: { title: string; description?: string; primary?: Snippet; secondary?: Snippet; /** viewport-fitting pages: smaller title, no description and no bottom margin on landscape desktops */ compact?: boolean } = $props();
</script>

<svelte:head><title>{title} – Timetrack</title></svelte:head>
<header class="page-head mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between {compact ? 'fit:mb-0' : ''}" data-testid="page-header">
	<div class="min-w-0">
		<h1 class="text-[28px] leading-tight font-[650] tracking-[-0.8px] sm:text-[32px] {compact ? 'fit:text-[24px] fit:tracking-[-0.5px]' : ''}">{title}</h1>
		{#if description}<p class="mt-1.5 text-[15px] text-muted-foreground {compact ? 'fit:hidden' : ''}">{description}</p>{/if}
	</div>
	{#if primary || secondary}
		<div class="flex shrink-0 flex-wrap items-center gap-2">
			{#if secondary}{@render secondary()}{/if}
			{#if primary}{@render primary()}{/if}
		</div>
	{/if}
</header>
