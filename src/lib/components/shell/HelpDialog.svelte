<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			if (typeof dialog.showModal === 'function') dialog.showModal();
			else dialog.setAttribute('open', '');
		} else if (!open && dialog.open) {
			if (typeof dialog.close === 'function') dialog.close();
			else dialog.removeAttribute('open');
		}
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="help-title"
	class="glass-pop m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border p-0 text-popover-foreground shadow-[var(--shadow-pop)]"
	data-testid="help-dialog"
	onclose={() => (open = false)}
>
	<div class="flex flex-col gap-4 p-6">
		<div>
			<h2 id="help-title" class="text-[21px] font-semibold">{t('help.title')}</h2>
			<p class="mt-1 text-[13px] text-muted-foreground">{t('help.intro')}</p>
		</div>
		<ul class="list-disc space-y-1.5 pl-5 text-sm">
			<li>{t('help.item_timer')}</li>
			<li>{t('help.item_time')}</li>
			<li>{t('help.item_settings')}</li>
			<li>{t('help.item_search')}</li>
		</ul>
		<div class="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
			{#if moduleStore.enabled('mcp')}
				<Button variant="outline" href="/settings/mcp-help" onclick={() => (open = false)}>{t('help.mcp')}</Button>
			{/if}
			<Button onclick={() => (open = false)}>{t('common.close')}</Button>
		</div>
	</div>
</dialog>
