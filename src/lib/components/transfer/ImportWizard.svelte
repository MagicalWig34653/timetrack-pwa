<script lang="ts">
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { api, ApiError } from '#lib/api/client.js';
	import type { ImportJob, WorkModel, ImportPreview, ImportProfile, ImportResult, ImportTemplate, RawPreview, WorktimeAction, WorktimeRemarkRule } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { formatDateNumeric, localTimeOf, todayLocal } from '#lib/time/dates.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { formatDuration } from '#lib/time/format.js';
	import { kindLabel } from '#lib/time/labels.js';
	import { formatBytes, MAX_IMPORT_BYTES } from '#lib/transfer/bytes.js';
	import {
		checkImportFile,
		emptyMappingForm,
		formFromMapping,
		formIssues,
		IMPORT_STEPS,
		mappingFromForm,
		suggestColumns,
		type ImportStep,
		type MappingForm
	} from '#lib/transfer/import-flow.js';
	import { DEFAULT_WORKTIME_RULES, exactRuleFor, isWarning } from '#lib/transfer/worktime.js';
	import { fallbackExportName, saveBlob } from '#lib/transfer/export.js';
	import {
		emptyWorktimeForm,
		formFromWorktime,
		isRecommended,
		isWorktimeTemplate,
		modelStartHint,
		worktimeFacts,
		worktimeFromForm,
		worktimeIssues,
		worktimeMapping,
		type WorktimeForm
	} from '#lib/transfer/worktime-flow.js';
	import { de } from '#lib/i18n/de.js';
	import { tick, untrack } from 'svelte';
	import MappingStep from './MappingStep.svelte';
	import RawTable from './RawTable.svelte';
	import ImportWarnings from './ImportWarnings.svelte';
	import WorktimeNextStep from './WorktimeNextStep.svelte';
	import WorktimeOptions from './WorktimeOptions.svelte';
	import WorktimePreviewPanel from './WorktimePreviewPanel.svelte';
	import WorktimeRecognition from './WorktimeRecognition.svelte';
	import Stepper from './Stepper.svelte';

	let step = $state<ImportStep>('upload');
	let job = $state<ImportJob | null>(null);
	let raw = $state<RawPreview | null>(null);
	let rawLoading = $state(false);
	let form = $state<MappingForm>(emptyMappingForm(''));
	let preview = $state<ImportPreview | null>(null);
	let result = $state<ImportResult | null>(null);
	let templates = $state<ImportTemplate[]>([]);
	let templatesUnavailable = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let showIssues = $state(false);
	let dragging = $state(false);
	let pickedFile = $state<File | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();
	let heading: HTMLHeadingElement | undefined = $state();
	let confirmChecked = $state(false);
	let ignoreErrors = $state(false);
	let rollbackAsk = $state(false);
	let rolledBack = $state(false);
	let conflicts = $state<{ id: string; type?: string }[]>([]);
	let profile = $state<ImportProfile>('generic');
	let wtForm = $state<WorktimeForm>(emptyWorktimeForm());
	let defaultRules = $state<WorktimeRemarkRule[]>(DEFAULT_WORKTIME_RULES);
	let rulesLoaded = false;

	let analysing = $state(false);
	let analysisFailed = $state(false);
	let customizeOpen = $state(false);
	let templateBusy = $state(false);
	/** serialised options of the preview that was requested last; differs while an option change is not yet reflected */
	let previewedKey = $state('');
	let previewSeq = 0;

	const isWorktime = $derived(profile === 'worktime_workbook');
	/** the recognised table: the work-time flow has three steps (file, preview, result) */
	const WORKTIME_STEPS: ImportStep[] = ['upload', 'preview', 'result'];
	const stepName = (id: ImportStep) => t(`import.step.${id}` as MessageKey);
	const stepList = $derived((isWorktime ? WORKTIME_STEPS : [...IMPORT_STEPS]).map((id) => ({ id, label: stepName(id) })));
	const optionsKey = $derived(JSON.stringify(worktimeFromForm(wtForm)));
	const wtIssues = $derived(worktimeIssues(wtForm));
	const stale = $derived(isWorktime && optionsKey !== previewedKey);
	const refreshing = $derived(stale || analysing);
	const recommended = $derived(isRecommended(wtForm, defaultRules));
	const facts = $derived(job && preview?.worktime ? worktimeFacts(preview.worktime, job.sheets.length) : null);
	const created = $derived(preview?.valid ?? 0);
	/** warnings (pause_exceeds_day) never block the commit */
	const errorCount = $derived(preview?.errors.filter((e) => !isWarning(e.code)).length ?? 0);
	/** error rows and warnings (separate `warnings` list since contract v0.10.1) in one table */
	const issues = $derived([...(preview?.errors ?? []), ...(preview?.warnings ?? []).filter((w) => w.count === undefined).map((w) => ({ row: w.row ?? 0, code: w.code }))]);
	/** aggregated warnings (code + number of days, contract v0.10.2) are listed separately, not per row */
	const aggregated = $derived((preview?.warnings ?? []).filter((w) => w.count !== undefined));
	let models = $state<WorkModel[] | null>(null);
	const visibleTemplates = $derived(templates.filter((x) => isWorktimeTemplate(x.mapping) === isWorktime));

	// Move focus to the step heading after every step change (not on first render) so keyboard and screen reader users follow along.
	let firstRender = true;
	$effect(() => {
		void step;
		if (firstRender) {
			firstRender = false;
			return;
		}
		untrack(() => void tick().then(() => heading?.focus()));
	});

	function go(next: ImportStep) {
		error = '';
		step = next;
	}

	function reset(message = '') {
		job = null;
		raw = null;
		preview = null;
		result = null;
		pickedFile = null;
		confirmChecked = false;
		ignoreErrors = false;
		rollbackAsk = false;
		rolledBack = false;
		conflicts = [];
		showIssues = false;
		profile = 'generic';
		wtForm = emptyWorktimeForm(defaultRules);
		form = emptyMappingForm('');
		previewedKey = '';
		previewSeq++;
		analysing = false;
		analysisFailed = false;
		customizeOpen = false;
		models = null;
		notice = message;
		go('upload');
	}

	// ---- upload
	function pick(file: File | undefined | null) {
		error = '';
		pickedFile = null;
		if (!file) return;
		const check = checkImportFile(file, MAX_IMPORT_BYTES);
		if (check === 'too_large') error = t('import.file_too_large');
		else if (check === 'unsupported') error = t('import.file_unsupported');
		else if (check === 'empty') error = t('import.file_empty');
		else pickedFile = file;
	}

	async function upload() {
		if (!pickedFile) return;
		busy = true;
		error = '';
		notice = '';
		try {
			job = await api.uploadImport(pickedFile);
			form = emptyMappingForm(job.sheets[0] ?? '');
			profile = job.detectedProfile === 'worktime_workbook' ? 'worktime_workbook' : 'generic';
			wtForm = emptyWorktimeForm(defaultRules);
			if (isWorktime) {
				// recognised: the template is applied (default options) and the numbers come from a first preview; step 1 shows the result
				busy = false;
				await analyse();
				return;
			}
			await loadRaw(form.sheet);
			go('sheet');
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function loadRaw(sheet: string) {
		if (!job) return;
		rawLoading = true;
		try {
			raw = await api.previewImportRows(job.id, sheet);
		} finally {
			rawLoading = false;
		}
	}

	// ---- sheet and header row
	async function changeSheet() {
		error = '';
		try {
			await loadRaw(form.sheet);
		} catch (e) {
			error = errorMessage(e);
		}
	}

	/** Standard remark rules come from the server; the built-in copy is the fallback (older backend, offline). */
	async function fetchDefaultRules(): Promise<boolean> {
		try {
			const rules = await api.worktimeDefaultRules();
			if (Array.isArray(rules) && rules.length > 0) {
				defaultRules = rules;
				return true;
			}
		} catch {
			/* fall back to the built-in rules */
		}
		return false;
	}

	async function resetRules() {
		notice = '';
		error = '';
		const loaded = await fetchDefaultRules();
		wtForm.rules = defaultRules.map((r) => ({ ...r }));
		if (loaded) notice = t('worktime.rules_reset_done');
		else error = t('worktime.rules_reset_failed');
	}

	/** First preview with the recommended options right after the upload; fills the recognition card. */
	async function analyse() {
		if (!job) return;
		error = '';
		analysisFailed = false;
		analysing = true;
		try {
			if (!rulesLoaded) {
				rulesLoaded = true;
				const untouched = JSON.stringify(wtForm.rules) === JSON.stringify(DEFAULT_WORKTIME_RULES);
				if ((await fetchDefaultRules()) && untouched) wtForm.rules = defaultRules.map((r) => ({ ...r }));
			}
			if (!(await previewWorktime())) analysisFailed = true;
		} finally {
			analysing = false;
		}
	}

	/** Requests the preview for the current work-time options; later requests win. Returns false on failure (error is set). */
	async function previewWorktime(): Promise<boolean> {
		if (!job) return false;
		const seq = ++previewSeq;
		const key = optionsKey;
		previewedKey = key;
		error = '';
		try {
			const result = await api.putImportMapping(job.id, worktimeMapping(job.sheets[0] ?? '', wtForm));
			if (seq !== previewSeq) return true;
			preview = result;
			if (!models) models = await api.listWorkModels().catch(() => null);
			return true;
		} catch (e) {
			if (seq === previewSeq) {
				error = errorMessage(e);
				// the failed options stay "stale": the primary button waits for a successful preview
				previewedKey = '';
			}
			return false;
		}
	}

	async function openWorktimePreview() {
		if (!job) return;
		if (!preview || stale) {
			busy = true;
			const ok = await previewWorktime();
			busy = false;
			if (!ok) return;
		}
		confirmChecked = false;
		ignoreErrors = false;
		go('preview');
		void loadTemplates();
	}

	/** "Stattdessen Spalten selbst zuordnen": leaves the template and continues in the generic wizard. */
	async function chooseGeneric() {
		if (!job) return;
		switchProfile('generic');
		busy = true;
		try {
			await loadRaw(form.sheet);
			go('sheet');
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function chooseWorktime() {
		switchProfile('worktime_workbook');
		await analyse();
		if (!analysisFailed) await openWorktimePreview();
	}

	async function chooseOtherFile() {
		if (job) await api.discardImport(job.id).catch(() => undefined);
		reset();
	}

	function switchProfile(next: ImportProfile) {
		profile = next;
		showIssues = false;
		error = '';
		notice = '';
	}

	async function loadTemplates() {
		try {
			templates = await api.listImportTemplates();
			templatesUnavailable = false;
		} catch (e) {
			templatesUnavailable = e instanceof ApiError && (e.status === 404 || e.status === 501);
		}
	}

	/** Empty template: the export of next year's sheet (the export endpoint needs no data; already existing entries would be included). */
	async function downloadTemplate() {
		templateBusy = true;
		error = '';
		notice = '';
		try {
			const year = Number(todayLocal(zoneStore.value).slice(0, 4)) + 1;
			const file = await api.exportTime(`${year}-01-01`, `${year}-12-31`, 'worktime-xlsx');
			saveBlob(file.blob, file.filename ?? fallbackExportName(`${year}-01-01`, `${year}-12-31`, 'xlsx'));
			notice = t('import.template_file_done', { year });
		} catch (e) {
			error = errorMessage(e);
		} finally {
			templateBusy = false;
		}
	}

	async function toMapping() {
		if (!job || !raw) return;
		error = '';
		const header = Number(form.headerRow) || 0;
		if (header > 0) {
			const suggestion = suggestColumns(raw.rows[header - 1] ?? []);
			const set = (key: 'date' | 'start' | 'end' | 'duration' | 'kind' | 'place' | 'note') => {
				if (form[key] === '' && suggestion[key] !== undefined) form[key] = String(suggestion[key]);
			};
			(['date', 'start', 'kind', 'place', 'note'] as const).forEach(set);
			if (form.end === '' && form.duration === '') {
				if (suggestion.end !== undefined) {
					form.endMode = 'end';
					form.end = String(suggestion.end);
				} else if (suggestion.duration !== undefined) {
					form.endMode = 'duration';
					form.duration = String(suggestion.duration);
				}
			}
		}
		go('mapping');
		await loadTemplates();
	}

	// ---- templates
	async function saveTemplate(name: string) {
		error = '';
		notice = '';
		try {
			const created = await api.createImportTemplate(name, isWorktime ? worktimeMapping(job?.sheets[0] ?? '', wtForm) : mappingFromForm(form));
			templates = [...templates, created];
			notice = t('import.template_saved', { name: created.name });
		} catch (e) {
			error = errorMessage(e);
		}
	}

	function applyTemplate(template: ImportTemplate) {
		if (!job) return;
		if (isWorktimeTemplate(template.mapping)) {
			profile = 'worktime_workbook';
			wtForm = formFromWorktime(template.mapping.worktime, defaultRules);
			showIssues = false;
			notice = step === 'preview' ? t('worktime.template_applied', { name: template.name }) : t('import.template_applied', { name: template.name });
			return;
		}
		profile = 'generic';
		form = formFromMapping(template.mapping, job.sheets);
		showIssues = false;
		notice = t('import.template_applied', { name: template.name });
		void loadRaw(form.sheet);
	}

	async function deleteTemplate(template: ImportTemplate) {
		error = '';
		try {
			await api.deleteImportTemplate(template.id);
			templates = templates.filter((x) => x.id !== template.id);
			notice = t('import.template_deleted');
		} catch (e) {
			error = errorMessage(e);
		}
	}

	// ---- validation
	async function validate(keepNotice = false) {
		if (!job) return;
		showIssues = true;
		error = '';
		if (!keepNotice) notice = '';
		if (formIssues(form).length > 0) return;
		busy = true;
		try {
			preview = await api.putImportMapping(job.id, mappingFromForm(form));
			confirmChecked = false;
			ignoreErrors = false;
			go('preview');
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	/** "Das merken": exact-text rule for an unknown remark, then the preview is rebuilt. */
	async function createRule(text: string, action: WorktimeAction) {
		wtForm.rules = [...wtForm.rules, exactRuleFor(text, action)];
		busy = true;
		const ok = await previewWorktime();
		busy = false;
		if (ok) notice = t('worktime.unmapped_created');
	}

	/** "Zurücksetzen auf Empfehlung": all options and remark meanings back to the recommendation. */
	async function resetOptions() {
		notice = '';
		error = '';
		await fetchDefaultRules();
		wtForm = emptyWorktimeForm(defaultRules);
		notice = t('worktime.customize_reset_done');
	}

	// Option changes refresh the preview by themselves (debounced); an invalid form waits for a correction.
	$effect(() => {
		const key = optionsKey;
		if (!(isWorktime && step === 'preview' && job) || key === previewedKey || wtIssues.length > 0) return;
		const handle = setTimeout(() => void untrack(() => previewWorktime()), 350);
		return () => clearTimeout(handle);
	});
	$effect(() => {
		if (wtIssues.length > 0) customizeOpen = true;
	});

	// ---- commit
	async function commit() {
		if (!job || (!isWorktime && !confirmChecked) || (errorCount > 0 && !ignoreErrors) || (isWorktime && stale)) return;
		busy = true;
		error = '';
		try {
			result = await api.commitImport(job.id, ignoreErrors);
			// the work model step of the result screen starts from the current list
			if (isWorktime) models = await api.listWorkModels().catch(() => null);
			go('result');
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function discard() {
		if (!job) return;
		busy = true;
		try {
			await api.discardImport(job.id);
			reset(t('import.discarded'));
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function rollback() {
		if (!job) return;
		busy = true;
		error = '';
		conflicts = [];
		try {
			await api.rollbackImport(job.id);
			rolledBack = true;
			rollbackAsk = false;
		} catch (e) {
			rollbackAsk = false;
			if (e instanceof ApiError && e.status === 409) {
				// contract v0.10.1: typed `conflictItems` ({type,id}) next to the plain UUID list `conflicts`; prefer the typed list
				const body = e.body as { conflicts?: unknown; conflictItems?: unknown; error?: { conflicts?: unknown; conflictItems?: unknown } } | undefined;
				const typed = [body?.conflictItems, body?.error?.conflictItems].find((value) => Array.isArray(value) && value.length > 0);
				const list = typed ?? body?.conflicts ?? body?.error?.conflicts;
				if (Array.isArray(list)) {
					conflicts = list.map((entry) => {
						if (entry && typeof entry === 'object') {
							const { id, type } = entry as { id?: unknown; type?: unknown };
							return { id: String(id ?? ''), type: typeof type === 'string' ? type : undefined };
						}
						return { id: String(entry) };
					});
				}
			}
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	const de_has = (key: string): key is MessageKey => key in de;
	const errorText = (code: string) => {
		const key = `import.error.${code}` as MessageKey;
		return t(de_has(key) ? key : 'import.error.unknown');
	};
	const isWarningCode = (code: string) => isWarning(code);
	const conflictType = (type: string | undefined) => {
		const key = `import.conflict_type.${type}` as MessageKey;
		return type && de_has(key) ? t(key) : '';
	};
	const resultTotal = $derived((result?.created ?? 0) + (result?.absencesCreated ?? 0) + (result?.customDaysCreated ?? 0));
	const firstDate = $derived(preview?.sample.find((s) => s.date)?.date ?? preview?.worktime?.firstDate ?? null);
	/** first day with content: the work model should start there */
	const nextStepDate = $derived(preview?.worktime?.firstContentDate ?? preview?.worktime?.firstDate ?? null);
	const sheetBalance = $derived(preview?.worktime ? (preview.worktime.sheetBalanceUpToTodaySeconds ?? preview.worktime.sheetBalanceSeconds ?? null) : null);
	const modelNeedsStep = $derived(isWorktime && !!models && !!nextStepDate && modelStartHint(nextStepDate, models)?.kind !== 'ok');
	const duration = (s: { startedAt?: string; endedAt?: string }) => (s.startedAt && s.endedAt ? formatDuration((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : '');
</script>

<div class="flex flex-col gap-6">
	<Stepper steps={stepList} current={step} label={t('import.steps')} />

	{#if notice}<Alert variant="success" data-testid="import-notice">{notice}</Alert>{/if}
	{#if error}<Alert variant="destructive" data-testid="import-error">{error}</Alert>{/if}

	<h2 bind:this={heading} tabindex="-1" class="text-lg font-semibold outline-none" data-testid="step-heading">{stepName(step)}</h2>

	{#snippet issuesList()}
		{#if issues.length > 0}
			<section aria-labelledby="errors-heading">
				<h3 id="errors-heading" class="mb-2 font-medium">{t('import.errors_title')}</h3>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="max-h-64 overflow-auto rounded-lg border" tabindex="0" role="region" aria-labelledby="errors-heading">
					<table class="w-full text-sm" data-testid="error-table">
						<thead class="bg-muted text-left"><tr><th scope="col" class="px-3 py-1.5">{t('import.errors_col_row')}</th><th scope="col" class="px-3 py-1.5">{t('import.errors_col_problem')}</th></tr></thead>
						<tbody>
							{#each issues as err, i (i)}
								<tr class="border-t" data-code={err.code} data-warning={isWarningCode(err.code) ? 'true' : undefined}>
									<td class="px-3 py-1.5 tabular-nums">{err.row || '–'}</td>
									<td class="px-3 py-1.5">{#if isWarningCode(err.code)}<span class="mr-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium">{t('import.warning_label')}</span>{/if}{errorText(err.code)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	{/snippet}
	{#snippet sampleTable()}
		<section aria-labelledby="sample-heading">
			<h3 id="sample-heading" class="mb-2 font-medium">{t('import.sample_table_title')}</h3>
			{#if (preview?.sample.length ?? 0) === 0}
				<p class="text-sm text-muted-foreground">{t('import.sample_none')}</p>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="overflow-x-auto rounded-lg border" tabindex="0" role="region" aria-labelledby="sample-heading">
					<table class="w-full text-sm" data-testid="sample-table">
						<thead class="bg-muted text-left">
							<tr>
								<th scope="col" class="px-3 py-1.5">{t('import.sample_col_date')}</th>
								<th scope="col" class="px-3 py-1.5">{t('import.sample_col_start')}</th>
								<th scope="col" class="px-3 py-1.5">{t('import.sample_col_end')}</th>
								<th scope="col" class="px-3 py-1.5">{t('import.sample_col_duration')}</th>
								<th scope="col" class="px-3 py-1.5">{t('import.sample_col_kind')}</th>
							</tr>
						</thead>
						<tbody>
							{#each preview?.sample ?? [] as row, i (i)}
								<tr class="border-t">
									<td class="px-3 py-1.5 tabular-nums">{row.date ? formatDateNumeric(row.date) : ''}</td>
									<td class="px-3 py-1.5 tabular-nums">{row.startedAt ? localTimeOf(row.startedAt) : ''}</td>
									<td class="px-3 py-1.5 tabular-nums">{row.endedAt ? localTimeOf(row.endedAt) : ''}</td>
									<td class="px-3 py-1.5 tabular-nums">{duration(row)}</td>
									<td class="px-3 py-1.5">{row.kind ? kindLabel(row.kind) : ''}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/snippet}

	{#if step === 'upload' && job && isWorktime}
		<WorktimeRecognition {job} {facts} loading={analysing} failed={analysisFailed} {busy} onnext={openWorktimePreview} ongeneric={chooseGeneric} onotherfile={chooseOtherFile} />
	{:else if step === 'upload'}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center {dragging ? 'border-primary bg-primary/5' : ''}"
			role="group"
			aria-label={t('import.upload_title')}
			data-testid="dropzone"
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={(e) => {
				e.preventDefault();
				dragging = false;
				pick(e.dataTransfer?.files?.[0]);
			}}
		>
			<p>{t('import.drop_text')}</p>
			<p class="text-xs text-muted-foreground">{t('import.drop_hint')}</p>
			<input
				bind:this={fileInput}
				type="file"
				class="sr-only"
				tabindex="-1"
				accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				aria-label={t('import.file_input')}
				data-testid="import-file"
				onchange={(e) => pick(e.currentTarget.files?.[0])}
			/>
			<Button type="button" variant="outline" onclick={() => fileInput?.click()}>{t('import.choose_file')}</Button>
			{#if pickedFile}
				<p class="text-sm font-medium" data-testid="picked-file">{t('import.file_selected', { name: pickedFile.name, size: formatBytes(pickedFile.size) })}</p>
			{/if}
		</div>
		<p class="text-xs text-muted-foreground">{t('import.upload_note')}</p>
		<div>
			<Button onclick={upload} disabled={!pickedFile || busy}>{busy ? t('import.uploading') : t('common.next')}</Button>
		</div>
		<section class="flex flex-col gap-2 border-t pt-4 text-sm" aria-labelledby="template-file-heading" data-testid="template-file">
			<h3 id="template-file-heading" class="font-medium">{t('import.template_file_title')}</h3>
			<p class="text-[13px] text-muted-foreground">{t('import.template_file_text')}</p>
			<div class="flex flex-wrap items-center gap-3">
				<Button type="button" variant="outline" size="sm" onclick={downloadTemplate} disabled={templateBusy} data-testid="template-file-download">{templateBusy ? t('import.template_file_downloading') : t('import.template_file_download')}</Button>
				<span class="text-[13px] text-muted-foreground">{t('import.template_file_note', { year: Number(todayLocal(zoneStore.value).slice(0, 4)) + 1 })}</span>
			</div>
		</section>
	{:else if step === 'sheet' && job && raw}
		{#if job.detectedProfile === 'worktime_workbook' && !isWorktime}
			<Alert data-testid="profile-banner-generic">
				<p>{t('import.profile_generic_note')}</p>
				<div class="mt-2"><Button type="button" variant="outline" size="sm" onclick={chooseWorktime} disabled={busy} data-testid="profile-switch-worktime">{t('import.profile_switch_worktime')}</Button></div>
			</Alert>
		{/if}
		<div class="grid gap-3 sm:grid-cols-2">
			{#if job.sheets.length > 1}
				<div class="flex flex-col gap-1.5">
					<Label for="sheet-select">{t('import.sheet_label')}</Label>
					<Select id="sheet-select" bind:value={form.sheet} onchange={changeSheet}>
						{#each job.sheets as sheet (sheet)}<option value={sheet}>{sheet}</option>{/each}
					</Select>
				</div>
			{:else}
				<p class="text-sm">{t('import.sheet_one', { name: job.sheets[0] ?? '' })}</p>
			{/if}
		</div>
		<div>
			<h3 class="font-medium">{t('import.header_title')}</h3>
			<p class="text-sm text-muted-foreground">{t('import.header_text')}</p>
		</div>
		<label class="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				class="size-4 accent-primary"
				checked={form.headerRow === '0'}
				onchange={(e) => (form.headerRow = e.currentTarget.checked ? '0' : '1')}
				data-testid="no-header"
			/>
			{t('import.header_none')}
		</label>
		<h3 class="font-medium">{t('import.raw_title')}</h3>
		{#if rawLoading}
			<p class="text-sm text-muted-foreground">{t('import.raw_loading')}</p>
		{:else}
			<RawTable rows={raw.rows} headerRow={Number(form.headerRow) || 0} onheader={(row) => (form.headerRow = String(row))} />
		{/if}
		<div class="flex flex-wrap gap-2">
			<Button variant="destructive" onclick={discard} disabled={busy}>{t('import.discard')}</Button>
			<Button onclick={toMapping} disabled={busy || rawLoading}>{t('common.next')}</Button>
		</div>
	{:else if step === 'mapping' && job && raw}
		<MappingStep
			bind:form
			rows={raw.rows}
			templates={visibleTemplates}
			{templatesUnavailable}
			{busy}
			{showIssues}
			onapply={applyTemplate}
			onsave={saveTemplate}
			ondelete={deleteTemplate}
			onsubmit={() => validate()}
			onback={() => go('sheet')}
		/>
		<div><Button variant="ghost" size="sm" onclick={discard} disabled={busy}>{t('import.discard')}</Button></div>
	{:else if step === 'preview' && preview && isWorktime && preview.worktime && facts}
		<WorktimePreviewPanel worktime={preview.worktime} {facts} duplicates={preview.duplicates} {refreshing} {busy} oncreaterule={createRule} modelPending={modelNeedsStep}>
			{#snippet warnings()}
				<ImportWarnings warnings={aggregated} />
				{#if issues.length > 0}{@render issuesList()}{/if}
			{/snippet}
			{#snippet actions()}
				<section class="flex flex-col gap-3" aria-label={t('worktime.primary_commit')} data-testid="wt-commit-area">
					{#if errorCount > 0}
						<div class="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
							<p class="font-medium">{t('worktime.errors_title')}</p>
							<p class="mt-1 text-[13px]">{t('worktime.errors_text', { count: errorCount })}</p>
							<label class="mt-2 flex items-start gap-2"><Checkbox id="ignore-errors" class="mt-0.5" bind:checked={ignoreErrors} />{t('worktime.errors_ignore')}</label>
						</div>
					{/if}
					<div class="flex flex-wrap items-center gap-3">
						<Button onclick={commit} size="lg" disabled={busy || refreshing || wtIssues.length > 0 || (preview?.valid ?? 0) === 0 || (errorCount > 0 && !ignoreErrors)} data-testid="commit">{busy ? t('worktime.primary_committing') : t('worktime.primary_commit')}</Button>
						{#if refreshing}<span class="text-[13px] text-muted-foreground" role="status">{t('worktime.summary_refreshing')}</span>{/if}
					</div>
					<p class="text-[13px] text-muted-foreground">{t('worktime.commit_hint')}</p>
				</section>
			{/snippet}
		</WorktimePreviewPanel>

		<WorktimeOptions
			bind:form={wtForm}
			bind:open={customizeOpen}
			changed={!recommended}
			worktime={preview.worktime}
			sheets={job?.sheets ?? []}
			templates={visibleTemplates}
			{templatesUnavailable}
			{busy}
			onapply={applyTemplate}
			onsave={saveTemplate}
			ondelete={deleteTemplate}
			onresetrules={resetRules}
			onreset={resetOptions}
		/>

		<details class="rounded-lg border" data-testid="wt-sample">
			<summary class="min-h-11 cursor-pointer rounded-lg px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('import.sample_table_title')}</summary>
			<div class="border-t p-3">{@render sampleTable()}</div>
		</details>

		<div class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={() => go('upload')} disabled={busy}>{t('common.back')}</Button>
			<Button variant="ghost" onclick={discard} disabled={busy}>{t('import.discard')}</Button>
		</div>
	{:else if step === 'preview' && preview}
		<p class="text-sm text-muted-foreground">{t('import.preview_text')}</p>
		<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="preview-counts">
			<Card class="py-3"><CardContent><dt class="text-xs text-muted-foreground">{t('import.count_rows')}</dt><dd class="text-xl font-semibold tabular-nums" data-testid="count-rows">{preview.rows}</dd></CardContent></Card>
			<Card class="py-3"><CardContent><dt class="text-xs text-muted-foreground">{t('import.count_valid')}</dt><dd class="text-xl font-semibold tabular-nums" data-testid="count-valid">{preview.valid}</dd></CardContent></Card>
			<Card class="py-3"><CardContent><dt class="text-xs text-muted-foreground">{t('import.count_duplicates')}</dt><dd class="text-xl font-semibold tabular-nums" data-testid="count-duplicates">{preview.duplicates}</dd></CardContent></Card>
			<Card class="py-3"><CardContent><dt class="text-xs text-muted-foreground">{t('import.count_errors')}</dt><dd class="text-xl font-semibold tabular-nums" data-testid="count-errors">{errorCount}</dd></CardContent></Card>
		</dl>
		{#if preview.duplicates > 0}<p class="text-sm text-muted-foreground">{t('import.duplicates_note')}</p>{/if}
		{#if issues.length > 0}{@render issuesList()}{/if}
		{@render sampleTable()}
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={() => go('mapping')}>{t('import.back_mapping')}</Button>
			<Button onclick={() => go('confirm')} disabled={preview.valid === 0 && preview.errors.length === 0 && preview.duplicates === 0}>{t('import.to_confirm')}</Button>
			<Button variant="ghost" onclick={discard} disabled={busy}>{t('import.discard')}</Button>
		</div>
	{:else if step === 'confirm' && preview}
		<p class="text-sm">{t('import.confirm_text')}</p>
		<Card>
			<CardContent class="flex flex-col gap-3">
				<p class="font-medium" data-testid="confirm-summary">{t('import.confirm_summary', { created: preview.valid, duplicates: preview.duplicates })}</p>
				{#if errorCount > 0}
					<p class="text-sm text-muted-foreground">{t('import.confirm_errors', { errors: errorCount })}</p>
					<label class="flex items-start gap-2 text-sm"><Checkbox id="ignore-errors" class="mt-0.5" bind:checked={ignoreErrors} />{t('import.confirm_ignore_errors')}</label>
				{/if}
				<label class="flex items-start gap-2 text-sm"><Checkbox id="confirm-check" class="mt-0.5" bind:checked={confirmChecked} />{t('import.confirm_check', { created })}</label>
				<p class="text-xs text-muted-foreground">{t('import.rollback_hint')}</p>
			</CardContent>
		</Card>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={() => go('preview')} disabled={busy}>{t('import.back_preview')}</Button>
			<Button onclick={commit} disabled={busy || !confirmChecked || (errorCount > 0 && !ignoreErrors)} data-testid="commit">{busy ? t('import.committing') : t('import.commit')}</Button>
			<Button variant="ghost" onclick={discard} disabled={busy}>{t('import.discard')}</Button>
		</div>
	{:else if step === 'result' && result}
		{#if rolledBack}
			<Alert variant="success" data-testid="rolled-back">{t('import.rolled_back')}</Alert>
		{:else}
			<Card>
				<CardContent class="flex flex-col gap-2">
					{#if isWorktime}
						<h3 class="text-lg font-semibold">{t('worktime.result_title')}</h3>
						<p class="text-sm text-muted-foreground">{t('worktime.result_text')}</p>
					{/if}
					<p class="{isWorktime ? 'text-base' : 'text-lg'} flex items-center gap-2 font-semibold" data-testid="result-created">{t('import.result_created', { count: result.created })}</p>
					<p class="text-sm text-muted-foreground" data-testid="result-skipped">{t('import.result_skipped', { count: result.skipped })}</p>
					{#if (result.absencesCreated ?? 0) > 0}<p class="text-sm" data-testid="result-absences">{t('import.result_absences', { count: result.absencesCreated ?? 0 })}</p>{/if}
					{#if (result.customDaysCreated ?? 0) > 0}<p class="text-sm" data-testid="result-custom-days">{t('import.result_custom_days', { count: result.customDaysCreated ?? 0 })}</p>{/if}
					{#if resultTotal === 0}<p class="text-sm">{t('import.result_none_created')}</p>{/if}
				</CardContent>
			</Card>
			{#if isWorktime && nextStepDate}
				<WorktimeNextStep firstDate={nextStepDate} initialModels={models ?? []} sheetBalanceSeconds={sheetBalance} continueHref={firstDate ? `/time/${firstDate}` : '/time'} />
			{:else if isWorktime}
				<a class={buttonVariants()} href="/time">{t('worktime.next_continue')}</a>
			{/if}
			{#if (result.warnings ?? []).length > 0}<ImportWarnings warnings={result.warnings ?? []} testid="result-warnings" />{/if}
			{#if !isWorktime}
				<div class="flex flex-wrap gap-2">
					{#if firstDate}
						<a class="text-sm underline underline-offset-4" href="/time/{firstDate}">{t('import.open_day')}</a>
						{#if moduleStore.enabled('planning')}<a class="text-sm underline underline-offset-4" href="/calendar?date={firstDate}">{t('import.open_calendar')}</a>{/if}
					{:else}
						<a class="text-sm underline underline-offset-4" href="/time">{t('import.open_time')}</a>
					{/if}
				</div>
			{/if}
			{#if conflicts.length > 0}
				<Alert variant="warning" data-testid="rollback-conflicts">
					<p class="font-medium">{t('import.conflict_title')}</p>
					<p class="mt-1">{t('import.conflict_text', { count: conflicts.length })}</p>
					<ul class="mt-2 list-disc pl-5 text-xs">
						{#each conflicts as entry (entry.id)}
							<li data-conflict-type={entry.type}>{entry.type && conflictType(entry.type) ? t('import.conflict_typed_item', { type: conflictType(entry.type), id: entry.id }) : t('import.conflict_item', { id: entry.id })}</li>
						{/each}
					</ul>
				</Alert>
			{/if}
			{#if rollbackAsk}
				<Alert variant="warning">
					<p>{t('import.rollback_confirm_text')}</p>
					<div class="mt-2 flex gap-2">
						<Button variant="destructive" size="sm" onclick={rollback} disabled={busy} data-testid="rollback-confirm">{t('import.rollback_confirm')}</Button>
						<Button variant="outline" size="sm" onclick={() => (rollbackAsk = false)}>{t('common.cancel')}</Button>
					</div>
				</Alert>
			{/if}
			<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="wt-more">
				{#if isWorktime}
					<span class="text-muted-foreground">{t('worktime.result_more')}</span>
					{#if firstDate}<a class="underline underline-offset-4" href="/time/{firstDate}">{t('worktime.next_open_day')}</a>{/if}
					{#if firstDate && moduleStore.enabled('planning')}<a class="underline underline-offset-4" href="/calendar?date={firstDate}">{t('import.open_calendar')}</a>{/if}
				{/if}
				{#if !rollbackAsk && resultTotal > 0}
					<Button variant="link" size="sm" class="h-auto px-0" onclick={() => (rollbackAsk = true)} disabled={busy} data-testid="rollback">{t('import.rollback')}</Button>
				{/if}
				<Button variant="link" size="sm" class="h-auto px-0" onclick={() => reset()}>{t('import.restart')}</Button>
			</div>
			<p class="text-xs text-muted-foreground">{t('import.after_leave_hint')}</p>
		{/if}
		{#if rolledBack}<div><Button onclick={() => reset()}>{t('import.restart')}</Button></div>{/if}
	{/if}
</div>
