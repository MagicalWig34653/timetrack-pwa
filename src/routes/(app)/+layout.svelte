<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Bell from '@lucide/svelte/icons/bell';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import ModuleDisabled from '#lib/components/app/ModuleDisabled.svelte';
	import { moduleOfPath } from '#lib/modules/map.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { ADMIN_LINKS, MAIN_LINKS } from '#lib/nav.js';
	import { unread } from '#lib/notifications/unread.svelte.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const session = $derived(sessionStore.current);
	const links = $derived(
		[...MAIN_LINKS, ...(session?.account.role === 'admin' ? ADMIN_LINKS : [])]
			.filter((link) => {
				const module = moduleOfPath(link.href);
				return !module || moduleStore.enabled(module);
			})
			.map((link) => ({ ...link, label: t(link.label) }))
	);
	/** module of the current page when that module is switched off: the page shows the notice instead of its content */
	const blockedBy = $derived.by(() => {
		const module = moduleOfPath(page.url.pathname);
		return module && !moduleStore.enabled(module) ? module : null;
	});

	// The bell polls while a regular (non-recovery) session is open; polling pauses when the tab is hidden.
	const polling = $derived(!!session && !session.recovery);
	$effect(() => {
		if (!polling) return;
		return unread.start();
	});

	function isActive(link: { href: string; prefix: boolean; section?: string }): boolean {
		const path = page.url.pathname;
		if (link.section) return path === link.section || path.startsWith(link.section + '/');
		return link.prefix ? path === link.href || path.startsWith(link.href + '/') : path === link.href;
	}

	async function signOut() {
		try {
			await sessionStore.signOut();
		} finally {
			await goto('/login', { replaceState: true, invalidateAll: true });
		}
	}
</script>

<div class="min-h-screen">
	<header class="border-b bg-card">
		<div class="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
			<span class="font-semibold tracking-tight">{t('app.name')}</span>
			<div class="flex items-center gap-3">
				{#if session}
					<span class="hidden text-sm text-muted-foreground sm:inline">{session.account.displayName}</span>
				{/if}
				{#if polling}
					<a
						href="/notifications"
						class="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
						aria-label={unread.count > 0 ? t('nav.notifications_unread', { count: unread.count }) : t('nav.notifications')}
						aria-current={page.url.pathname === '/notifications' ? 'page' : undefined}
						data-testid="bell"
					>
						<Bell class="size-5" aria-hidden="true" />
						{#if unread.count > 0}
							<span class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground" data-testid="bell-badge">{unread.count > 99 ? '99+' : unread.count}</span>
						{/if}
					</a>
				{/if}
				<Button variant="outline" size="sm" onclick={signOut}>{t('nav.sign_out')}</Button>
			</div>
		</div>
		{#if session && !session.recovery}
			<nav aria-label={t('nav.main')} class="mx-auto max-w-4xl overflow-x-auto px-4">
				<ul class="flex gap-1 pb-2">
					{#each links as link (link.href)}
						<li>
							<a
								href={link.href}
								aria-current={isActive(link) ? 'page' : undefined}
								class="inline-block rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
							>
								{link.label}
							</a>
						</li>
					{/each}
				</ul>
			</nav>
		{/if}
	</header>
	<main class="mx-auto max-w-4xl px-4 py-8">
		{#if blockedBy}
			<ModuleDisabled module={blockedBy} />
		{:else}
			{@render children()}
		{/if}
	</main>
</div>
