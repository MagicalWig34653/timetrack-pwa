<script lang="ts">
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { t } from '#lib/i18n/index.js';
	import { theme, type ThemeMode } from '#lib/theme/theme.svelte.js';

	const modes: { id: ThemeMode; label: () => string; icon: typeof Sun }[] = [
		{ id: 'system', label: () => t('appearance.mode_system'), icon: Monitor },
		{ id: 'light', label: () => t('appearance.mode_light'), icon: Sun },
		{ id: 'dark', label: () => t('appearance.mode_dark'), icon: Moon }
	];
</script>

<div class="grid grid-cols-3 gap-1 rounded-lg glass-soft p-1" role="radiogroup" aria-label={t('appearance.mode')} data-testid="mode-switch">
	{#each modes as mode (mode.id)}
		<button
			type="button"
			role="radio"
			aria-checked={theme.mode === mode.id}
			data-testid="mode-{mode.id}"
			class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm aria-checked:glow-accent"
			onclick={() => theme.setMode(mode.id)}
		>
			<mode.icon class="size-4" aria-hidden="true" />
			{mode.label()}
		</button>
	{/each}
</div>
