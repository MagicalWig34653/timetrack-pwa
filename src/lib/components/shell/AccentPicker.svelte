<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { t } from '#lib/i18n/index.js';
	import { ACCENT_PRESETS, DEFAULT_ACCENT, normalizeHex } from '#lib/theme/accent.js';
	import { theme } from '#lib/theme/theme.svelte.js';

	let { idPrefix = 'accent' }: { idPrefix?: string } = $props();

	const names = t('appearance.color_names').split(',');
	let custom = $state(theme.accent);
	let invalid = $state(false);

	function pick(hex: string) {
		theme.setAccent(hex);
		custom = hex;
		invalid = false;
	}
	function applyCustom() {
		const hex = normalizeHex(custom.startsWith('#') ? custom : `#${custom}`);
		if (!hex) {
			invalid = true;
			return;
		}
		pick(hex);
	}
</script>

<div class="flex flex-col gap-3" data-testid="accent-picker">
	<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={t('appearance.accent')}>
		{#each ACCENT_PRESETS as preset, index (preset.id)}
			<button
				type="button"
				role="radio"
				aria-checked={theme.accent === preset.hex}
				aria-label={names[index] ?? preset.id}
				title={names[index] ?? preset.id}
				data-testid="accent-{preset.id}"
				class="inline-flex size-8 items-center justify-center rounded-full border-2 border-transparent text-white transition-transform duration-150 hover:scale-105 aria-checked:border-foreground"
				style="background: {preset.hex}"
				onclick={() => pick(preset.hex)}
			>
				{#if theme.accent === preset.hex}<Check class="size-4" aria-hidden="true" />{/if}
			</button>
		{/each}
	</div>
	<div class="flex items-end gap-2">
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<label for="{idPrefix}-hex" class="text-sm font-medium">{t('appearance.accent_custom')}</label>
			<Input
				id="{idPrefix}-hex"
				bind:value={custom}
				placeholder={DEFAULT_ACCENT}
				maxlength={7}
				autocomplete="off"
				spellcheck={false}
				aria-invalid={invalid ? true : undefined}
				aria-describedby={invalid ? `${idPrefix}-hex-error` : undefined}
				onkeydown={(event) => event.key === 'Enter' && (event.preventDefault(), applyCustom())}
				data-testid="accent-hex"
			/>
		</div>
		<Button variant="outline" onclick={applyCustom} data-testid="accent-apply">{t('appearance.accent_apply')}</Button>
	</div>
	{#if invalid}<p id="{idPrefix}-hex-error" class="text-[13px] text-destructive" role="alert">{t('appearance.accent_invalid')}</p>{/if}
	<div class="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
		<span data-testid="accent-current">{t('appearance.accent_current', { hex: theme.accent.toUpperCase() })}</span>
		<Button variant="ghost" size="sm" onclick={() => pick(DEFAULT_ACCENT)}>{t('appearance.accent_reset')}</Button>
	</div>
</div>
