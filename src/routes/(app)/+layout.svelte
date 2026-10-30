<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import X from '@lucide/svelte/icons/x';
	import { focusTrap } from '#lib/a11y/focus-trap.js';
	import { t } from '#lib/i18n/index.js';
	import ErrorPage from '#lib/components/app/ErrorPage.svelte';
	import { newErrorId } from '#lib/errors/describe.js';
	import ModuleDisabled from '#lib/components/app/ModuleDisabled.svelte';
	import HelpDialog from '#lib/components/shell/HelpDialog.svelte';
	import SidebarNav from '#lib/components/shell/SidebarNav.svelte';
	import TopBar from '#lib/components/shell/TopBar.svelte';
	import { sectionShell } from '#lib/nav.js';
	import { moduleOfPath } from '#lib/modules/map.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { openSuggestions } from '#lib/notifications/open-suggestions.svelte.js';
	import { unread } from '#lib/notifications/unread.svelte.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const session = $derived(sessionStore.current);
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

	// The suggestion badge is refreshed on navigation while the automation module is on.
	$effect(() => {
		void page.url.pathname;
		if (polling && moduleStore.enabled('automation')) void openSuggestions.refresh();
		else openSuggestions.reset();
	});

	// Pages of one section keep the section shell (settings nav) mounted: only the page body below is re-created per route.
	// A key on the full pathname would rebuild the shell nav too (its scroll position and focus got lost on every click, J2).
	const planRoute = $derived(page.url.pathname === '/plan');
	const shellKey = $derived(sectionShell(page.url.pathname) ?? page.url.pathname);

	let menuOpen = $state(false);
	let helpOpen = $state(false);

	// the off-canvas menu closes after every navigation
	$effect(() => {
		void page.url.pathname;
		menuOpen = false;
	});

	function onWindowResize() {
		if (window.innerWidth >= 760) menuOpen = false;
	}

	async function signOut() {
		try {
			await sessionStore.signOut();
		} finally {
			await goto('/login', { replaceState: true, invalidateAll: true });
		}
	}
</script>

<svelte:window onresize={onWindowResize} />

<div class="min-h-screen">
	<aside class="glass-sidebar fixed inset-y-0 left-0 z-40 hidden w-64 border-r menu:block" data-testid="sidebar">
		<SidebarNav onhelp={() => (helpOpen = true)} />
	</aside>

	{#if menuOpen}
		<div class="fixed inset-0 z-50 menu:hidden" data-testid="mobile-menu">
			<button type="button" class="glass-scrim absolute inset-0" aria-label={t('nav.menu_close')} tabindex="-1" onclick={() => (menuOpen = false)}></button>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t('nav.main')}
				class="glass-sidebar absolute inset-y-0 left-0 w-[min(18rem,85vw)] border-r shadow-[var(--shadow-pop)]"
				use:focusTrap={{ onclose: () => (menuOpen = false) }}
			>
				<button
					type="button"
					class="absolute top-4 right-3 z-10 inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label={t('nav.menu_close')}
					onclick={() => (menuOpen = false)}
				>
					<X class="size-5" aria-hidden="true" />
				</button>
				<SidebarNav
					onnavigate={() => (menuOpen = false)}
					onhelp={() => {
						menuOpen = false;
						helpOpen = true;
					}}
				/>
			</div>
		</div>
	{/if}

	<div class="menu:pl-64">
		<TopBar {polling} {menuOpen} onmenu={() => (menuOpen = true)} onsignout={signOut} />
		<!-- U6: the planner uses the full width and less padding on landscape desktops, the grid needs every pixel. -->
		<main class="app-sheet mx-auto w-full max-w-[1240px] px-4 py-[22px] menu:px-6 menu:py-6 wide:px-10 wide:py-9 {planRoute ? 'fit:max-w-none! fit:px-5! fit:py-4!' : ''}">
			{#if blockedBy}
				<ModuleDisabled module={blockedBy} />
			{:else}
				<!-- A render/effect error in one page must not blank the shell: show the error panel with a retry (E1). Reset per route. -->
				{#key shellKey}
					<svelte:boundary onerror={(error) => console.error(error)}>
						{@render children()}
						{#snippet failed(_error, reset)}
							<ErrorPage status={500} errorId={newErrorId()} onretry={reset} />
						{/snippet}
					</svelte:boundary>
				{/key}
			{/if}
		</main>
	</div>
</div>

<HelpDialog bind:open={helpOpen} />
