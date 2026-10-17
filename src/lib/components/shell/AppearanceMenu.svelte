<script lang="ts">
	import Palette from '@lucide/svelte/icons/palette';
	import { t } from '#lib/i18n/index.js';
	import AccentPicker from './AccentPicker.svelte';
	import GlowSwitch from './GlowSwitch.svelte';
	import ModeSwitch from './ModeSwitch.svelte';
	import Popover from './Popover.svelte';
</script>

<Popover label={t('appearance.panel_label')} testid="appearance-menu">
	{#snippet trigger()}<Palette class="size-5" aria-hidden="true" />{/snippet}
	{#snippet children(close)}
		<div class="flex flex-col gap-4">
			<ModeSwitch />
			<AccentPicker idPrefix="menu-accent" compact />
			<GlowSwitch compact />
			<a href="/settings/appearance" class="text-[13px] font-medium text-ui-accent-ink hover:underline" onclick={close}>{t('appearance.title')}</a>
		</div>
	{/snippet}
</Popover>
