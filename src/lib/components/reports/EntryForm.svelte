<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { LearningField, ReportEntry, ReportEntryInput } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { durationInputValue, parseReportDuration } from '#lib/reports/duration.js';
	import { formatDateLong } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';

	let {
		entry,
		date,
		dates,
		fields,
		defaultField = '',
		onsaved,
		oncancel,
		onreload
	}: {
		entry?: ReportEntry;
		date: string;
		/** the seven days of the shown week (an entry can be moved within the week) */
		dates: string[];
		fields: LearningField[];
		/** pre-filled learning field for quick-add (last one used in the week) */
		defaultField?: string;
		onsaved: (entry: ReportEntry) => void;
		oncancel: () => void;
		/** reloads the week and returns the current server version of this entry, or null if it is gone (412 flow) */
		onreload: () => Promise<ReportEntry | null>;
	} = $props();

	const uid = $props.id();
	const MAX_NOTES = 4000;

	// the form edits a private copy: the initial values are read once on purpose
	// svelte-ignore state_referenced_locally
	let entryDate = $state(entry?.date ?? date);
	// svelte-ignore state_referenced_locally
	let fieldName = $state(entry?.learningField ?? defaultField);
	// svelte-ignore state_referenced_locally
	let durationText = $state(durationInputValue(entry?.durationSeconds));
	// svelte-ignore state_referenced_locally
	let notes = $state(entry?.notes ?? '');
	// svelte-ignore state_referenced_locally
	let version = $state(entry?.version ?? 0);
	let stale = $state<ReportEntry | null>(null);
	let formError = $state('');
	let pending = $state(false);
	let submitted = $state(false);

	const name = $derived(fieldName.trim());
	const parsed = $derived(parseReportDuration(durationText));
	const fieldError = $derived(name === '' ? t('reports.form.field_required') : name.length > 120 ? t('reports.form.field_too_long') : '');
	const durationError = $derived(parsed ? '' : t('reports.form.duration_invalid'));
	const notesError = $derived(notes.length > MAX_NOTES ? t('reports.form.notes_too_long') : '');
	const parsedHint = $derived.by(() => {
		if (!parsed || parsed.kind === 'empty') return '';
		const duration = formatDuration(parsed.seconds);
		if (parsed.kind === 'decimal') return t('reports.form.duration_decimal', { duration });
		if (parsed.kind === 'hours') return t('reports.form.duration_hours', { duration });
		return t('reports.form.duration_parsed', { duration });
	});

	async function save() {
		submitted = true;
		formError = '';
		if (fieldError || durationError || notesError || !parsed || pending) return;
		const match = fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
		const input: ReportEntryInput = {
			date: entryDate,
			learningFieldId: match?.id ?? null,
			learningField: match?.name ?? name,
			durationSeconds: parsed.seconds,
			notes
		};
		pending = true;
		try {
			const saved = entry ? await api.updateReportEntry(entry.id, input, version) : await api.createReportEntry(input);
			onsaved(saved);
		} catch (e) {
			if (entry && e instanceof ApiError && e.status === 412) {
				const current = await onreload().catch(() => undefined);
				if (current === null) {
					formError = t('reports.entry.vanished');
				} else if (current) {
					stale = current;
				} else {
					formError = errorMessage(e);
				}
			} else formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	function adoptCurrent() {
		if (!stale) return;
		entryDate = stale.date;
		fieldName = stale.learningField;
		durationText = durationInputValue(stale.durationSeconds);
		notes = stale.notes ?? '';
		version = stale.version;
		stale = null;
		submitted = false;
	}

	function keepMine() {
		if (!stale) return;
		version = stale.version;
		stale = null;
		void save();
	}
</script>

<form
	class="flex flex-col gap-4 rounded-lg border bg-muted/40 p-4"
	aria-labelledby="{uid}-title"
	data-testid="entry-form"
	novalidate
	onsubmit={(e) => {
		e.preventDefault();
		void save();
	}}
>
	<h3 id="{uid}-title" class="text-sm font-semibold">{entry ? t('reports.form.title_edit') : t('reports.form.title_new', { date: formatDateLong(entryDate) })}</h3>

	{#if stale}
		<Alert variant="warning" data-testid="entry-stale">
			<p class="font-medium">{t('reports.stale.title')}</p>
			<p class="mt-1">{t('reports.stale.text')}</p>
			<p class="mt-1 break-words" data-testid="entry-stale-current">{t('reports.stale.current', { field: stale.learningField, duration: formatDuration(stale.durationSeconds ?? 0) })}</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<Button type="button" size="sm" onclick={adoptCurrent}>{t('reports.stale.reload')}</Button>
				<Button type="button" size="sm" variant="outline" onclick={keepMine}>{t('reports.stale.keep')}</Button>
			</div>
		</Alert>
	{/if}
	{#if formError}<Alert variant="destructive" data-testid="entry-error">{formError}</Alert>{/if}

	{#if entry}
		<div class="flex flex-col gap-1.5">
			<Label for="{uid}-date">{t('reports.form.date')}</Label>
			<Select id="{uid}-date" bind:value={entryDate}>
				{#each dates as d (d)}<option value={d}>{formatDateLong(d)}</option>{/each}
			</Select>
		</div>
	{/if}

	<div class="flex flex-col gap-1.5">
		<Label for="{uid}-field">{t('reports.form.field')}</Label>
		<Input
			id="{uid}-field"
			bind:value={fieldName}
			list="{uid}-fields"
			autocomplete="off"
			maxlength={200}
			aria-invalid={submitted && fieldError ? true : undefined}
			aria-describedby="{uid}-field-hint{submitted && fieldError ? ` ${uid}-field-error` : ''}"
			data-testid="entry-field"
		/>
		<datalist id="{uid}-fields">
			{#each fields as f (f.id)}<option value={f.name} label={f.number != null ? `${f.number}` : undefined}></option>{/each}
		</datalist>
		<p id="{uid}-field-hint" class="text-xs text-muted-foreground">
			{t('reports.form.field_hint')}
			<a class="underline underline-offset-2" href="/settings/learning-fields">{t('reports.form.field_manage')}</a>
		</p>
		{#if submitted && fieldError}<p id="{uid}-field-error" class="text-xs text-destructive">{fieldError}</p>{/if}
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="{uid}-duration">{t('reports.form.duration')}</Label>
		<Input
			id="{uid}-duration"
			bind:value={durationText}
			inputmode="text"
			autocomplete="off"
			class="max-w-40"
			aria-invalid={durationError ? true : undefined}
			aria-describedby="{uid}-duration-hint {uid}-duration-live"
			data-testid="entry-duration"
		/>
		<p id="{uid}-duration-hint" class="text-xs text-muted-foreground">{t('reports.form.duration_hint')}</p>
		<p id="{uid}-duration-live" class="text-xs {durationError ? 'text-destructive' : 'text-foreground'}" aria-live="polite" data-testid="entry-duration-parsed">{durationError || parsedHint}</p>
	</div>

	<div class="flex flex-col gap-1.5">
		<Label for="{uid}-notes">{t('reports.form.notes')}</Label>
		<Textarea id="{uid}-notes" bind:value={notes} rows={4} aria-invalid={notesError ? true : undefined} aria-describedby="{uid}-notes-count" data-testid="entry-notes" />
		<p id="{uid}-notes-count" class="text-xs {notesError ? 'text-destructive' : 'text-muted-foreground'}">{notesError || t('reports.form.notes_count', { count: notes.length })}</p>
	</div>

	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={pending || !!stale} data-testid="entry-save">{pending ? t('reports.form.saving') : t('reports.form.save')}</Button>
		<Button type="button" variant="outline" onclick={oncancel}>{t('common.cancel')}</Button>
	</div>
</form>
