<script lang="ts">
	import type { Snippet } from 'svelte';
	import { focusTrap } from '#lib/a11y/focus-trap.js';

	/** Glass popover anchored to a trigger button. Closes on Escape and outside click; focus returns to the trigger. */
	let {
		label,
		trigger,
		children,
		align = 'right',
		testid,
		triggerClass = ''
	}: {
		label: string;
		trigger: Snippet;
		children: Snippet<[() => void]>;
		align?: 'left' | 'right';
		testid?: string;
		triggerClass?: string;
	} = $props();

	let open = $state(false);
	let root: HTMLElement | undefined = $state();
	const panelId = $props.id();

	function close() {
		open = false;
	}
	function onWindowPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="relative" bind:this={root}>
	<button
		type="button"
		class="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground {triggerClass}"
		aria-label={label}
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-controls={open ? panelId : undefined}
		data-testid={testid}
		onclick={() => (open = !open)}
	>
		{@render trigger()}
	</button>
	{#if open}
		<div
			id={panelId}
			role="dialog"
			aria-label={label}
			class="glass-pop absolute top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border p-4 text-popover-foreground shadow-[var(--shadow-pop)] {align === 'right' ? 'right-0' : 'left-0'}"
			use:focusTrap={{ onclose: close }}
		>
			{@render children(close)}
		</div>
	{/if}
</div>
