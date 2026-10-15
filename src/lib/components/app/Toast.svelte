<script lang="ts">
	/** Polite, auto-dismissing status message. The live region stays in the DOM so screen readers announce changes. */
	let { message = '' }: { message?: string } = $props();
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" role="status" aria-live="polite" data-testid="toast-region">
	{#if message}
		<p class="pointer-events-auto max-w-sm glass-pop rounded-lg border px-4 py-2.5 text-sm text-popover-foreground shadow-[var(--shadow-pop)]" data-testid="toast">{message}</p>
	{/if}
</div>
