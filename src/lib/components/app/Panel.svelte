<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Panel (DESIGN.md "Karten"): bordered, opaque card with title row, optional action and footer. */
	let {
		title,
		description,
		action,
		footer,
		children,
		class: className = '',
		...rest
	}: {
		title?: string;
		description?: string;
		action?: Snippet;
		footer?: Snippet;
		children?: Snippet;
		class?: string;
		'data-testid'?: string;
	} = $props();
</script>

<section class="rounded-[10px] border bg-card p-[17px] text-card-foreground shadow-[var(--shadow-card)] sm:p-[22px] wide:p-7 {className}" {...rest}>
	{#if title || action}
		<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0">
				{#if title}<h2 class="text-[17px] leading-tight font-semibold">{title}</h2>{/if}
				{#if description}<p class="mt-1 text-[13px] text-muted-foreground">{description}</p>{/if}
			</div>
			{#if action}<div class="flex items-center gap-2">{@render action()}</div>{/if}
		</div>
	{/if}
	{@render children?.()}
	{#if footer}<div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">{@render footer()}</div>{/if}
</section>
