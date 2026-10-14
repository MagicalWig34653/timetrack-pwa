<script lang="ts">
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const baseLinks = [
		{ href: '/settings/work-model', label: 'nav.work_model' },
		{ href: '/settings/places', label: 'nav.places' },
		{ href: '/settings/account-time', label: 'nav.account_time' },
		{ href: '/settings/devices', label: 'nav.devices' },
		{ href: '/settings/sharing', label: 'nav.sharing' },
		{ href: '/settings/passkeys', label: 'nav.passkeys' },
		{ href: '/settings/recovery', label: 'nav.recovery' },
		{ href: '/settings/sessions', label: 'nav.sessions' }
	] as const;
	const links = $derived([...baseLinks, ...(sessionStore.current?.account.role === 'admin' ? ([{ href: '/settings/storage', label: 'nav.storage' }] as const) : [])]);
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
