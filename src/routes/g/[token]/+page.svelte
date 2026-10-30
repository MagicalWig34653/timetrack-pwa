<script lang="ts">
	import { page } from '$app/state';
	import Clock from '@lucide/svelte/icons/clock';
	import { ApiError } from '#lib/api/errors.js';
	import type { PublicGroup } from '#lib/api/types.js';
	import PublicOrder from '#lib/components/groups/PublicOrder.svelte';
	import PublicPoll from '#lib/components/groups/PublicPoll.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { publicGroups } from '#lib/groups/public-api.js';
	import { errorMessage, t } from '#lib/i18n/index.js';

	/**
	 * Public page of a poll or order round (/g/<token>, ADR-0033). Reachable without login: it sits outside the (app) and
	 * (public) route groups, so neither the session guard nor the app shell applies. Nothing here touches the account session.
	 */
	const token = $derived(page.params.token ?? '');

	let phase = $state<'loading' | 'ready' | 'notfound' | 'error'>('loading');
	let group = $state<PublicGroup | null>(null);
	let message = $state('');

	async function load(): Promise<void> {
		try {
			group = await publicGroups.view(token);
			phase = 'ready';
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) phase = 'notfound';
			else {
				message = errorMessage(error);
				phase = 'error';
			}
		}
	}
	// a new link in the address bar (same page component, other params) starts from scratch
	$effect(() => {
		void token;
		phase = 'loading';
		group = null;
		void load();
	});

	/** reload after a change; failures keep the current page state */
	async function refresh(): Promise<void> {
		try {
			group = await publicGroups.view(token);
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) phase = 'notfound';
		}
	}

	async function retry() {
		phase = 'loading';
		await load();
	}
</script>

<svelte:head>
	<title>{group?.poll?.title ?? group?.order?.title ?? t('groups.public_title')} – Timetrack</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="min-h-screen bg-[var(--sidebar)]">
	<div class="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:py-10">
		<div class="flex items-center gap-2.5 text-muted-foreground">
			<span class="inline-flex size-7 items-center justify-center rounded-md border bg-background text-ui-accent-ink"><Clock class="size-4" aria-hidden="true" /></span>
			<span class="text-sm font-semibold tracking-tight">{t('app.name')}</span>
		</div>
		<main class="flex flex-col gap-5" aria-busy={phase === 'loading'}>
			{#if phase === 'loading'}
				<div class="flex flex-col gap-3" data-testid="group-loading" role="status">
					<div class="h-8 w-2/3 animate-pulse rounded-md bg-muted"></div>
					<div class="h-4 w-1/2 animate-pulse rounded-md bg-muted"></div>
					<div class="h-48 w-full animate-pulse rounded-[10px] bg-muted"></div>
					<span class="sr-only">{t('common.loading')}</span>
				</div>
			{:else if phase === 'notfound'}
				<div class="flex flex-col gap-2 rounded-[10px] border bg-card p-6" data-testid="group-notfound">
					<h1 class="text-xl font-semibold">{t('groups.notfound_title')}</h1>
					<p class="text-sm text-muted-foreground">{t('groups.notfound_text')}</p>
				</div>
			{:else if phase === 'error'}
				<div class="flex flex-col items-start gap-3 rounded-[10px] border bg-card p-6" data-testid="group-error" role="alert">
					<h1 class="text-xl font-semibold">{t('groups.error_title')}</h1>
					<p class="text-sm text-muted-foreground">{message}</p>
					<Button onclick={retry}>{t('groups.retry')}</Button>
				</div>
			{:else if group?.type === 'poll' && group.poll}
				{#key token}<PublicPoll {token} poll={group.poll} onrefresh={refresh} />{/key}
			{:else if group?.type === 'order' && group.order}
				{#key token}<PublicOrder {token} order={group.order} onrefresh={refresh} />{/key}
			{/if}
		</main>
		<footer class="mt-auto pt-6 text-xs text-muted-foreground">{t('groups.public_footer')}</footer>
	</div>
</div>
