<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { WorkModel, WorkModelPreview } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Toast from '#lib/components/app/Toast.svelte';
	import WorkModelCorrectionPanel, { type PreviewState } from '#lib/components/time/WorkModelCorrectionPanel.svelte';
	import WorkModelFields from '#lib/components/time/WorkModelFields.svelte';
	import WorkModelSummary from '#lib/components/time/WorkModelSummary.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { addDays, formatDateNumeric, todayLocal } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import {
		buildWorkModelInput,
		correctionSupported,
		defaultWorkModelForm,
		formFromModel,
		type WorkModelFormErrors,
		type WorkModelFormValues
	} from '#lib/time/work-model-form.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let models = $state<WorkModel[]>([]);
	let form = $state<WorkModelFormValues>(defaultWorkModelForm(todayLocal(), 'Europe/Berlin'));
	let errors = $state<WorkModelFormErrors>({});
	let formError = $state('');
	let notice = $state('');
	let toast = $state('');
	let pending = $state(false);
	let showForm = $state(false);
	/** The version being edited (null = a plain new version based on the newest one). */
	let editing = $state<WorkModel | null>(null);
	/** "new" = change from a date (new version, safe); "correct" = overwrite this version (contract v0.16.0). */
	let formMode = $state<'new' | 'correct'>('new');
	let confirmed = $state(false);
	let previewStatus = $state<PreviewState>('idle');
	let preview = $state<WorkModelPreview | null>(null);
	let previewMessage = $state('');

	let endingId = $state<string | null>(null);
	let endDate = $state('');
	let endError = $state('');

	const newestFirst = $derived([...models].sort((a, b) => b.validFrom.localeCompare(a.validFrom)));
	const today = $derived(todayLocal(zoneStore.value));
	const canCorrect = $derived(correctionSupported(models));
	const correcting = $derived(showForm && formMode === 'correct' && editing !== null);

	async function refresh() {
		try {
			await zoneStore.ensure();
			models = await api.listWorkModels();
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}
	/** ?validFrom=YYYY-MM-DD (from the worktime import hint) opens the form for a new version starting on that day */
	let prefilled = $state(false);
	onMount(async () => {
		await refresh();
		const wanted = new URLSearchParams(window.location.search).get('validFrom') ?? '';
		if (load.status === 'ready' && /^\d{4}-\d{2}-\d{2}$/.test(wanted) && addDays(wanted, 0) === wanted) {
			openForm(wanted);
			prefilled = true;
		}
	});

	/** Opens the form pre-filled with `source` (default: the newest version) as a new version starting on `validFrom`. */
	function openForm(validFrom?: string, source?: WorkModel) {
		const base = source ?? newestFirst[0];
		const from = validFrom ?? todayLocal(zoneStore.value);
		form = base ? formFromModel(base, from) : defaultWorkModelForm(from, zoneStore.value);
		editing = source ?? null;
		formMode = 'new';
		confirmed = false;
		errors = {};
		formError = '';
		showForm = true;
	}

	function setMode(mode: 'new' | 'correct') {
		if (!editing || mode === formMode) return;
		formMode = mode;
		form = mode === 'correct' ? formFromModel(editing, editing.validFrom, editing.validTo ?? '') : formFromModel(editing, todayLocal(zoneStore.value));
		confirmed = false;
		errors = {};
		formError = '';
	}

	function closeForm() {
		showForm = false;
		editing = null;
		formMode = 'new';
	}

	const explain = (e: unknown) =>
		e instanceof ApiError && e.code === 'model_overlap' && formMode === 'correct'
			? t('work_model.correct_overlap')
			: e instanceof ApiError && (e.code === 'stale_version' || e.status === 412)
				? t('work_model.correct_stale')
				: errorMessage(e);

	// Live preview of a correction: the server evaluates the account with and without the change (no saving).
	const correctionInput = $derived(correcting ? buildWorkModelInput(form, { withValidTo: true }) : null);
	$effect(() => {
		const built = correctionInput;
		const target = editing;
		if (!built || !target) return;
		confirmed = false;
		if ('errors' in built) {
			previewStatus = 'invalid';
			preview = null;
			return;
		}
		previewStatus = 'loading';
		let stale = false;
		const timer = setTimeout(async () => {
			try {
				const result = await api.previewWorkModel(target.id, built.input);
				if (stale) return;
				preview = result;
				previewStatus = 'ready';
			} catch (e) {
				if (stale) return;
				preview = null;
				previewMessage = explain(e);
				previewStatus = 'failed';
			}
		}, 350);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	});

	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function announce(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 4000);
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		const correct = formMode === 'correct' && editing !== null;
		const result = buildWorkModelInput(form, { withValidTo: correct });
		if ('errors' in result) {
			errors = result.errors;
			return;
		}
		errors = {};
		if (correct && (!confirmed || previewStatus !== 'ready')) return;
		pending = true;
		try {
			if (correct && editing) {
				await api.correctWorkModel(editing.id, result.input, editing.version);
			} else {
				await api.createWorkModel(result.input);
			}
			closeForm();
			announce(correct ? t('work_model.corrected') : t('work_model.created'));
			await refresh();
		} catch (e) {
			formError = explain(e);
		} finally {
			pending = false;
		}
	}

	async function end(model: WorkModel, event: Event) {
		event.preventDefault();
		if (pending) return;
		endError = '';
		if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < model.validFrom) {
			endError = t('work_model.end_invalid');
			return;
		}
		pending = true;
		try {
			await api.endWorkModel(model.id, endDate);
			endingId = null;
			notice = t('work_model.ended');
			await refresh();
		} catch (e) {
			endError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	const range = (m: WorkModel) =>
		m.validTo
			? t('work_model.range_closed', { from: formatDateNumeric(m.validFrom), to: formatDateNumeric(m.validTo) })
			: t('work_model.range_open', { from: formatDateNumeric(m.validFrom) });
	const isCurrent = (m: WorkModel) => m.validFrom <= today && (!m.validTo || m.validTo >= today);
	const submitDisabled = $derived(pending || (formMode === 'correct' && editing !== null && (!confirmed || previewStatus !== 'ready')));
</script>

<PageHeader title={t('work_model.title')} description={t('work_model.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<Alert data-testid="history-note">{t('work_model.history_note')}</Alert>
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}

		{#if newestFirst.length === 0}
			<p class="text-sm text-muted-foreground">{t('work_model.empty')}</p>
		{/if}

		<ul class="flex flex-col gap-3" data-testid="model-list">
			{#each newestFirst as model (model.id)}
				<li>
					<Card>
						<CardHeader>
							<CardTitle class="flex flex-wrap items-center gap-2">
								{range(model)}
								{#if isCurrent(model)}<Badge variant="secondary">{t('work_model.current')}</Badge>{/if}
								{#if model.validFrom > today}<Badge variant="outline">{t('work_model.future')}</Badge>{/if}
							</CardTitle>
							<CardDescription>{model.timezone ?? 'Europe/Berlin'}</CardDescription>
						</CardHeader>
						<CardContent class="flex flex-col gap-3">
							<WorkModelSummary {model} />
							<div class="flex flex-wrap gap-2">
								<Button variant="outline" size="sm" onclick={() => openForm(undefined, model)} data-testid="edit-model-{model.validFrom}">{t('work_model.edit')}</Button>
							</div>
							{#if !model.validTo}
								{#if endingId === model.id}
									<form class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" onsubmit={(e) => end(model, e)} novalidate aria-label={t('work_model.end_title')}>
										<p class="text-sm">{t('work_model.end_text')}</p>
										{#if endError}<Alert variant="destructive">{endError}</Alert>{/if}
										<Field id="model-end" type="date" label={t('work_model.end_date')} bind:value={endDate} min={model.validFrom} disabled={pending} />
										<div class="flex gap-2">
											<Button type="submit" variant="destructive" size="sm" disabled={pending}>{t('work_model.end_confirm')}</Button>
											<Button type="button" variant="outline" size="sm" onclick={() => (endingId = null)}>{t('common.cancel')}</Button>
										</div>
									</form>
								{:else}
									<div>
										<Button variant="outline" size="sm" onclick={() => { endingId = model.id; endDate = today; endError = ''; }}>{t('work_model.end')}</Button>
									</div>
								{/if}
							{/if}
						</CardContent>
					</Card>
				</li>
			{/each}
		</ul>

		{#if showForm}
			<Card data-testid="work-model-form-card">
				<CardHeader>
					<CardTitle>{editing ? t('work_model.edit_title', { range: range(editing) }) : t('work_model.new_title')}</CardTitle>
					<CardDescription>{editing ? t('work_model.edit_text') : t('work_model.new_text')}</CardDescription>
				</CardHeader>
				<CardContent>
					<form class="flex flex-col gap-5" onsubmit={submit} novalidate aria-label={editing ? t('work_model.edit') : t('work_model.new_title')}>
						{#if formError}<Alert variant="destructive" data-testid="work-model-form-error">{formError}</Alert>{/if}

						{#if editing}
							<fieldset class="flex flex-col gap-2" data-testid="mode-choice">
								<legend class="mb-1 text-sm font-medium">{t('work_model.mode_label')}</legend>
								<div class="grid gap-2 sm:grid-cols-2">
									<label class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
										<input type="radio" name="wm-mode" value="new" class="mt-1" checked={formMode === 'new'} onchange={() => setMode('new')} disabled={pending} data-testid="mode-new" />
										<span><span class="block font-medium">{t('work_model.mode_new')}</span><span class="block text-xs text-muted-foreground">{t('work_model.mode_new_text')}</span></span>
									</label>
									{#if canCorrect}
										<label class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-destructive has-[:checked]:bg-destructive/5">
											<input type="radio" name="wm-mode" value="correct" class="mt-1" checked={formMode === 'correct'} onchange={() => setMode('correct')} disabled={pending} data-testid="mode-correct" />
											<span><span class="block font-medium">{t('work_model.mode_correct')}</span><span class="block text-xs text-muted-foreground">{t('work_model.mode_correct_text')}</span></span>
										</label>
									{/if}
								</div>
								{#if !canCorrect}<p class="text-xs text-muted-foreground" data-testid="mode-unsupported">{t('work_model.mode_unsupported')}</p>{/if}
							</fieldset>
						{/if}

						{#if formMode === 'correct' && editing}
							<WorkModelCorrectionPanel from={form.validFrom && !errors.validFrom ? form.validFrom : editing.validFrom} to={form.validTo || null} status={previewStatus} {preview} message={previewMessage} bind:confirmed disabled={pending} />
						{/if}

						<WorkModelFields bind:form {errors} {pending} mode={formMode} />

						{#if prefilled && form.validFrom}
							<Alert data-testid="work-model-prefilled">{t('work_model.prefilled', { date: formatDateNumeric(form.validFrom) })}</Alert>
						{/if}
						{#if formMode === 'new' && form.validFrom && form.validFrom < today}
							<Alert variant="warning">{t('work_model.past_warning')}</Alert>
						{/if}
						<div class="flex flex-wrap gap-2">
							{#if formMode === 'correct'}
								<Button type="submit" variant="destructive" disabled={submitDisabled} data-testid="correct-submit">{t('work_model.correct_submit')}</Button>
							{:else}
								<Button type="submit" disabled={pending}>{t('work_model.create')}</Button>
							{/if}
							<Button type="button" variant="outline" onclick={closeForm} disabled={pending}>{t('common.cancel')}</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		{:else}
			<div><Button onclick={() => openForm()}>{t('work_model.new')}</Button></div>
		{/if}
	</div>
{/if}

<Toast message={toast} />
