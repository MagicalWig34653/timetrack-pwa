<script lang="ts">
	import { onMount } from 'svelte';
	import Clock from '@lucide/svelte/icons/clock';
	import FileQuestion from '@lucide/svelte/icons/file-question';
	import Lock from '@lucide/svelte/icons/lock';
	import ServerCrash from '@lucide/svelte/icons/server-crash';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { Button } from '#lib/components/ui/button/index.js';
	import { describeError, type ErrorKind } from '#lib/errors/describe.js';
	import { t } from '#lib/i18n/index.js';
	import { pwa } from '#lib/pwa/pwa.svelte.js';

	/**
	 * Designed error page (E1). `standalone` renders the full-page variant with the brand mark (root +error.svelte, also used
	 * when the app shell itself failed); otherwise it sits inside the app shell. Only the status, a generic text and an error
	 * id are shown, never the raw message or a stack trace.
	 */
	let {
		status,
		errorId,
		path,
		standalone = false,
		onretry
	}: { status: number; errorId?: string; path?: string; standalone?: boolean; onretry?: () => void } = $props();

	const view = $derived(describeError(status, pwa.browserOnline));
	const ICONS: Record<ErrorKind, typeof FileQuestion> = {
		not_found: FileQuestion,
		forbidden: Lock,
		unauthorized: Lock,
		server: ServerCrash,
		unexpected: TriangleAlert,
		offline: WifiOff
	};
	const Icon = $derived(ICONS[view.kind]);
	const links = [
		{ href: '/', key: 'errorpage.link_today' },
		{ href: '/calendar', key: 'errorpage.link_calendar' },
		{ href: '/week', key: 'errorpage.link_week' }
	] as const;
	// not found and forbidden are final: retrying the same address does not help
	const retryable = $derived(view.kind === 'server' || view.kind === 'unexpected' || view.kind === 'offline');

	let heading = $state<HTMLHeadingElement>();
	// move focus to the heading so screen readers announce the error and keyboard users start at the top
	onMount(() => heading?.focus({ preventScroll: true }));
</script>

<svelte:head><title>{t(view.titleKey)} – Timetrack</title></svelte:head>
<div class={standalone ? 'min-h-screen bg-[var(--sidebar)]' : ''}>
	<div class={standalone ? 'mx-auto flex min-h-screen w-full max-w-[30rem] flex-col justify-center gap-6 px-4 py-10' : 'mx-auto w-full max-w-[34rem] py-6 sm:py-12'}>
		{#if standalone}
			<div class="flex items-center justify-center gap-3">
				<span class="inline-flex size-[34px] items-center justify-center rounded-lg border bg-background text-ui-accent-ink" data-testid="brand-mark">
					<Clock class="size-[18px]" aria-hidden="true" />
				</span>
				<span class="text-[17px] font-semibold tracking-tight">{t('app.name')}</span>
			</div>
		{/if}
		<section
			role="alert"
			class="flex flex-col gap-5 rounded-[10px] border bg-card p-[22px] text-card-foreground shadow-[var(--shadow-card)] sm:p-7"
			data-testid="error-page"
			data-status={status}
			data-kind={view.kind}
		>
			<div class="flex items-start gap-4">
				<span class="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
					<Icon class="size-5" aria-hidden="true" />
				</span>
				<div class="min-w-0">
					<h1 bind:this={heading} tabindex="-1" class="text-[21px] leading-tight font-semibold outline-none sm:text-[24px]">{t(view.titleKey)}</h1>
					<p class="mt-1.5 text-[15px] text-muted-foreground">{t(view.textKey)}</p>
				</div>
			</div>

			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3.5 py-3 text-[13px]" data-testid="error-details">
				<dt class="text-muted-foreground">{t('errorpage.status')}</dt>
				<dd class="font-mono">{status}</dd>
				{#if path && view.kind === 'not_found'}
					<dt class="text-muted-foreground">{t('errorpage.requested')}</dt>
					<dd class="font-mono break-all" data-testid="error-path">{path}</dd>
				{/if}
				{#if errorId}
					<dt class="text-muted-foreground">{t('errorpage.error_id')}</dt>
					<dd class="font-mono" data-testid="error-id">{errorId}</dd>
				{/if}
			</dl>
			{#if errorId}<p class="-mt-2 text-[13px] text-muted-foreground">{t('errorpage.report_hint')}</p>{/if}

			{#if view.kind === 'unauthorized' || retryable}
				<div class="flex flex-wrap gap-2">
					{#if view.kind === 'unauthorized'}
						<Button href="/login">{t('errorpage.sign_in')}</Button>
					{:else}
						<Button onclick={() => (onretry ? onretry() : window.location.reload())} data-testid="error-retry">{t('errorpage.retry')}</Button>
						<Button variant="outline" onclick={() => window.location.reload()} data-testid="error-reload">{t('errorpage.reload')}</Button>
					{/if}
				</div>
			{/if}

			{#if view.kind === 'not_found' || view.kind === 'forbidden'}
				<nav aria-label={t('errorpage.links')} class="flex flex-col gap-2 border-t pt-4">
					<p class="text-[13px] text-muted-foreground">{t('errorpage.links')}</p>
					<ul class="flex flex-wrap gap-2">
						{#each links as link (link.href)}
							<li><Button variant="outline" size="sm" href={link.href}>{t(link.key)}</Button></li>
						{/each}
					</ul>
				</nav>
			{/if}
		</section>
	</div>
</div>
