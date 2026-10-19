<script lang="ts">
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import ConfirmDialog from '#lib/components/app/ConfirmDialog.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import BindingPicker from '#lib/components/vacation-form/BindingPicker.svelte';
	import PdfCanvas from '#lib/components/vacation-form/PdfCanvas.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import Field from '#lib/components/app/Field.svelte';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { formatBytes } from '#lib/transfer/bytes.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import type { FormTemplateStore } from '#lib/vacation-form/form-template-store.js';
	import { DATE_FORMATS, formatFormDate, type DateFormatId } from '#lib/vacation-form/format.js';
	import {
		DEFAULT_OVERLAY_FONT_SIZE,
		MAX_OVERLAYS,
		MappingTooLargeError,
		emptyMapping,
		newBinding,
		serializeMapping,
		suggestSource
	} from '#lib/vacation-form/mapping.js';
	import { ApiError } from '#lib/api/errors.js';
	import { PdfError } from '#lib/vacation-form/pdf-limits.js';
	import type { DetectedField, PdfInfo } from '#lib/vacation-form/pdf.js';
	import { SAMPLE_REQUEST, previewMapping } from '#lib/vacation-form/sample.js';
	import { currentFormStore } from '#lib/vacation-form/store-instance.js';
	import type { Binding, FormMapping, OverlayItem } from '#lib/vacation-form/types.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let store: FormTemplateStore | null = null;
	let storage = $state<'server' | 'offline' | null>(null);
	let fileName = $state('');
	let bytes = $state<Uint8Array | null>(null);
	let info = $state<PdfInfo | null>(null);
	let mapping = $state<FormMapping>(emptyMapping());
	let savedJson = $state(serializeMapping(emptyMapping()));
	let notice = $state('');
	let problem = $state('');
	let busy = $state(false);
	let confirmRemove = $state(false);
	let showOverlay = $state(false);
	let overlayPage = $state(0);
	let previewPage = $state(0);
	let previewBytes = $state<Uint8Array | null>(null);
	let previewSkipped = $state<string[]>([]);
	let previewFailed = $state(false);

	const dirty = $derived.by(() => {
		try {
			return serializeMapping(mapping) !== savedJson;
		} catch {
			return true;
		}
	});
	const fields = $derived(info?.fields ?? []);
	const mappable = $derived(fields.filter((field) => field.type !== 'other'));
	const unsupported = $derived(fields.filter((field) => field.type === 'other'));
	const noFields = $derived(!!info && info.fields.length === 0);
	const overlayOpen = $derived(showOverlay || noFields || mapping.overlays.length > 0);
	const pageCount = $derived(info?.pageCount ?? 1);

	async function pdfModule() {
		return import('#lib/vacation-form/pdf.js');
	}

	function adopt(file: { fileName: string; bytes: Uint8Array; mapping: FormMapping }, details: PdfInfo) {
		fileName = file.fileName;
		bytes = file.bytes;
		info = details;
		mapping = file.mapping;
		savedJson = serializeMapping(file.mapping);
		overlayPage = 0;
		previewPage = 0;
	}

	onMount(async () => {
		try {
			store = currentFormStore();
			const stored = await store.load();
			storage = store.storage;
			if (stored) {
				try {
					adopt(stored, await (await pdfModule()).inspectPdf(stored.bytes));
				} catch (error) {
					problem = pdfProblem(error);
				}
			}
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	});

	function pdfProblem(error: unknown): string {
		if (error instanceof PdfError) return t(`vform.pdf_error.${error.problem}` as MessageKey);
		if (error instanceof MappingTooLargeError) return t('vform.mapping_too_large');
		// server answers of the template endpoints get form-specific German texts (contract 0.25.0)
		if (error instanceof ApiError) {
			if (error.code === 'file_too_large') return t('vform.pdf_error.too_large');
			if (error.code === 'unsupported_type') return t('vform.pdf_error.not_pdf');
			if (error.code === 'mapping_too_large') return t('vform.mapping_too_large');
			if (error.code === 'no_template') return t('vform.error_no_template');
		}
		return errorMessage(error);
	}

	async function chooseFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !store) return;
		busy = true;
		problem = '';
		notice = '';
		try {
			const data = new Uint8Array(await file.arrayBuffer());
			const details = await (await pdfModule()).inspectPdf(data); // validates size and magic number first
			// Field names belong to the file, so the assignment starts over; personal values and the format stay.
			const fresh: FormMapping = { ...emptyMapping(), person: mapping.person, dateFormat: mapping.dateFormat, flatten: mapping.flatten };
			await store.saveFile(data, file.name, fresh);
			storage = store.storage;
			adopt({ fileName: file.name, bytes: data, mapping: fresh }, details);
			notice = t('vform.file_saved');
		} catch (error) {
			problem = pdfProblem(error);
		} finally {
			busy = false;
		}
	}

	async function save() {
		if (!store || busy) return;
		busy = true;
		problem = '';
		notice = '';
		try {
			await store.saveMapping(mapping);
			storage = store.storage;
			savedJson = serializeMapping(mapping);
			notice = t('vform.saved');
		} catch (error) {
			problem = pdfProblem(error);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!store) return;
		busy = true;
		try {
			await store.remove();
			bytes = null;
			info = null;
			fileName = '';
			mapping = emptyMapping();
			savedJson = serializeMapping(mapping);
			previewBytes = null;
			confirmRemove = false;
			notice = t('vform.removed');
		} catch (error) {
			problem = pdfProblem(error);
			confirmRemove = false;
		} finally {
			busy = false;
		}
	}

	function setBinding(name: string, binding: Binding | null) {
		if (binding) mapping.fields[name] = binding;
		else delete mapping.fields[name];
	}

	function suggestAll() {
		let count = 0;
		for (const field of mappable) {
			if (mapping.fields[field.name]) continue;
			const source = suggestSource(field.name, field.type as 'text' | 'checkbox' | 'dropdown');
			if (source) {
				mapping.fields[field.name] = newBinding(source);
				count += 1;
			}
		}
		notice = count > 0 ? t('vform.fields_suggest_done', { count }) : t('vform.fields_suggest_none');
	}

	function clearFields() {
		mapping.fields = {};
	}

	function placeOverlay(x: number, y: number) {
		if (mapping.overlays.length >= MAX_OVERLAYS) return;
		const overlay: OverlayItem = { id: crypto.randomUUID(), page: overlayPage, x, y, fontSize: DEFAULT_OVERLAY_FONT_SIZE, binding: newBinding('lastName') };
		mapping.overlays.push(overlay);
	}

	function removeOverlay(id: string) {
		mapping.overlays = mapping.overlays.filter((overlay) => overlay.id !== id);
	}

	const overlaysOnPage = $derived(mapping.overlays.filter((overlay) => overlay.page === overlayPage));
	const markers = $derived(overlaysOnPage.map((overlay) => ({ id: overlay.id, x: overlay.x, y: overlay.y, label: String(mapping.overlays.indexOf(overlay) + 1) })));

	// Live preview: refill the template with example values whenever the assignment changes (debounced).
	$effect(() => {
		const template = bytes;
		const snapshot = $state.snapshot(mapping);
		if (!template) return;
		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				const result = (await pdfModule()).fillPdf(template, previewMapping(snapshot), SAMPLE_REQUEST, { flatten: true });
				const done = await result;
				if (cancelled) return;
				previewBytes = done.bytes;
				previewSkipped = done.skipped;
				previewFailed = false;
			} catch {
				if (!cancelled) previewFailed = true;
			}
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	const typeLabel = (field: DetectedField) => t(`vform.type.${field.type}` as MessageKey);
</script>

<PageHeader title={t('vform.title')} description={t('vform.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('vform.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<p class="text-sm text-muted-foreground" data-testid="vform-privacy">{t('vform.privacy')}</p>
		{#if problem}<Alert variant="destructive" data-testid="vform-problem">{problem}</Alert>{/if}
		{#if notice}<Alert variant="success" data-testid="vform-notice">{notice}</Alert>{/if}

		<Card data-testid="vform-upload">
			<CardHeader>
				<CardTitle>{t('vform.upload_title')}</CardTitle>
				<CardDescription>{t('vform.upload_hint')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if info}
					<div class="flex flex-wrap items-center gap-2" data-testid="vform-file-info">
						<span class="text-sm font-medium break-all">{fileName}</span>
						<Badge variant="secondary">{storage === 'offline' ? t('vform.storage_offline') : t('vform.storage_server')}</Badge>
					</div>
					<p class="text-sm text-muted-foreground">{t('vform.upload_info', { name: fileName, size: formatBytes(bytes?.length ?? 0), pages: info.pageCount, fields: info.fields.length })}</p>
				{:else}
					<p class="text-sm text-muted-foreground">{t('vform.upload_none')}</p>
				{/if}
				<div class="flex flex-wrap items-center gap-2">
					<Label for="vform-file" class="inline-flex h-10 cursor-pointer items-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted focus-within:ring-2">
						{info ? t('vform.upload_replace') : t('vform.upload_choose')}
					</Label>
					<input id="vform-file" type="file" accept="application/pdf,.pdf" class="sr-only" disabled={busy} onchange={chooseFile} data-testid="vform-file-input" />
					{#if info}
						<Button type="button" variant="ghost" onclick={() => (confirmRemove = true)} disabled={busy} data-testid="vform-remove">{t('vform.upload_remove')}</Button>
					{/if}
				</div>
				{#if info}<p class="text-xs text-muted-foreground">{t('vform.upload_replaced')}</p>{/if}
			</CardContent>
		</Card>

		<Card data-testid="vform-person">
			<CardHeader>
				<CardTitle>{t('vform.person_title')}</CardTitle>
				<CardDescription>{t('vform.person_hint')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Field id="vf-last" label={t('vform.person_last_name')} bind:value={mapping.person.lastName} autocomplete="family-name" maxlength={200} />
					<Field id="vf-first" label={t('vform.person_first_name')} bind:value={mapping.person.firstName} autocomplete="given-name" maxlength={200} />
					<Field id="vf-no" label={t('vform.person_personnel_no')} bind:value={mapping.person.personnelNo} autocomplete="off" maxlength={200} />
					<Field id="vf-dept" label={t('vform.person_department')} bind:value={mapping.person.department} autocomplete="off" maxlength={200} />
					<Field id="vf-place" label={t('vform.person_place')} bind:value={mapping.person.place} autocomplete="off" maxlength={200} />
					<div class="flex flex-col gap-1.5">
						<Label for="vf-format">{t('vform.date_format')}</Label>
						<Select id="vf-format" bind:value={mapping.dateFormat} data-testid="vform-date-format">
							{#each DATE_FORMATS as format (format)}
								<option value={format}>{formatFormDate('2026-07-06', format as DateFormatId)} ({format})</option>
							{/each}
						</Select>
					</div>
				</div>
				<div class="flex items-start gap-2">
					<Checkbox id="vf-flatten" bind:checked={mapping.flatten} class="mt-0.5" />
					<div>
						<Label for="vf-flatten">{t('vform.flatten')}</Label>
						<p class="text-xs text-muted-foreground">{t('vform.flatten_hint')}</p>
					</div>
				</div>
			</CardContent>
		</Card>

		{#if info}
			{#if noFields}<Alert data-testid="vform-no-fields">{t('vform.no_fields_notice')}</Alert>{/if}

			{#if fields.length > 0}
				<Card data-testid="vform-fields">
					<CardHeader>
						<CardTitle>{t('vform.fields_title')}</CardTitle>
						<CardDescription>{t('vform.fields_hint')}</CardDescription>
					</CardHeader>
					<CardContent class="flex flex-col gap-4">
						<div class="flex flex-wrap gap-2">
							<Button type="button" variant="outline" size="sm" onclick={suggestAll} data-testid="vform-suggest">{t('vform.fields_suggest')}</Button>
							<Button type="button" variant="ghost" size="sm" onclick={clearFields}>{t('vform.fields_clear')}</Button>
						</div>
						<ul class="flex flex-col divide-y rounded-lg border">
							{#each mappable as field, index (field.name)}
								<li class="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-start sm:gap-4" data-testid="vform-field" data-field-name={field.name}>
									<div class="min-w-0">
										<p class="font-mono text-sm break-all" data-testid="vform-field-name">{field.name}</p>
										<p class="text-xs text-muted-foreground">
											{typeLabel(field)} · {t('vform.field_page')} {field.page || '?'}{field.readOnly ? ` · ${t('vform.field_readonly')}` : ''}
										</p>
									</div>
									<div>
										<BindingPicker
											id="field-{index}"
											kind={field.type as 'text' | 'checkbox' | 'dropdown'}
											binding={mapping.fields[field.name] ?? null}
											label="{t('vform.field_source')}: {field.name}"
											onchange={(binding) => setBinding(field.name, binding)}
										/>
										{#if field.type === 'dropdown'}<p class="mt-1 text-xs text-muted-foreground">{t('vform.dropdown_note')}</p>{/if}
									</div>
								</li>
							{/each}
						</ul>
						{#if unsupported.length > 0}
							<p class="text-xs text-muted-foreground" data-testid="vform-unsupported">
								{t('vform.field_unsupported')}: {unsupported.map((field) => field.name).join(', ')}
							</p>
						{/if}
					</CardContent>
				</Card>
			{/if}

			<Card data-testid="vform-overlay">
				<CardHeader>
					<CardTitle>{t('vform.overlay_title')}</CardTitle>
					<CardDescription>{t('vform.overlay_hint')}</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					{#if !overlayOpen}
						<div><Button type="button" variant="outline" size="sm" onclick={() => (showOverlay = true)} data-testid="vform-overlay-show">{t('vform.overlay_toggle_show')}</Button></div>
					{:else if bytes}
						<div class="flex flex-wrap items-center gap-2">
							<Button type="button" variant="outline" size="sm" disabled={overlayPage <= 0} onclick={() => (overlayPage -= 1)}>{t('vform.overlay_prev')}</Button>
							<span class="text-sm tabular-nums" data-testid="vform-overlay-page">{t('vform.overlay_page', { page: overlayPage + 1, pages: pageCount })}</span>
							<Button type="button" variant="outline" size="sm" disabled={overlayPage >= pageCount - 1} onclick={() => (overlayPage += 1)}>{t('vform.overlay_next')}</Button>
						</div>
						<p class="text-xs text-muted-foreground">{t('vform.overlay_click')}</p>
						<PdfCanvas bytes={bytes} page={overlayPage} pageHeight={info.pages[overlayPage]?.height ?? 842} {markers} onplace={placeOverlay} alt={t('vform.overlay_page', { page: overlayPage + 1, pages: pageCount })} />
						{#if mapping.overlays.length === 0}
							<p class="text-sm text-muted-foreground">{t('vform.overlay_empty')}</p>
						{:else}
							<ul class="flex flex-col divide-y rounded-lg border" data-testid="vform-overlay-list">
								{#each mapping.overlays as overlay, index (overlay.id)}
									<li class="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-start sm:gap-4" data-testid="vform-overlay-item">
										<div>
											<p class="text-sm font-medium">{t('vform.overlay_position', { n: index + 1, page: overlay.page + 1 })}</p>
											<div class="mt-1 flex w-28 flex-col gap-1">
												<Label for="ov-size-{overlay.id}" class="text-xs">{t('vform.overlay_font_size')}</Label>
												<Input id="ov-size-{overlay.id}" type="number" min="4" max="48" step="1" value={overlay.fontSize} oninput={(e) => (overlay.fontSize = Math.min(Math.max(Number(e.currentTarget.value) || DEFAULT_OVERLAY_FONT_SIZE, 4), 48))} />
											</div>
										</div>
										<BindingPicker id="ov-{index}" kind="overlay" binding={overlay.binding} label={t('vform.overlay_position', { n: index + 1, page: overlay.page + 1 })} onchange={(binding) => binding && (overlay.binding = binding)} />
										<Button type="button" variant="ghost" size="sm" onclick={() => removeOverlay(overlay.id)}>{t('vform.overlay_remove')}</Button>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</CardContent>
			</Card>

			<Card data-testid="vform-preview">
				<CardHeader>
					<CardTitle>{t('vform.preview_title')}</CardTitle>
					<CardDescription>{t('vform.preview_hint')}</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-3">
					{#if previewFailed}
						<Alert variant="destructive">{t('vform.preview_error')}</Alert>
					{:else if previewBytes}
						{#if pageCount > 1}
							<div class="flex flex-wrap items-center gap-2">
								<Button type="button" variant="outline" size="sm" disabled={previewPage <= 0} onclick={() => (previewPage -= 1)}>{t('vform.overlay_prev')}</Button>
								<span class="text-sm tabular-nums">{t('vform.overlay_page', { page: previewPage + 1, pages: pageCount })}</span>
								<Button type="button" variant="outline" size="sm" disabled={previewPage >= pageCount - 1} onclick={() => (previewPage += 1)}>{t('vform.overlay_next')}</Button>
							</div>
						{/if}
						<PdfCanvas bytes={previewBytes} page={previewPage} alt={t('vform.preview_alt', { page: previewPage + 1 })} />
						{#if previewSkipped.length > 0}
							<p class="text-xs text-muted-foreground" data-testid="vform-preview-skipped">{t('vform.preview_skipped', { names: previewSkipped.join(', ') })}</p>
						{/if}
					{:else}
						<p class="text-sm text-muted-foreground">{t('vform.preview_loading')}</p>
					{/if}
				</CardContent>
			</Card>

			<div class="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
				<Button type="button" onclick={save} disabled={busy || !dirty} data-testid="vform-save">{t('vform.save')}</Button>
				{#if dirty}<span class="text-sm text-muted-foreground" data-testid="vform-dirty">{t('vform.unsaved')}</span>{/if}
			</div>
		{/if}
	</div>
{/if}

<ConfirmDialog
	bind:open={confirmRemove}
	title={t('vform.upload_remove')}
	confirmLabel={t('vform.upload_remove')}
	tone="danger"
	{busy}
	onconfirm={remove}
	oncancel={() => (confirmRemove = false)}
>
	<p>{t('vform.upload_remove_confirm')}</p>
</ConfirmDialog>
