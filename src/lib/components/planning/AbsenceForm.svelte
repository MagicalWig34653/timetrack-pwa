<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { Absence, AbsenceInput, AbsenceKind, AbsenceStatus, DocumentStatus } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { ABSENCE_KINDS, ABSENCE_STATUSES, absenceKindLabel, absenceStatusLabel, DOCUMENT_STATUSES, documentStatusLabel } from '#lib/planning/labels.js';
	import { isValidDate } from '#lib/time/dates.js';
	import { untrack } from 'svelte';

	let {
		absence = null,
		date,
		onsaved,
		oncancel,
		onstale
	}: {
		/** null = create, otherwise edit with If-Match on the absence version */
		absence?: Absence | null;
		/** default start/end for new absences */
		date: string;
		onsaved: (absence: Absence) => void;
		oncancel: () => void;
		/** called when the server holds a newer version (412); the parent reloads and reopens the form */
		onstale?: () => void;
	} = $props();

	const initial = untrack(() => absence);
	let kind = $state<AbsenceKind>(initial?.kind ?? 'vacation');
	let startDate = $state(initial?.startDate ?? untrack(() => date));
	let endDate = $state(initial?.endDate ?? untrack(() => date));
	let halfDayStart = $state(initial?.halfDayStart ?? false);
	let halfDayEnd = $state(initial?.halfDayEnd ?? false);
	let status = $state<AbsenceStatus>(initial?.status ?? 'planned');
	let note = $state(initial?.note ?? '');
	let documentStatus = $state<DocumentStatus>(initial?.documentStatus ?? 'not_needed');
	let documentSubmittedOn = $state(initial?.documentSubmittedOn ?? '');
	let documentReferenceStart = $state(initial?.documentReferenceStart ?? '');
	let documentReferenceEnd = $state(initial?.documentReferenceEnd ?? '');
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	let stale = $state(false);
	let pending = $state(false);

	const editing = initial !== null;
	const withDocuments = $derived(kind !== 'vacation');
	const singleDay = $derived(startDate !== '' && startDate === endDate);

	function validate(): AbsenceInput | null {
		const next: Record<string, string> = {};
		if (!isValidDate(startDate)) next.startDate = t('absence.error_date');
		if (!isValidDate(endDate)) next.endDate = t('absence.error_date');
		else if (isValidDate(startDate) && endDate < startDate) next.endDate = t('absence.error_end_before_start');
		if (note.length > 500) next.note = t('absence.error_note');
		if (withDocuments) {
			if (documentSubmittedOn && !isValidDate(documentSubmittedOn)) next.documentSubmittedOn = t('absence.error_date');
			if (documentReferenceStart && !isValidDate(documentReferenceStart)) next.documentReferenceStart = t('absence.error_date');
			if (documentReferenceEnd && !isValidDate(documentReferenceEnd)) next.documentReferenceEnd = t('absence.error_date');
			if (documentReferenceStart && documentReferenceEnd && documentReferenceEnd < documentReferenceStart) next.documentReferenceEnd = t('absence.error_end_before_start');
		}
		errors = next;
		if (Object.keys(next).length > 0) return null;
		return {
			kind,
			startDate,
			endDate,
			halfDayStart,
			halfDayEnd,
			status,
			note: note.trim() || null,
			documentStatus: withDocuments ? documentStatus : 'not_needed',
			documentSubmittedOn: withDocuments ? documentSubmittedOn || null : null,
			documentReferenceStart: withDocuments ? documentReferenceStart || null : null,
			documentReferenceEnd: withDocuments ? documentReferenceEnd || null : null
		};
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		stale = false;
		const input = validate();
		if (!input) return;
		pending = true;
		try {
			const saved = initial ? await api.updateAbsence(initial.id, input, initial.version) : await api.createAbsence(input);
			onsaved(saved);
		} catch (e) {
			if (e instanceof ApiError && (e.status === 412 || e.code === 'stale_version')) stale = true;
			else formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<form class="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4" onsubmit={submit} novalidate aria-label={editing ? t('absence.edit_title') : t('absence.create_title')} data-testid="absence-form">
	<h3 class="font-medium">{editing ? t('absence.edit_title') : t('absence.create_title')}</h3>
	{#if formError}<Alert variant="destructive" data-testid="absence-error">{formError}</Alert>{/if}
	{#if stale}
		<Alert variant="warning" data-testid="absence-stale">
			<p class="font-medium">{t('absence.stale_title')}</p>
			<p class="mt-1">{t('absence.stale_text')}</p>
			{#if onstale}<Button class="mt-2" type="button" variant="outline" size="sm" onclick={onstale}>{t('absence.stale_reload')}</Button>{/if}
		</Alert>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="abs-kind">{t('absence.kind')}</Label>
			<Select id="abs-kind" bind:value={kind} disabled={pending}>
				{#each ABSENCE_KINDS as option (option)}<option value={option}>{absenceKindLabel(option)}</option>{/each}
			</Select>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="abs-status">{t('absence.status')}</Label>
			<Select id="abs-status" bind:value={status} disabled={pending}>
				{#each ABSENCE_STATUSES as option (option)}<option value={option}>{absenceStatusLabel(option)}</option>{/each}
			</Select>
			<p class="text-xs text-muted-foreground">{t('absence.status_hint')}</p>
		</div>
		<Field id="abs-start" type="date" label={t('absence.start')} bind:value={startDate} error={errors.startDate} disabled={pending} required />
		<Field id="abs-end" type="date" label={t('absence.end')} bind:value={endDate} error={errors.endDate} disabled={pending} required />
	</div>
	<fieldset class="flex flex-col gap-2" disabled={pending}>
		<legend class="mb-1 text-sm font-medium">{t('absence.half_days')}</legend>
		<label class="flex items-center gap-2 text-sm"><Checkbox id="abs-half-start" bind:checked={halfDayStart} />{t('absence.half_start')}</label>
		<label class="flex items-center gap-2 text-sm"><Checkbox id="abs-half-end" bind:checked={halfDayEnd} />{t('absence.half_end')}</label>
		{#if singleDay}<p class="text-xs text-muted-foreground">{t('absence.half_single_hint')}</p>{/if}
	</fieldset>
	<Field id="abs-note" label={t('absence.note')} bind:value={note} error={errors.note} maxlength={500} disabled={pending} />
	{#if withDocuments}
		<fieldset class="flex flex-col gap-3 rounded-lg border p-3" disabled={pending}>
			<legend class="px-1 text-sm font-medium">{t('absence.documents')}</legend>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="abs-doc-status">{t('absence.document_status')}</Label>
					<Select id="abs-doc-status" bind:value={documentStatus}>
						{#each DOCUMENT_STATUSES as option (option)}<option value={option}>{documentStatusLabel(option)}</option>{/each}
					</Select>
				</div>
				<Field id="abs-doc-submitted" type="date" label={t('absence.document_submitted')} bind:value={documentSubmittedOn} error={errors.documentSubmittedOn} />
				<Field id="abs-doc-ref-start" type="date" label={t('absence.document_ref_start')} bind:value={documentReferenceStart} error={errors.documentReferenceStart} />
				<Field id="abs-doc-ref-end" type="date" label={t('absence.document_ref_end')} bind:value={documentReferenceEnd} error={errors.documentReferenceEnd} />
			</div>
			<p class="text-xs text-muted-foreground">{t('absence.documents_hint')}</p>
		</fieldset>
	{/if}
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={pending}>{t('common.save')}</Button>
		<Button type="button" variant="outline" onclick={oncancel} disabled={pending}>{t('common.cancel')}</Button>
	</div>
</form>
