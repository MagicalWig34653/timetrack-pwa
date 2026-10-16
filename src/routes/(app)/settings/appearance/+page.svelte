<script lang="ts">
	import { onMount } from 'svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import AccentPicker from '#lib/components/shell/AccentPicker.svelte';
	import ModeSwitch from '#lib/components/shell/ModeSwitch.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { t } from '#lib/i18n/index.js';
	import { accentTokens, contrastRatio } from '#lib/theme/accent.js';
	import { theme } from '#lib/theme/theme.svelte.js';

	const tokens = $derived(accentTokens(theme.accent, theme.dark));
	const syncLabel = $derived(theme.sync === 'saved' ? 'appearance.sync_saved' : theme.sync === 'saving' ? 'appearance.sync_saving' : theme.sync === 'pending' ? 'appearance.sync_pending' : 'appearance.sync_idle');

	// another device may have changed the account's values since this session was loaded
	onMount(() => void theme.refreshFromServer());

	const ratio = $derived(tokens ? contrastRatio(tokens.ink, tokens.softResolved).toFixed(1) : '');
</script>

<PageHeader title={t('appearance.title')} description={t('appearance.description')} />

<div class="flex flex-col gap-4">
	<p class="text-[13px] text-muted-foreground" role="status" aria-live="polite" data-testid="appearance-sync" data-state={theme.sync}>{t(syncLabel)}</p>
	<Panel title={t('appearance.mode')}>
		<ModeSwitch />
	</Panel>

	<Panel title={t('appearance.accent')} description={t('appearance.accent_hint')}>
		<AccentPicker idPrefix="page-accent" />
	</Panel>

	<Panel title={t('appearance.transparency')} description={t('appearance.transparency_hint')}>
		<label class="flex items-center gap-3 text-sm">
			<Checkbox
				checked={theme.transparency === 'reduced'}
				onchange={(event) => theme.setTransparency(event.currentTarget.checked ? 'reduced' : 'system')}
				data-testid="transparency-toggle"
			/>
			{t('appearance.transparency_reduced')}
		</label>
	</Panel>

	<Panel title={t('appearance.preview')}>
		<div class="flex flex-col gap-4" data-testid="accent-preview">
			<div class="flex flex-wrap items-center gap-2">
				<Button>{t('appearance.preview_primary')}</Button>
				<Button variant="outline">{t('appearance.preview_secondary')}</Button>
				<StatusChip tone="accent">{t('appearance.preview_chip')}</StatusChip>
			</div>
			<p class="text-sm">
				<span class="font-medium text-ui-accent-ink">{t('appearance.preview_text')}</span>
				<span class="ml-2 text-[13px] text-muted-foreground tabular-nums">{t('appearance.contrast', { ratio })}</span>
			</p>
			<div class="rounded-lg bg-ui-accent-soft px-3 py-2 text-sm font-medium text-ui-accent-ink">{t('appearance.preview_nav')}</div>
		</div>
	</Panel>
</div>
