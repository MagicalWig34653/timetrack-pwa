<script lang="ts">
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { copyText } from '#lib/browser.js';
	import { t } from '#lib/i18n/index.js';
	import { tick } from 'svelte';

	let {
		open = $bindable(false),
		text,
		title = t('reports.copy.preview_title'),
		fallback = false,
		oncopied
	}: {
		open?: boolean;
		text: string;
		title?: string;
		/** true when the automatic copy failed: the text is selected for a manual copy */
		fallback?: boolean;
		oncopied?: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let area: HTMLTextAreaElement | null = $state(null);
	let manual = $state(false);
	const uid = $props.id();

	function show() {
		if (!dialog || dialog.open) return;
		if (typeof dialog.showModal === 'function') dialog.showModal();
		else dialog.setAttribute('open', '');
	}
	function hide() {
		if (!dialog?.open) return;
		if (typeof dialog.close === 'function') dialog.close();
		else dialog.removeAttribute('open');
	}

	$effect(() => {
		if (open) {
			show();
			manual = fallback;
			void tick().then(() => {
				if (fallback) selectAll();
			});
		} else hide();
	});

	function selectAll() {
		area?.focus();
		area?.select();
	}

	async function copyAgain() {
		if (await copyText(text)) {
			manual = false;
			oncopied?.();
			return;
		}
		// last resort: select the text and let the browser copy the selection
		selectAll();
		let done = false;
		try {
			done = document.execCommand('copy');
		} catch {
			done = false;
		}
		if (done) {
			manual = false;
			oncopied?.();
		} else manual = true;
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	class="m-auto w-[min(42rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50"
	data-testid="text-dialog"
	onclose={() => (open = false)}
>
	<div class="flex flex-col gap-3 p-4 sm:p-6">
		<div>
			<h2 id="{uid}-title" class="text-lg font-semibold">{title}</h2>
			<p class="text-sm text-muted-foreground">{t('reports.copy.preview_text')}</p>
		</div>
		{#if manual}<Alert variant="warning" data-testid="copy-fallback">{t('reports.copy.fallback')}</Alert>{/if}
		<Textarea bind:ref={area} readonly rows={14} value={text} class="font-mono text-sm" aria-label={t('reports.copy.text_label')} data-testid="text-preview" />
		<div class="flex flex-wrap justify-end gap-2">
			<Button type="button" onclick={copyAgain} data-testid="text-copy-again">{t('reports.copy.again')}</Button>
			<Button type="button" variant="outline" onclick={() => (open = false)}>{t('common.close')}</Button>
		</div>
	</div>
</dialog>
