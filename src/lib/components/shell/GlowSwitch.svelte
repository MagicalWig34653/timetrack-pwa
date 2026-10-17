<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { GLOW_IDS, type GlowId } from '#lib/theme/glow.js';
	import { theme } from '#lib/theme/theme.svelte.js';

	/** Segmented control for the glow level ("Leuchteffekt"); `compact` is used inside the palette popover. */
	let { compact = false }: { compact?: boolean } = $props();

	const labels: Record<GlowId, () => string> = {
		off: () => t('appearance.glow_off'),
		subtle: () => t('appearance.glow_subtle'),
		medium: () => t('appearance.glow_medium'),
		strong: () => t('appearance.glow_strong')
	};
</script>

<div class="flex flex-col gap-1.5">
	{#if compact}<span class="text-sm font-medium" id="glow-switch-label">{t('appearance.glow')}</span>{/if}
	<div class="glass-soft grid grid-cols-4 gap-1 rounded-lg p-1" role="radiogroup" aria-label={t('appearance.glow')} data-testid="glow-switch">
		{#each GLOW_IDS as id (id)}
			<button
				type="button"
				role="radio"
				aria-checked={theme.glow === id}
				data-testid="glow-{id}"
				class="inline-flex h-8 items-center justify-center rounded-md px-1 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm aria-checked:glow-accent"
				onclick={() => theme.setGlow(id)}
			>
				{labels[id]()}
			</button>
		{/each}
	</div>
</div>
