<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { ReportSource } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateLong, formatDateNumeric, localDateOf } from '#lib/time/dates.js';
	import { ATTACHMENT_ACCEPT, isAllowedAttachment } from '#lib/transfer/attachments.js';
	import { formatBytes } from '#lib/transfer/bytes.js';
	import { saveBlob } from '#lib/transfer/export.js';
	import { weekDates } from '#lib/reports/weeks.js';

	let { year, week, onchange }: { year: number; week: number; onchange?: (count: number) => void } = $props();

	const uid = $props.id();
	const MAX_NOTE = 4000;
	let sources = $state<ReportSource[]>([]);
	let loading = $state(true);
	let error = $state('');
	let notice = $state('');
	let busy = $state(false);
	let noteText = $state('');
	let noteDate = $state('');
	let noteError = $state('');
	let picked = $state<File | null>(null);
	let input: HTMLInputElement | undefined = $state();
	const dates = $derived(weekDates(year, week));

	async function refresh() {
		try {
			sources = await api.listReportSources(year, week);
			onchange?.(sources.length);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}

	// reload whenever the shown week changes
	$effect(() => {
		void year;
		void week;
		loading = true;
		error = notice = noteError = '';
		noteText = noteDate = '';
		picked = null;
		void refresh();
	});

	async function addNote(e: SubmitEvent) {
		e.preventDefault();
		error = notice = noteError = '';
		const note = noteText.trim();
		if (note === '') return void (noteError = t('reports.sources.note_required'));
		if (note.length > MAX_NOTE) return void (noteError = t('reports.sources.note_too_long'));
		busy = true;
		try {
			await api.createReportSource({ year, week, date: noteDate || null, note });
			noteText = '';
			notice = t('reports.sources.added');
			await refresh();
		} catch (err) {
			error = errorMessage(err);
		} finally {
			busy = false;
		}
	}

	function pick(file: File | undefined) {
		error = notice = '';
		picked = null;
		if (!file) return;
		if (!isAllowedAttachment(file)) error = t('attachments.error_type');
		else if (file.size === 0) error = t('attachments.error_empty');
		else picked = file;
	}

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
			await api.createReportSource({ year, week, date: noteDate || null, fileId });
			picked = null;
			if (input) input.value = '';
			notice = t('reports.sources.added');
			await refresh();
		} catch (e) {
			error = uploadError(e);
			// do not leave an unlinked upload behind when only the linking failed
			if (fileId) await api.deleteFile(fileId).catch(() => undefined);
		} finally {
			busy = false;
		}
	}

	const nameOf = (s: ReportSource) => s.file?.name ?? (s.note ? s.note.slice(0, 40) : t('reports.sources.file_kind'));

	async function download(source: ReportSource) {
		if (!source.file) return;
		error = notice = '';
		try {
			const result = await api.downloadFile(source.file.id);
			saveBlob(result.blob, result.filename ?? source.file.name);
		} catch (e) {
			error = errorMessage(e);
		}
	}

	async function remove(source: ReportSource) {
		error = notice = '';
		busy = true;
		try {
			await api.deleteReportSource(source.id);
			// the backend keeps the file when a source is deleted (C15). The file was uploaded for this source only, so it is deleted
			// here exactly once (best effort; a 404 means it is already gone), otherwise it would stay behind as an orphan.
			if (source.file) await api.deleteFile(source.file.id).catch(() => undefined);
			notice = t('reports.sources.removed');
			await refresh();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="{uid}-title" data-testid="sources">
	<div>
		<h3 id="{uid}-title" class="text-base font-semibold">{t('reports.sources.title')}</h3>
		<p class="text-xs text-muted-foreground">{t('reports.sources.text')}</p>
	</div>

	{#if error}<Alert variant="destructive" data-testid="sources-error">{error}</Alert>{/if}
	{#if notice}<Alert variant="success" data-testid="sources-notice">{notice}</Alert>{/if}

	{#if loading}
		<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
	{:else}
		<ul class="flex flex-col gap-2" aria-label={t('reports.sources.list')} data-testid="source-list">
			{#each sources as source (source.id)}
				<li class="flex flex-wrap items-start justify-between gap-2 rounded-md border bg-background p-2 text-sm" data-testid="source">
					<span class="min-w-0 flex-1 break-words">
						{#if source.fileId}
							<span class="font-medium">{source.file?.name ?? t('reports.sources.file_removed')}</span>
							{#if source.file}<span class="block text-xs text-muted-foreground">{formatBytes(source.file.size)} · {formatDateNumeric(localDateOf(source.file.createdAt))}</span>{/if}
						{:else}
							<span class="whitespace-pre-wrap">{source.note}</span>
						{/if}
						<span class="block text-xs text-muted-foreground">{source.date ? formatDateLong(source.date) : t('reports.sources.whole_week')}</span>
					</span>
					<span class="flex gap-2">
						{#if source.file}
							<Button type="button" variant="outline" size="sm" aria-label={t('reports.sources.download_label', { name: source.file.name })} onclick={() => download(source)}>{t('reports.sources.download')}</Button>
						{/if}
						<Button type="button" variant="destructive" size="sm" disabled={busy} aria-label={t('reports.sources.remove_label', { name: nameOf(source) })} onclick={() => remove(source)}>{t('reports.sources.remove')}</Button>
					</span>
				</li>
			{:else}
				<li class="text-sm text-muted-foreground">{t('reports.sources.empty')}</li>
			{/each}
		</ul>

		<div class="flex flex-col gap-1.5">
			<Label for="{uid}-day">{t('reports.sources.day')}</Label>
			<Select id="{uid}-day" bind:value={noteDate} class="max-w-64" data-testid="source-day">
				<option value="">{t('reports.sources.whole_week')}</option>
				{#each dates as d (d)}<option value={d}>{formatDateLong(d)}</option>{/each}
			</Select>
		</div>

		<form class="flex flex-col gap-2" onsubmit={addNote} novalidate>
			<Label for="{uid}-note">{t('reports.sources.note')}</Label>
			<Textarea id="{uid}-note" bind:value={noteText} rows={3} placeholder={t('reports.sources.note_placeholder')} aria-invalid={noteError ? true : undefined} aria-describedby={noteError ? `${uid}-note-error` : undefined} data-testid="source-note" />
			{#if noteError}<p id="{uid}-note-error" class="text-xs text-destructive">{noteError}</p>{/if}
			<div><Button type="submit" variant="outline" size="sm" disabled={busy} data-testid="source-note-add">{t('reports.sources.note_add')}</Button></div>
		</form>

		<div class="flex flex-wrap items-center gap-2">
			<input
				bind:this={input}
				type="file"
				class="sr-only"
				tabindex="-1"
				accept={ATTACHMENT_ACCEPT}
				aria-label={t('attachments.input')}
				data-testid="source-file"
				onchange={(e) => pick(e.currentTarget.files?.[0])}
			/>
			<Button type="button" variant="outline" size="sm" disabled={busy} onclick={() => input?.click()}>{t('attachments.choose')}</Button>
			{#if picked}
				<span class="text-sm" data-testid="source-picked">{t('attachments.selected', { name: picked.name, size: formatBytes(picked.size) })}</span>
				<Button type="button" size="sm" disabled={busy} onclick={upload} data-testid="source-upload">{busy ? t('attachments.uploading') : t('attachments.upload')}</Button>
			{/if}
		</div>
		<p class="text-xs text-muted-foreground" data-testid="sources-never-shared">{t('reports.sources.never_shared')}</p>
	{/if}
</section>
