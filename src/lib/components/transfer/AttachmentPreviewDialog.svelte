<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { FileMeta } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatBytes } from '#lib/transfer/bytes.js';
	import { saveBlob } from '#lib/transfer/export.js';
	import { MAX_TEXT_PREVIEW_BYTES, previewKind, previewMime, typeLabel } from '#lib/transfer/preview.js';

	/**
	 * Shows an attachment in the browser. The file is fetched with the session (the download endpoint answers with
	 * Content-Disposition attachment, so a plain link would only save it) and displayed from a blob URL:
	 * images as <img>, PDFs in the browser's viewer, plain text as text. Other types offer the download only.
	 */
	let { file, onclose }: { file: FileMeta | null; onclose: () => void } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let error = $state('');
	let blob = $state<Blob | null>(null);
	let url = $state('');
	let text = $state('');
	let closeButton: HTMLButtonElement | null = $state(null);
	const uid = $props.id();
	const kind = $derived(file ? previewKind(file) : 'none');
	/** Browsers without a built-in PDF viewer (some mobile and headless browsers) would show an empty frame. */
	const pdfInline = $derived(typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false);
	const tooBigForText = $derived(kind === 'text' && !!file && file.size > MAX_TEXT_PREVIEW_BYTES);

	function release() {
		if (url) URL.revokeObjectURL(url);
		url = '';
		blob = null;
		text = '';
	}

	$effect(() => {
		const current = file;
		if (!dialog) return;
		if (!current) {
			if (dialog.open) (typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open'));
			return;
		}
		if (!dialog.open) (typeof dialog.showModal === 'function' ? dialog.showModal() : dialog.setAttribute('open', ''));
		closeButton?.focus();
		let cancelled = false;
		status = 'loading';
		error = '';
		void (async () => {
			try {
				const result = await api.downloadFile(current.id);
				if (cancelled) return;
				const k = previewKind(current);
				blob = result.blob;
				if (k === 'text' && current.size <= MAX_TEXT_PREVIEW_BYTES) text = await result.blob.text();
				else if (k === 'image' || k === 'pdf') url = URL.createObjectURL(new Blob([result.blob], { type: previewMime(k, current) }));
				status = 'ready';
			} catch (e) {
				if (cancelled) return;
				error = errorMessage(e);
				status = 'error';
			}
		})();
		return () => {
			cancelled = true;
			release();
		};
	});

	/** Native close fires `close` (handled by onclose); without dialog support the parent is told directly. */
	function closeDialog() {
		if (dialog && typeof dialog.close === 'function') dialog.close();
		else onclose();
	}
	function download() {
		if (blob && file) saveBlob(blob, file.name);
	}
	function openInTab() {
		if (url) window.open(url, '_blank', 'noopener');
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	class="m-auto h-[min(48rem,calc(100dvh-2rem))] w-[min(56rem,calc(100vw-2rem))] glass-pop rounded-2xl border p-0 text-popover-foreground shadow-[var(--shadow-pop)]"
	data-testid="preview-dialog"
	onclose={onclose}
>
	<div class="flex h-full flex-col gap-3 p-4 sm:p-6">
		<div class="min-w-0">
			<h2 id="{uid}-title" class="truncate text-lg font-semibold" data-testid="preview-title">{file?.name ?? ''}</h2>
			{#if file}<p class="text-sm text-muted-foreground">{typeLabel(file)} · {formatBytes(file.size)}</p>{/if}
		</div>
		<div class="min-h-0 flex-1 overflow-auto rounded-lg border bg-background" data-testid="preview-body">
			{#if status === 'loading'}
				<p class="p-4 text-sm text-muted-foreground">{t('common.loading')}</p>
			{:else if status === 'error'}
				<div class="p-4"><Alert variant="destructive" data-testid="preview-error">{error}</Alert></div>
			{:else if status === 'ready' && kind === 'image' && url}
				<div class="flex h-full min-h-48 items-center justify-center p-2">
					<img src={url} alt={t('attachments.preview_alt', { name: file?.name ?? '' })} class="max-h-full max-w-full object-contain" data-testid="preview-image" />
				</div>
			{:else if status === 'ready' && kind === 'pdf' && url && pdfInline}
				<iframe src={url} title={t('attachments.preview_alt', { name: file?.name ?? '' })} class="h-full min-h-96 w-full" data-testid="preview-pdf"></iframe>
			{:else if status === 'ready' && kind === 'text' && !tooBigForText}
				<pre class="p-4 text-sm break-words whitespace-pre-wrap" data-testid="preview-text">{text}</pre>
			{:else if status === 'ready'}
				<p class="p-4 text-sm text-muted-foreground" data-testid="preview-unsupported">{tooBigForText ? t('attachments.preview_too_big') : kind === 'pdf' ? t('attachments.preview_no_pdf') : t('attachments.preview_unsupported')}</p>
			{/if}
		</div>
		<div class="flex flex-wrap justify-end gap-2">
			{#if status === 'ready' && url}
				<Button type="button" variant="outline" onclick={openInTab} data-testid="preview-new-tab">{t('attachments.open_tab')}</Button>
			{/if}
			<Button type="button" variant="outline" onclick={download} disabled={!blob} data-testid="preview-download">{t('attachments.download')}</Button>
			<Button type="button" bind:ref={closeButton} onclick={closeDialog} data-testid="preview-close">{t('common.close')}</Button>
		</div>
	</div>
</dialog>
