<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const session = $derived(sessionStore.current);
	const links = $derived([
		{ href: '/', label: t('nav.home'), prefix: false },
		{ href: '/time', label: t('nav.time'), prefix: true },
		{ href: '/suggestions', label: t('nav.suggestions'), prefix: true },
		{ href: '/settings/work-model', label: t('nav.settings'), prefix: false, section: '/settings' },
		...(session?.account.role === 'admin' ? [{ href: '/admin/invitations', label: t('nav.invitations'), prefix: true }] : [])
	]);

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
		{@render children()}
	</main>
</div>
