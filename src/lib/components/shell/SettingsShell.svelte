<script lang="ts">
	// Section shell of the settings pages (nav + content column). Used by the settings layout and by /admin/mail,
	// which is listed in the settings nav; without the shell the nav would vanish and the content would jump (J1).
	import { page } from '$app/state';
	import ErrorPage from '#lib/components/app/ErrorPage.svelte';
	import { newErrorId } from '#lib/errors/describe.js';
	import { t } from '#lib/i18n/index.js';
	import { moduleOfPath } from '#lib/modules/map.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { SETTINGS_ADMIN_LINKS, SETTINGS_LINKS, groupSettingsLinks } from '#lib/nav.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const links = $derived(
		[...SETTINGS_LINKS, ...(sessionStore.current?.account.role === 'admin' ? SETTINGS_ADMIN_LINKS : [])].filter((link) => {
			const module = moduleOfPath(link.href);
			return !module || moduleStore.enabled(module);
		})
	);
	const groups = $derived(groupSettingsLinks(links));
	const current = $derived(links.find((link) => link.href === page.url.pathname));
	// Phones: the grouped list is folded behind one button; wide screens always show it.
	let open = $state(false);

	$effect(() => {
		// navigating folds the list again
		void page.url.pathname;
		open = false;
	});
</script>

<div class="wide:grid wide:grid-cols-[13.5rem_minmax(0,1fr)] wide:items-start wide:gap-8">
	<!-- sticky below the 60 px top bar; scrolls on its own when taller than the window, so every entry stays reachable -->
	<div class="mb-5 wide:sticky wide:top-[76px] wide:mb-0 wide:max-h-[calc(100vh-92px)] wide:overflow-y-auto wide:overscroll-contain" data-testid="settings-nav-sticky">
		<button
			type="button"
			class="flex h-10 w-full items-center justify-between rounded-lg border bg-card px-3 text-sm font-medium wide:hidden"
			aria-expanded={open}
			aria-controls="settings-nav-list"
			data-testid="settings-nav-toggle"
			onclick={() => (open = !open)}
		>
			<span>{current ? t(current.label) : t('nav.settings')}</span>
			<ChevronDown class="size-4 transition-transform {open ? 'rotate-180' : ''}" aria-hidden="true" />
		</button>
		<nav aria-label={t('nav.settings')} id="settings-nav-list" class="{open ? 'mt-2 block' : 'hidden'} wide:mt-0 wide:block" data-testid="settings-tabs">
			<div class="flex flex-col gap-4 rounded-lg border bg-card p-2 wide:rounded-none wide:border-0 wide:bg-transparent wide:p-0">
				{#each groups as group (group.id)}
					<div data-settings-group={group.id}>
						<h2 class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t(group.label)}</h2>
						<ul class="flex flex-col gap-0.5">
							{#each group.links as link (link.href)}
								<li>
									<a
										href={link.href}
										aria-current={page.url.pathname === link.href ? 'page' : undefined}
										class="flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground aria-[current=page]:bg-ui-accent/10 aria-[current=page]:text-ui-accent-ink aria-[current=page]:shadow-[var(--glow-nav)]"
									>
										{t(link.label)}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</nav>
	</div>
	<div class="max-w-[820px] min-w-0" data-testid="settings-content">
		<!-- the page body is re-created per route (and an error stays confined to it); the nav above stays mounted (J2) -->
		{#key page.url.pathname}
			<svelte:boundary onerror={(error) => console.error(error)}>
				{@render children()}
				{#snippet failed(_error, reset)}
					<ErrorPage status={500} errorId={newErrorId()} onretry={reset} />
				{/snippet}
			</svelte:boundary>
		{/key}
	</div>
</div>
