<script lang="ts">
	import { page } from '$app/state';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { returnTargetFromParam } from '#lib/pwa/core.js';

	// The service worker passes the originally requested page as ?from=; only a validated same-origin path is used.
	const target = $derived(returnTargetFromParam(page.url.searchParams.get('from')) ?? '/');
	function goBack() {
		window.location.assign(target);
	}
	// Back online: return to the requested page automatically.
	$effect(() => {
		window.addEventListener('online', goBack);
		return () => window.removeEventListener('online', goBack);
	});
</script>

<svelte:head><title>{t('pwa.offline_page_title')} – Timetrack</title></svelte:head>
<main class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
	<WifiOff class="size-10 text-muted-foreground" aria-hidden="true" />
	<h1 class="text-2xl font-semibold tracking-tight">{t('pwa.offline_page_title')}</h1>
	<p data-testid="offline-text">{t('pwa.offline_page_text')}</p>
	<Button onclick={goBack} data-testid="offline-retry" data-target={target}>{t('pwa.offline_retry')}</Button>
</main>
