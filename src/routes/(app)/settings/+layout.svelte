<script lang="ts">
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.js';
	import { moduleOfPath } from '#lib/modules/map.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { SETTINGS_ADMIN_LINKS, SETTINGS_LINKS } from '#lib/nav.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const links = $derived(
		[...SETTINGS_LINKS, ...(sessionStore.current?.account.role === 'admin' ? SETTINGS_ADMIN_LINKS : [])].filter((link) => {
			const module = moduleOfPath(link.href);
			return !module || moduleStore.enabled(module);
		})
	);
</script>

<nav aria-label={t('nav.settings')} class="-mt-4 mb-6 overflow-x-auto">
	<ul class="flex gap-1 border-b pb-2">
		{#each links as link (link.href)}
			<li>
				<a
					href={link.href}
					aria-current={page.url.pathname === link.href ? 'page' : undefined}
					class="inline-block rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
				>
					{t(link.label)}
				</a>
			</li>
		{/each}
	</ul>
</nav>
{@render children()}
