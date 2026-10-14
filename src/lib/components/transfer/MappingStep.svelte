<script lang="ts">
	import type { ImportTemplate } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';
	import { columnLetter, formIssues, type FormIssue, type MappingForm } from '#lib/transfer/import-flow.js';
	import { parseDateCell, parseTimeCell } from '#lib/transfer/import-parse.js';
	import { kindLabel } from '#lib/time/labels.js';
	import { formatDuration } from '#lib/time/format.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { Input } from '#lib/components/ui/input/index.js';

	let {
		form = $bindable(),
		rows,
		templates,
		templatesUnavailable,
		busy,
		showIssues,
		onapply,
		onsave,
		ondelete,
		onsubmit,
		onback
	}: {
		form: MappingForm;
		/** raw rows of the chosen sheet */
		rows: (string | null)[][];
		templates: ImportTemplate[];
		templatesUnavailable: boolean;
		busy: boolean;
		showIssues: boolean;
		onapply: (template: ImportTemplate) => void;
		onsave: (name: string) => void;
		ondelete: (template: ImportTemplate) => void;
		onsubmit: () => void;
		onback: () => void;
	} = $props();

	let templateId = $state('');
	let templateName = $state('');
	let nameError = $state(false);

	const headerRow = $derived(Number(form.headerRow) || 0);
	const columnCount = $derived(rows.reduce((max, r) => Math.max(max, r.length), 0));
	const sampleRow = $derived(rows[headerRow] ?? null);
	const header = $derived(headerRow > 0 ? (rows[headerRow - 1] ?? []) : []);
	const issues = $derived(formIssues(form));

	function optionLabel(index: number): string {
		const sample = (headerRow > 0 ? header[index] : sampleRow?.[index])?.trim();
		return sample ? t('import.col_label', { letter: columnLetter(index), sample: sample.slice(0, 28) }) : t('import.col_label_empty', { letter: columnLetter(index) });
	}

	const issueText = (issue: FormIssue) => t(`import.issue.${issue}`);

	function cellOf(field: string): string | null {
		if (field === '' || !sampleRow) return null;
		return sampleRow[Number(field)] ?? '';
	}

	/** Reads the first data row with the chosen formats so the effect of the format selects is visible before validating. */
	const probes = $derived.by(() => {
		if (!sampleRow) return [];
		const out: { field: string; raw: string; value: string | null }[] = [];
		const date = cellOf(form.date);
		if (date !== null) {
			const iso = parseDateCell(date, form.dateFormat);
			out.push({ field: t('import.field_date'), raw: date, value: iso ? formatDateNumeric(iso) : null });
		}
		const clock = (field: string, label: string) => {
			const raw = cellOf(field);
			if (raw === null) return;
			const seconds = parseTimeCell(raw, form.timeFormat, 'clock');
			out.push({ field: label, raw, value: seconds === null ? null : formatDuration(seconds) });
		};
		clock(form.start, t('import.field_start'));
		if (form.endMode === 'end') clock(form.end, t('import.field_end'));
		else {
			const raw = cellOf(form.duration);
			if (raw !== null) {
				const seconds = parseTimeCell(raw, form.timeFormat, 'duration');
				out.push({ field: t('import.field_duration'), raw, value: seconds === null ? null : formatDuration(seconds) });
			}
		}
		return out;
	});

	const selected = $derived(templates.find((x) => x.id === templateId));
	const kinds = ['work', 'travel', 'school'] as const;
	const columnFields = [
		{ key: 'date', label: 'import.field_date', required: true },
		{ key: 'start', label: 'import.field_start', required: true }
	] as const;
</script>

