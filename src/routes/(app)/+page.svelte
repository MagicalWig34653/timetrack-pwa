<script lang="ts">
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Card, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';

	const name = $derived(sessionStore.current?.account.displayName ?? '');
	const cards = [
		{ href: '/settings/passkeys', title: 'home.passkeys', text: 'home.passkeys_text' },
		{ href: '/settings/recovery', title: 'home.recovery', text: 'home.recovery_text' },
		{ href: '/settings/sessions', title: 'home.sessions', text: 'home.sessions_text' }
	] as const;
</script>

<PageHeader title={t('home.title', { name })} description={t('home.description')} />
<div class="grid gap-4 sm:grid-cols-3">
	{#each cards as card (card.href)}
		<a href={card.href} class="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
			<Card class="h-full transition-colors hover:bg-muted/50">
				<CardHeader>
					<CardTitle>{t(card.title)}</CardTitle>
					<CardDescription>{t(card.text)}</CardDescription>
				</CardHeader>
			</Card>
		</a>
	{/each}
</div>
