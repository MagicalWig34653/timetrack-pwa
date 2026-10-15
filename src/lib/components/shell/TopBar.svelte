<script lang="ts">
	import { page } from '$app/state';
	import Bell from '@lucide/svelte/icons/bell';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Menu from '@lucide/svelte/icons/menu';
	import User from '@lucide/svelte/icons/user';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { breadcrumbs } from '#lib/nav.js';
	import { unread } from '#lib/notifications/unread.svelte.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import AppearanceMenu from './AppearanceMenu.svelte';
	import Popover from './Popover.svelte';

	let {
		polling,
		onmenu,
		onsignout,
		menuOpen = false
	}: { polling: boolean; onmenu: () => void; onsignout: () => void; menuOpen?: boolean } = $props();

	const session = $derived(sessionStore.current);
	const crumbs = $derived(breadcrumbs(page.url.pathname));
</script>

<header class="glass-header sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b px-4 min-[760px]:px-6" data-testid="topbar">
	<button
		type="button"
		class="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground min-[760px]:hidden"
		aria-label={t('nav.menu_open')}
		aria-expanded={menuOpen}
		onclick={onmenu}
		data-testid="menu-button"
	>
		<Menu class="size-5" aria-hidden="true" />
	</button>

	<nav aria-label={t('nav.breadcrumbs')} class="min-w-0 flex-1">
		<ol class="flex min-w-0 items-center gap-1.5 text-sm">
			{#each crumbs as crumb, index (index)}
				{@const last = index === crumbs.length - 1}
				<li class="flex min-w-0 items-center gap-1.5 {last ? '' : 'max-[759px]:hidden'}">
					{#if index > 0}<ChevronRight class="size-3.5 shrink-0 text-muted-foreground max-[759px]:hidden" aria-hidden="true" />{/if}
					{#if crumb.href && !last}
						<a href={crumb.href} class="truncate text-muted-foreground hover:text-foreground">{crumb.label ? t(crumb.label) : crumb.text}</a>
					{:else}
						<span class="truncate {last ? 'font-medium text-foreground' : 'text-muted-foreground'}" aria-current={last ? 'page' : undefined}>{crumb.label ? t(crumb.label) : crumb.text}</span>
					{/if}
				</li>
			{/each}
		</ol>
	</nav>

	<div class="flex items-center gap-1">
		{#if polling}
			<a
				href="/notifications"
				class="relative inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
				aria-label={unread.count > 0 ? t('nav.notifications_unread', { count: unread.count }) : t('nav.notifications')}
				aria-current={page.url.pathname === '/notifications' ? 'page' : undefined}
				data-testid="bell"
			>
				<Bell class="size-5" aria-hidden="true" />
				{#if unread.count > 0}
					<span class="absolute top-1 right-1 min-w-4 rounded-full bg-ui-accent px-1 text-center text-[10px] leading-4 font-semibold text-ui-accent-foreground tabular-nums" data-testid="bell-badge">{unread.count > 99 ? '99+' : unread.count}</span>
				{/if}
			</a>
		{/if}
		<AppearanceMenu />
		{#if session}
			<Popover label={t('nav.account_menu')} testid="account-menu">
				{#snippet trigger()}<User class="size-5" aria-hidden="true" />{/snippet}
				{#snippet children(close)}
					<div class="flex flex-col gap-3">
						<p class="text-sm font-medium" data-testid="account-name">{session.account.displayName}</p>
						{#if !session.recovery}
							<a href="/settings/passkeys" class="text-sm hover:underline" onclick={close}>{t('nav.account')}</a>
						{/if}
						<Button variant="outline" onclick={() => (close(), onsignout())}>
							<LogOut aria-hidden="true" />
							{t('nav.sign_out')}
						</Button>
					</div>
				{/snippet}
			</Popover>
		{/if}
	</div>
</header>
