<script lang="ts">
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { pwa } from '#lib/pwa/pwa.svelte.js';
</script>

{#if pwa.offline}
	<div role="status" data-testid="offline-banner" class="flex items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
		<WifiOff class="size-4 shrink-0" aria-hidden="true" />
		<span>{t('pwa.offline_banner')}</span>
	</div>
{/if}
{#if pwa.updateReady}
	<div role="status" data-testid="update-banner" class="flex flex-wrap items-center justify-center gap-3 border-b bg-card px-4 py-2 text-sm">
		<RefreshCw class="size-4 shrink-0" aria-hidden="true" />
		<span>{t('pwa.update_banner')} –</span>
		<Button size="sm" onclick={() => pwa.applyUpdate()}>{t('pwa.update_action')}</Button>
	</div>
{/if}
