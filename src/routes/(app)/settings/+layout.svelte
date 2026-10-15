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

<nav aria-label={t('nav.settings')} class="mb-6 overflow-x-auto" data-testid="settings-tabs">
	<ul class="flex gap-1 border-b">
		{#each links as link (link.href)}
			<li>
				<a
					href={link.href}
					aria-current={page.url.pathname === link.href ? 'page' : undefined}
					class="-mb-px inline-flex h-10 items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground aria-[current=page]:border-ui-accent aria-[current=page]:text-ui-accent-ink"
				>
					{t(link.label)}
				</a>
			</li>
		{/each}
	</ul>
</nav>
<div class="max-w-[820px]">
	{@render children()}
</div>
