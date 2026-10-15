<script lang="ts">
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
</script>

<svelte:head><title>{t('pwa.offline_page_title')} – Timetrack</title></svelte:head>
<main class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
	<WifiOff class="size-10 text-muted-foreground" aria-hidden="true" />
	<h1 class="text-2xl font-semibold tracking-tight">{t('pwa.offline_page_title')}</h1>
	<p data-testid="offline-text">{t('pwa.offline_page_text')}</p>
	<Button onclick={() => window.location.assign('/')}>{t('pwa.offline_retry')}</Button>
</main>