<div class="flex flex-col gap-6">
	<p class="text-sm text-muted-foreground">{t('import.mapping_text')}</p>

	<section class="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="templates-heading">
		<h4 id="templates-heading" class="text-sm font-medium">{t('import.templates_title')}</h4>
		{#if templatesUnavailable}
			<p class="text-sm text-muted-foreground">{t('import.templates_unavailable')}</p>
		{:else}
			<p class="text-xs text-muted-foreground">{t('import.templates_text')}</p>
			<div class="flex flex-wrap items-end gap-2">
				<div class="flex min-w-48 flex-1 flex-col gap-1.5">
					<Label for="template-select">{t('import.template_select')}</Label>
					<Select id="template-select" bind:value={templateId}>
						<option value="">{t('import.template_none')}</option>
						{#each templates as template (template.id)}<option value={template.id}>{template.name}</option>{/each}
					</Select>
				</div>
				<Button type="button" variant="outline" disabled={!selected || busy} onclick={() => selected && onapply(selected)}>{t('import.template_apply')}</Button>
				<Button type="button" variant="destructive" disabled={!selected || busy} onclick={() => selected && ondelete(selected)}>{t('import.template_delete')}</Button>
			</div>
			<form
				class="flex flex-wrap items-end gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					const name = templateName.trim();
					nameError = name === '' || name.length > 80;
					if (!nameError) {
						onsave(name);
						templateName = '';
					}
				}}
			>
				<div class="flex min-w-48 flex-1 flex-col gap-1.5">
					<Label for="template-name">{t('import.template_name')}</Label>
					<Input id="template-name" bind:value={templateName} maxlength={80} aria-invalid={nameError ? true : undefined} />
					{#if nameError}<p class="text-xs text-destructive">{t('import.template_name_required')}</p>{/if}
				</div>
				<Button type="submit" variant="outline" disabled={busy}>{t('import.template_save')}</Button>
			</form>
		{/if}
	</section>

	<section class="grid gap-3 sm:grid-cols-2" aria-label={t('import.mapping_title')}>
		{#each columnFields as field (field.key)}
			<div class="flex flex-col gap-1.5">
				<Label for="map-{field.key}">{t(field.label)}</Label>
				<Select id="map-{field.key}" bind:value={form[field.key]} aria-invalid={showIssues && form[field.key] === '' ? true : undefined}>
					<option value="">{t('import.col_none')}</option>
					{#each Array.from({ length: columnCount }, (_, i) => i) as i (i)}<option value={String(i)}>{optionLabel(i)}</option>{/each}
				</Select>
			</div>
		{/each}
		<fieldset class="flex flex-col gap-2 sm:col-span-2">
			<legend class="mb-1 text-sm font-medium">{t('import.end_mode')}</legend>
			<label class="flex items-center gap-2 text-sm"><input type="radio" class="size-4 accent-primary" name="end-mode" value="end" bind:group={form.endMode} />{t('import.end_mode_end')}</label>
			<label class="flex items-center gap-2 text-sm"><input type="radio" class="size-4 accent-primary" name="end-mode" value="duration" bind:group={form.endMode} />{t('import.end_mode_duration')}</label>
		</fieldset>
		{#if form.endMode === 'end'}
			<div class="flex flex-col gap-1.5">
				<Label for="map-end">{t('import.field_end')}</Label>
				<Select id="map-end" bind:value={form.end} aria-invalid={showIssues && form.end === '' ? true : undefined}>
					<option value="">{t('import.col_none')}</option>
					{#each Array.from({ length: columnCount }, (_, i) => i) as i (i)}<option value={String(i)}>{optionLabel(i)}</option>{/each}
				</Select>
			</div>
		{:else}
			<div class="flex flex-col gap-1.5">
				<Label for="map-duration">{t('import.field_duration')}</Label>
				<Select id="map-duration" bind:value={form.duration} aria-invalid={showIssues && form.duration === '' ? true : undefined}>
					<option value="">{t('import.col_none')}</option>
					{#each Array.from({ length: columnCount }, (_, i) => i) as i (i)}<option value={String(i)}>{optionLabel(i)}</option>{/each}
				</Select>
			</div>
		{/if}
		<div class="flex flex-col gap-1.5">
			<Label for="map-kind">{t('import.field_kind')}</Label>
			<Select id="map-kind" bind:value={form.kind}>
				<option value="">{t('import.col_none')}</option>
				{#each Array.from({ length: columnCount }, (_, i) => i) as i (i)}<option value={String(i)}>{optionLabel(i)}</option>{/each}
			</Select>
			<p class="text-xs text-muted-foreground">{t('import.kind_hint')}</p>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="map-place">{t('import.field_place')}</Label>
			<Select id="map-place" bind:value={form.place}>
				<option value="">{t('import.col_none')}</option>
				{#each Array.from({ length: columnCount }, (_, i) => i) as i (i)}<option value={String(i)}>{optionLabel(i)}</option>{/each}
			</Select>
			<p class="text-xs text-muted-foreground">{t('import.place_hint')}</p>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="map-note">{t('import.field_note')}</Label>
			<Select id="map-note" bind:value={form.note}>
				<option value="">{t('import.col_none')}</option>
				{#each Array.from({ length: columnCount }, (_, i) => i) as i (i)}<option value={String(i)}>{optionLabel(i)}</option>{/each}
			</Select>
		</div>
	</section>

	<section class="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="formats-heading">
		<h4 id="formats-heading" class="text-sm font-medium">{t('import.formats_title')}</h4>
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="date-format">{t('import.date_format')}</Label>
				<Select id="date-format" bind:value={form.dateFormat}>
					<option value="dd.MM.yyyy">{t('import.date_format_dmy')}</option>
					<option value="yyyy-MM-dd">{t('import.date_format_iso')}</option>
					<option value="excel_serial">{t('import.date_format_serial')}</option>
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="time-format">{t('import.time_format')}</Label>
				<Select id="time-format" bind:value={form.timeFormat}>
					<option value="HH:mm">{t('import.time_format_clock')}</option>
					<option value="excel_fraction">{t('import.time_format_fraction')}</option>
					<option value="decimal_hours">{t('import.time_format_decimal')}</option>
				</Select>
			</div>
		</div>
		{#if form.timeFormat === 'decimal_hours'}
			<Alert variant="warning" data-testid="decimal-hours-note">
				<p class="font-medium">{t('import.decimal_title')}</p>
				<p class="mt-1">{t('import.decimal_text')}</p>
			</Alert>
		{/if}
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="default-kind">{t('import.default_kind')}</Label>
				<Select id="default-kind" bind:value={form.defaultKind}>
					{#each kinds as kind (kind)}<option value={kind}>{kindLabel(kind)}</option>{/each}
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="header-row-number">{t('import.header_title')}</Label>
				<Input id="header-row-number" type="number" min={0} bind:value={form.headerRow} />
			</div>
		</div>
		<label class="flex items-center gap-2 text-sm"><Checkbox id="skip-summary" bind:checked={form.skipSummaryRows} />{t('import.skip_summary')}</label>
	</section>

	<section class="flex flex-col gap-1 rounded-lg border bg-muted/30 p-4 text-sm" aria-labelledby="probe-heading" data-testid="probe">
		<h4 id="probe-heading" class="font-medium">{t('import.sample_title')}</h4>
		{#if !sampleRow}
			<p class="text-muted-foreground">{t('import.sample_empty')}</p>
		{:else}
			{#each probes as probe (probe.field)}
				<p class={probe.value ? '' : 'text-destructive'}>
					{probe.value ? t('import.sample_ok', { field: probe.field, raw: probe.raw, value: probe.value }) : t('import.sample_bad', { field: probe.field, raw: probe.raw })}
				</p>
			{/each}
		{/if}
	</section>

	{#if showIssues && issues.length > 0}
		<Alert variant="destructive" data-testid="mapping-issues">
			<ul class="list-disc pl-5">
				{#each issues as issue (issue)}<li>{issueText(issue)}</li>{/each}
			</ul>
		</Alert>
	{/if}

	<div class="flex flex-wrap gap-2">
		<Button type="button" variant="outline" onclick={onback} disabled={busy}>{t('common.back')}</Button>
		<Button type="button" onclick={onsubmit} disabled={busy}>{busy ? t('import.validating') : t('import.validate')}</Button>
	</div>
</div>
