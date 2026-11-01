<script lang="ts">
	// Settings landing (U8): every settings entry grouped by topic with its one-line description and a quick find.
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { t } from '#lib/i18n/index.js';
	import { moduleOfPath } from '#lib/modules/map.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { SETTINGS_ADMIN_LINKS, SETTINGS_DESCRIPTIONS, SETTINGS_LINKS, groupSettingsLinks, searchSettings } from '#lib/nav.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';

	const links = $derived(
		[...SETTINGS_LINKS, ...(sessionStore.current?.account.role === 'admin' ? SETTINGS_ADMIN_LINKS : [])].filter((link) => {
			const module = moduleOfPath(link.href);
			return !module || moduleStore.enabled(module);
		})
	);
	let query = $state('');
	const filtered = $derived(query.trim() ? searchSettings(links, query, (key) => t(key)) : links);
	const groups = $derived(groupSettingsLinks(filtered));
</script>

<PageHeader title={t('settings.landing.title')} description={t('settings.landing.description')} />

<div class="relative mb-6 max-w-md">
	<Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
	<input
		type="search"
		bind:value={query}
		placeholder={t('nav.search_placeholder')}
		aria-label={t('settings.landing.search')}
		data-testid="settings-landing-search"
		class="h-10 w-full rounded-lg border border-input bg-background/60 pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
	/>
</div>

<!-- reserved height: the result list may shrink while typing, the page below does not jump -->
<div class="min-h-[60vh]" data-testid="settings-landing" role="region" aria-label={t('nav.search_results')}>
	{#each groups as group (group.id)}
		<section class="mb-7" data-settings-group={group.id}>
			<h2 class="mb-3 border-b pb-2 text-sm font-bold tracking-wide text-foreground" data-testid="settings-group-heading">{t(group.label)}</h2>
			<ul class="grid gap-2 sm:grid-cols-2">
				{#each group.links as link (link.href)}
					<li>
						<a href={link.href} class="group flex h-full items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
							<span class="min-w-0">
								<span class="block text-sm font-medium">{t(link.label)}</span>
								{#if SETTINGS_DESCRIPTIONS[link.href]}<span class="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{t(SETTINGS_DESCRIPTIONS[link.href])}</span>{/if}
							</span>
							<ChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="text-sm text-muted-foreground">{t('nav.search_none')}</p>
	{/each}
</div>
