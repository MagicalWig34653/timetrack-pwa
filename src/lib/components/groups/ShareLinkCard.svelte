<script lang="ts">
	import Share2 from '@lucide/svelte/icons/share-2';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';

	/**
	 * Share link of a poll or order. The owner view always carries it (contract 0.37.1); rows from before that have none until
	 * the link is renewed. With `url` the card shows it with copy and share buttons, `fresh` adds the "just created" note.
	 * Without `url` a note explains how to get a new link.
	 */
	let {
		url,
		fresh = false,
		title,
		busy = false,
		onrotate,
		ondismiss
	}: { url?: string; fresh?: boolean; title: string; busy?: boolean; onrotate: () => void; ondismiss?: () => void } = $props();

	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
	let confirming = $state(false);

	async function share() {
		try {
			await navigator.share({ title, url });
		} catch {
			// cancelled by the user
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-[10px] border bg-card p-4" aria-labelledby="share-link-title" data-testid="share-link-card">
	<h2 id="share-link-title" class="text-base font-semibold">{t('groups.link_title')}</h2>
	{#if url}
		<div class="flex flex-col gap-2" data-testid={fresh ? 'share-link-fresh' : 'share-link-known'}>
			<p class="text-sm text-muted-foreground">{t(fresh ? 'groups.link_fresh_note' : 'groups.link_known_note')}</p>
			<div class="flex flex-col gap-2">
				<input readonly value={url} aria-label={t('groups.link_title')} class="h-10 w-full rounded-lg border bg-background px-3 font-mono text-sm" onfocus={(e) => e.currentTarget.select()} data-testid="share-link-url" />
				<div class="flex flex-wrap items-center gap-2">
					<CopyButton text={url} label={t('groups.link_copy')} />
					{#if canShare}<Button size="sm" variant="outline" onclick={share}><Share2 />{t('groups.link_share')}</Button>{/if}
					{#if fresh && ondismiss}<Button size="sm" variant="ghost" onclick={ondismiss} class="sm:ml-auto">{t('groups.link_saved')}</Button>{/if}
				</div>
			</div>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground" data-testid="share-link-hidden">{t('groups.link_hidden_note')}</p>
	{/if}
	{#if confirming}
		<div class="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm" data-testid="rotate-confirm">
			<p>{t('groups.rotate_text')}</p>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="destructive" disabled={busy} onclick={() => { confirming = false; onrotate(); }}>{t('groups.rotate_confirm')}</Button>
				<Button size="sm" variant="outline" onclick={() => (confirming = false)}>{t('common.cancel')}</Button>
			</div>
		</div>
	{:else}
		<div><Button size="sm" variant="outline" disabled={busy} onclick={() => (confirming = true)}>{t('groups.rotate')}</Button></div>
	{/if}
</section>
