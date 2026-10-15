<script lang="ts">
	import type { Snippet } from 'svelte';
	import AlertCircle from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import CheckCircle from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	/** Banner for page-level states (offline, module off, notices): icon + text, never colour alone. */
	let {
		tone = 'info',
		children,
		action,
		testid
	}: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: Snippet; action?: Snippet; testid?: string } = $props();

	const styles = {
		info: 'border-border bg-card text-card-foreground',
		success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
		warning: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
		danger: 'border-destructive/40 bg-destructive/10 text-destructive'
	} as const;
</script>

<div role={tone === 'danger' ? 'alert' : 'status'} class="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm {styles[tone]}" data-testid={testid}>
	{#if tone === 'danger'}<AlertCircle class="size-4 shrink-0" aria-hidden="true" />
	{:else if tone === 'warning'}<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
	{:else if tone === 'success'}<CheckCircle class="size-4 shrink-0" aria-hidden="true" />
	{:else}<Info class="size-4 shrink-0" aria-hidden="true" />{/if}
	<div class="min-w-0 flex-1">{@render children()}</div>
	{#if action}<div class="flex shrink-0 gap-2">{@render action()}</div>{/if}
</div>
