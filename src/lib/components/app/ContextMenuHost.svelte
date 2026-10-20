<script lang="ts">
	import { contextMenu } from '#lib/a11y/context-menu.svelte.js';
	import { navigate, typeahead } from '#lib/a11y/menu-nav.js';
	import { clampMenu } from '#lib/a11y/position.js';
	import { t } from '#lib/i18n/index.js';
	import { tick } from 'svelte';

	// One host for the whole app: the menu is rendered once, at the pointer, above everything else.
	const menu = $derived(contextMenu.current);
	let el = $state<HTMLElement | null>(null);
	let pos = $state({ x: 0, y: 0 });
	let active = $state(-1);
	let ready = $state(false);
	let buffer = '';
	let bufferTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!menu || !el) return;
		const rect = el.getBoundingClientRect();
		pos = clampMenu(menu.point, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
		active = navigate(menu.items, -1, 'first');
		ready = true;
		void tick().then(() => items()[active]?.focus());
		return () => (ready = false);
	});

	// Anything that moves the page under the menu closes it.
	$effect(() => {
		if (!menu) return;
		const close = () => contextMenu.close(false);
		window.addEventListener('scroll', close, true);
		window.addEventListener('wheel', close, { passive: true, capture: true });
		window.addEventListener('resize', close);
		window.addEventListener('blur', close);
		return () => {
			window.removeEventListener('scroll', close, true);
			window.removeEventListener('wheel', close, true);
			window.removeEventListener('resize', close);
			window.removeEventListener('blur', close);
		};
	});

	const items = () => Array.from(el?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
	// Index in menu.items -> index among rendered menuitems
	const entryIndex = (i: number) => (menu ? menu.items.slice(0, i).filter((e) => !e.separator).length : -1);

	function focusEntry(index: number) {
		if (index < 0) return;
		active = index;
		items()[entryIndex(index)]?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (!menu) return;
		const moves: Record<string, 'next' | 'prev' | 'first' | 'last'> = { ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', End: 'last' };
		if (event.key in moves) {
			event.preventDefault();
			focusEntry(navigate(menu.items, active, moves[event.key]));
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			contextMenu.close();
		} else if (event.key === 'Tab') {
			event.preventDefault();
			contextMenu.close();
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			const entry = menu.items[active];
			if (entry && !entry.separator) select(entry.disabled ? null : entry.onselect);
		} else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			clearTimeout(bufferTimer);
			buffer += event.key;
			bufferTimer = setTimeout(() => (buffer = ''), 700);
			focusEntry(typeahead(menu.items, buffer, active));
		}
	}

	function select(action: (() => void) | null) {
		if (!action) return;
		contextMenu.close();
		// After the menu is gone so a dialog opened by the action takes focus from the restored trigger.
		queueMicrotask(action);
	}
</script>

<svelte:window onkeydown={(e) => menu && e.key === 'Escape' && onKeydown(e)} />

{#if menu}
	<!-- transparent catcher: a press anywhere else closes the menu -->
	<div class="fixed inset-0 z-[80]" role="presentation" data-testid="context-menu-scrim" onpointerdown={() => contextMenu.close(false)} oncontextmenu={(e) => { e.preventDefault(); contextMenu.close(false); }}></div>
	<div
		bind:this={el}
		role="menu"
		tabindex="-1"
		aria-label={menu.label || t('contextmenu.label')}
		class="glass-pop fixed z-[81] min-w-48 max-w-[min(20rem,calc(100vw-1rem))] overflow-auto rounded-xl border p-1 text-sm text-popover-foreground shadow-[var(--shadow-pop)] outline-none"
		style="left:{pos.x}px; top:{pos.y}px; max-height:calc(100dvh - 1rem); visibility:{ready ? 'visible' : 'hidden'}"
		data-testid="context-menu"
		onkeydown={onKeydown}
	>
		{#each menu.items as entry, i (i)}
			{#if entry.separator}
				<div role="separator" class="my-1 h-px bg-border"></div>
			{:else}
				<button
					type="button"
					role="menuitem"
					tabindex="-1"
					disabled={entry.disabled}
					aria-disabled={entry.disabled || undefined}
					data-id={entry.id}
					class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 {entry.danger ? 'text-destructive' : ''}"
					onpointermove={() => (active = i)}
					onclick={() => select(entry.onselect)}
				>
					{#if entry.icon}<entry.icon class="size-4 shrink-0" />{:else}<span class="size-4 shrink-0"></span>{/if}
					<span class="flex-1 truncate">{entry.label}</span>
					{#if entry.shortcut}<kbd class="ml-4 text-xs text-muted-foreground">{entry.shortcut}</kbd>{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}
