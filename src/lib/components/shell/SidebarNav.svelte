<script lang="ts">
	import { page } from '$app/state';
	import Bell from '@lucide/svelte/icons/bell';
	import CircleHelp from '@lucide/svelte/icons/circle-question-mark';
	import Clock from '@lucide/svelte/icons/clock';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import Shield from '@lucide/svelte/icons/shield';
	import { t } from '#lib/i18n/index.js';
	import { moduleOfPath } from '#lib/modules/map.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { NAV_GROUPS, SETTINGS_ADMIN_LINKS, SETTINGS_LINKS, searchSettings } from '#lib/nav.js';
	import { openSuggestions } from '#lib/notifications/open-suggestions.svelte.js';
	import { unread } from '#lib/notifications/unread.svelte.js';
	import { pwa } from '#lib/pwa/pwa.svelte.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import NavIcon from './NavIcon.svelte';

	let { onnavigate, onhelp }: { onnavigate?: () => void; onhelp?: () => void } = $props();

	const isAdmin = $derived(sessionStore.current?.account.role === 'admin');
	const recovery = $derived(!!sessionStore.current?.recovery);
	const moduleOn = (href: string) => {
		const module = moduleOfPath(href);
		return !module || moduleStore.enabled(module);
	};
	const groups = $derived(
		NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin)
			.map((group) => ({ ...group, items: group.items.filter((item) => moduleOn(item.href)) }))
			.filter((group) => group.items.length > 0)
	);
	const settingsLinks = $derived([...SETTINGS_LINKS, ...(isAdmin ? SETTINGS_ADMIN_LINKS : [])].filter((link) => moduleOn(link.href)));

	let query = $state('');
	const results = $derived(searchSettings(settingsLinks, query, (key) => t(key)));

	function isActive(item: { href: string; prefix: boolean; alsoActive?: string[] }): boolean {
		const path = page.url.pathname;
		const on = (href: string) => path === href || path.startsWith(href + '/');
		return item.prefix ? on(item.href) || (item.alsoActive?.some(on) ?? false) : path === item.href;
	}
	const settingsActive = $derived(page.url.pathname.startsWith('/settings'));
	const accountActive = $derived(['/settings/passkeys', '/settings/identities', '/settings/recovery', '/settings/sessions'].includes(page.url.pathname));

	const itemClass =
		'flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground aria-[current=page]:bg-ui-accent-soft aria-[current=page]:text-ui-accent-ink aria-[current=page]:shadow-[var(--glow-nav)]';
</script>

<div class="flex h-full min-h-0 flex-col">
	<a href="/" class="flex items-center gap-3 px-5 pt-4 pb-3" onclick={onnavigate} aria-label={t('app.name')}>
		<span class="inline-flex size-[34px] items-center justify-center rounded-lg border bg-background text-ui-accent-ink" data-testid="brand-mark">
			<Clock class="size-[18px]" aria-hidden="true" />
		</span>
		<span class="text-[17px] font-semibold tracking-tight">{t('app.name')}</span>
	</a>

	{#if !recovery}
		<div class="px-3 pb-2">
			<div class="relative">
				<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
				<input
					type="search"
					bind:value={query}
					placeholder={t('nav.search_placeholder')}
					aria-label={t('nav.search_settings')}
					data-testid="settings-search"
					class="h-10 w-full rounded-lg border border-input bg-background/60 pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>
			{#if query.trim()}
				<ul class="mt-2 flex flex-col gap-0.5" aria-label={t('nav.search_results')} data-testid="settings-search-results">
					{#each results as link (link.href)}
						<li>
							<a
								href={link.href}
								class={itemClass}
								onclick={() => {
									query = '';
									onnavigate?.();
								}}>{t(link.label)}</a
							>
						</li>
					{:else}
						<li class="px-3 py-2 text-[13px] text-muted-foreground">{t('nav.search_none')}</li>
					{/each}
				</ul>
			{/if}
		</div>

		<nav aria-label={t('nav.main')} class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
			{#each groups as group (group.id)}
				<div class="mt-2 first:mt-0" data-testid="nav-group-{group.id}">
					<p class="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t(group.label)}</p>
					<ul class="flex flex-col gap-0.5">
						{#each group.items as item (item.href)}
							<li>
								<a href={item.href} class={itemClass} aria-current={isActive(item) ? 'page' : undefined} onclick={onnavigate}>
									<NavIcon name={item.icon} />
									<span class="min-w-0 flex-1 truncate">{t(item.label)}</span>
									{#if item.badge === 'suggestions' && openSuggestions.count > 0}
										<span class="rounded-full bg-ui-accent px-1.5 text-[11px] leading-[18px] font-semibold text-ui-accent-foreground tabular-nums" data-testid="suggestions-badge" aria-label={t('nav.open_suggestions', { count: openSuggestions.count })}>{openSuggestions.count}</span>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>

		<div class="flex flex-col gap-0.5 border-t px-3 py-2" data-testid="sidebar-bottom">
			<a href="/notifications" class={itemClass} aria-current={page.url.pathname === '/notifications' ? 'page' : undefined} onclick={onnavigate} data-testid="nav-notifications">
				<Bell class="size-[18px] shrink-0" aria-hidden="true" />
				<span class="min-w-0 flex-1">{t('nav.notifications')}</span>
				{#if unread.count > 0}
					<span class="rounded-full bg-ui-accent px-1.5 text-[11px] leading-[18px] font-semibold text-ui-accent-foreground tabular-nums" data-testid="nav-unread" aria-hidden="true">{unread.count > 99 ? '99+' : unread.count}</span>
				{/if}
			</a>
			<a href="/settings" class={itemClass} aria-current={settingsActive && !accountActive ? 'page' : undefined} onclick={onnavigate}>
				<Settings class="size-[18px] shrink-0" aria-hidden="true" />
				<span>{t('nav.settings')}</span>
			</a>
			<a href="/settings/passkeys" class={itemClass} aria-current={accountActive ? 'page' : undefined} onclick={onnavigate}>
				<Shield class="size-[18px] shrink-0" aria-hidden="true" />
				<span>{t('nav.account')}</span>
			</a>
			<button type="button" class="{itemClass} w-full" onclick={onhelp}>
				<CircleHelp class="size-[18px] shrink-0" aria-hidden="true" />
				<span>{t('nav.help')}</span>
			</button>
		</div>
	{:else}
		<div class="flex-1"></div>
	{/if}

	<div class="flex items-center gap-2 border-t px-5 py-2.5 text-[13px] text-muted-foreground" data-testid="status-line" role="status">
		<span class="size-2 rounded-full {pwa.offline ? 'bg-amber-500' : 'bg-emerald-500'}" aria-hidden="true"></span>
		<span>{pwa.offline ? t('status.offline') : t('status.online')}</span>
	</div>
</div>
