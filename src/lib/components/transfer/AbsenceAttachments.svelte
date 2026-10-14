<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { FileMeta } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, localDateOf } from '#lib/time/dates.js';
	import { ATTACHMENT_ACCEPT, isAllowedAttachment } from '#lib/transfer/attachments.js';
	import { formatBytes } from '#lib/transfer/bytes.js';
	import { saveBlob } from '#lib/transfer/export.js';
	import { onMount } from 'svelte';

	let { absenceId }: { absenceId: string } = $props();

	let files = $state<FileMeta[]>([]);
	let loading = $state(true);
	let unavailable = $state(false);
	let picked = $state<File | null>(null);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let input: HTMLInputElement | undefined = $state();

	async function refresh() {
		try {
			files = await api.listAbsenceAttachments(absenceId);
		} catch (e) {
			if (e instanceof ApiError && (e.status === 404 || e.status === 501)) unavailable = true;
			else error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	onMount(refresh);

	function pick(file: File | undefined) {
		error = notice = '';
		picked = null;
		if (!file) return;
		if (!isAllowedAttachment(file)) error = t('attachments.error_type');
		else if (file.size === 0) error = t('attachments.error_empty');
		else picked = file;
	}

	/** 413 and 415 get their own German texts; everything else goes through the generic mapping. */
	function uploadError(e: unknown): string {
		if (e instanceof ApiError && (e.status === 413 || e.code === 'file_too_large')) return t('attachments.error_too_large');
		if (e instanceof ApiError && (e.status === 415 || e.code === 'unsupported_type')) return t('attachments.error_type');
		return errorMessage(e);
	}

	async function upload() {
		if (!picked || busy) return;
		busy = true;
		error = notice = '';
		let fileId: string | null = null;
		try {
			const meta = await api.uploadFile(picked);
			fileId = meta.id;
			await api.attachFile(absenceId, meta.id);
			picked = null;
			if (input) input.value = '';
			notice = t('attachments.uploaded');
			await refresh();
		} catch (e) {
			error = uploadError(e);
			// do not leave an unlinked upload behind when only the linking failed
			if (fileId) await api.deleteFile(fileId).catch(() => undefined);
		} finally {
			busy = false;
		}
	}

	async function download(file: FileMeta) {
		error = notice = '';
		try {
			const result = await api.downloadFile(file.id);
			saveBlob(result.blob, result.filename ?? file.name);
		} catch (e) {
			error = errorMessage(e);
		}
	}

	async function remove(file: FileMeta) {
		error = notice = '';
		busy = true;
		try {
			await api.detachFile(absenceId, file.id);
			// the document is not needed any more: delete the file itself too (best effort)
			await api.deleteFile(file.id).catch(() => undefined);
			notice = t('attachments.removed');
			await refresh();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-lg border p-3" aria-labelledby="attachments-heading-{absenceId}" data-testid="attachments">
	<div>
		<h4 id="attachments-heading-{absenceId}" class="text-sm font-medium">{t('attachments.title')}</h4>
		<p class="text-xs text-muted-foreground">{t('attachments.text')}</p>
	</div>
	{#if loading}
		<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
	{:else if unavailable}
		<p class="text-sm text-muted-foreground" data-testid="attachments-unavailable">{t('attachments.unavailable')}</p>
	{:else}
		{#if error}<Alert variant="destructive" data-testid="attachment-error">{error}</Alert>{/if}
		{#if notice}<Alert variant="success" data-testid="attachment-notice">{notice}</Alert>{/if}
		<ul class="flex flex-col gap-2" aria-label={t('attachments.list')} data-testid="attachment-list">
			{#each files as file (file.id)}
				<li class="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2 text-sm" data-testid="attachment">
					<span class="min-w-0 break-words">
						<span class="font-medium">{file.name}</span>
						<span class="block text-xs whitespace-nowrap text-muted-foreground">{formatBytes(file.size)} · {formatDateNumeric(localDateOf(file.createdAt))}</span>
					</span>
					<span class="flex gap-2">
						<Button type="button" variant="outline" size="sm" aria-label={t('attachments.download_label', { name: file.name })} onclick={() => download(file)}>{t('attachments.download')}</Button>
						<Button type="button" variant="destructive" size="sm" aria-label={t('attachments.remove_label', { name: file.name })} disabled={busy} onclick={() => remove(file)}>{t('attachments.remove')}</Button>
					</span>
				</li>
			{:else}
				<li class="text-sm text-muted-foreground">{t('attachments.empty')}</li>
			{/each}
		</ul>
		<div class="flex flex-wrap items-center gap-2">
			<input
				bind:this={input}
				type="file"
				class="sr-only"
				tabindex="-1"
				accept={ATTACHMENT_ACCEPT}
				aria-label={t('attachments.input')}
				data-testid="attachment-file"
				onchange={(e) => pick(e.currentTarget.files?.[0])}
			/>
			<Button type="button" variant="outline" size="sm" onclick={() => input?.click()} disabled={busy}>{t('attachments.choose')}</Button>
			{#if picked}
				<span class="text-sm" data-testid="attachment-picked">{t('attachments.selected', { name: picked.name, size: formatBytes(picked.size) })}</span>
				<Button type="button" size="sm" onclick={upload} disabled={busy}>{busy ? t('attachments.uploading') : t('attachments.upload')}</Button>
			{/if}
		</div>
		<p class="text-xs text-muted-foreground" data-testid="attachments-never-shared">{t('attachments.never_shared')}</p>
	{/if}
</section>
