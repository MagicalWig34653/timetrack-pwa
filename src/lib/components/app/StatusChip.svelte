<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Status chip: 20 px, fully round, always with text; the colour is only an addition. */
	let {
		tone = 'neutral',
		dot = true,
		children
	}: { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; dot?: boolean; children: Snippet } = $props();

	const tones = {
		neutral: 'bg-muted text-foreground',
		accent: 'bg-ui-accent-soft text-ui-accent-ink glow-status',
		success: 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 glow-status [--glow-tone:var(--color-emerald-500)]',
		warning: 'bg-amber-500/10 text-amber-900 dark:text-amber-200 glow-status [--glow-tone:var(--color-amber-500)]',
		danger: 'bg-destructive/10 text-destructive glow-status [--glow-tone:var(--destructive)]'
	} as const;
	const dots = {
		neutral: 'bg-muted-foreground',
		accent: 'bg-ui-accent',
		success: 'bg-emerald-600',
		warning: 'bg-amber-500',
		danger: 'bg-destructive'
	} as const;
</script>

<span class="inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap {tones[tone]}">
	{#if dot}<span class="size-1.5 rounded-full {dots[tone]}" aria-hidden="true"></span>{/if}
	{@render children()}
</span>
