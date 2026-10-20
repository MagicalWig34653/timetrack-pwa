<script lang="ts">
	import { focusTrap } from '#lib/a11y/focus-trap.js';
	import { placePopover } from '#lib/a11y/position.js';
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';

	/**
	 * Small modal window with a blurred backdrop. From 760 px (the shell's `menu` breakpoint) it is a popover anchored
	 * to the trigger, below that a bottom sheet. Focus is trapped, Escape and a press on the backdrop close it and the
	 * focus returns to the trigger. The blur comes from the shared --bf-/--glass- tokens, so reduced transparency and
	 * missing backdrop-filter support fall back to opaque surfaces (layout.css).
	 */
	let {
		titleId,
		anchor = null,
		returnFocus = null,
		width = 440,
		onclose,
		children,
		...rest
	}: {
		titleId: string;
		anchor?: DOMRect | null;
		returnFocus?: HTMLElement | null;
		width?: number;
		onclose: () => void;
		children: Snippet;
		'data-testid'?: string;
	} = $props();

	let el = $state<HTMLElement | null>(null);
	let sheet = $state(false);
	let pos = $state<{ x: number; y: number } | null>(null);

	$effect(() => {
		const query = window.matchMedia('(max-width: 759px)');
		sheet = query.matches;
		const listener = () => (sheet = query.matches);
		query.addEventListener('change', listener);
		return () => query.removeEventListener('change', listener);
	});

	$effect(() => {
		if (sheet || !el) {
			pos = null;
			return;
		}
		const a = anchor ?? new DOMRect(window.innerWidth / 2 - width / 2, window.innerHeight / 3, width, 0);
		void tick().then(() => {
			if (!el) return;
			const box = el.getBoundingClientRect();
			pos = placePopover({ x: a.x, y: a.y, width: a.width, height: a.height }, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight });
		});
	});

	// Return focus to the trigger when the window goes away (the trap restores the previously focused element as well).
	$effect(() => {
		const target = returnFocus;
		return () => {
			// after the dialog's own teardown, so nothing else takes the focus back afterwards
			setTimeout(() => {
				if (target?.isConnected) target.focus();
			}, 0);
		};
	});
</script>

<div class="floating-scrim glass-scrim fixed inset-0 z-[70]" role="presentation" data-testid="floating-scrim" onpointerdown={onclose}></div>
<div
	bind:this={el}
	role="dialog"
	aria-modal="true"
	aria-labelledby={titleId}
	tabindex="-1"
	use:focusTrap={{ onclose, restoreFocus: false }}
	class="glass-pop fixed z-[71] overflow-auto border text-popover-foreground shadow-[var(--shadow-pop)] {sheet
		? 'floating-sheet inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)]'
		: 'floating-pop max-h-[calc(100dvh-1rem)] rounded-2xl'}"
	style={sheet ? '' : `width:min(${width}px, calc(100vw - 1rem)); left:${pos?.x ?? 0}px; top:${pos?.y ?? 0}px; opacity:${pos ? 1 : 0}`}
	data-sheet={sheet}
	data-testid={rest['data-testid'] ?? 'floating-panel'}
>
	{@render children()}
</div>
