<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { WorkModel } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, todayLocal } from '#lib/time/dates.js';
	import { formatDuration, parseDuration } from '#lib/time/format.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import {
		buildWorkModelInput,
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
	let pending = $state(false);
	let showForm = $state(false);

	let endingId = $state<string | null>(null);
	let endDate = $state('');
	let endError = $state('');

	const newestFirst = $derived([...models].sort((a, b) => b.validFrom.localeCompare(a.validFrom)));
	const today = $derived(todayLocal(zoneStore.value));
	const dailyPreview = $derived.by(() => {
		const weekly = parseDuration(form.weeklyTarget);
		return weekly !== null && form.workdays.length > 0 ? Math.round(weekly / form.workdays.length) : null;
	});

	async function refresh() {
		try {
			await zoneStore.ensure();
			models = await api.listWorkModels();
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}
	onMount(refresh);

	function openForm() {
		const base = newestFirst[0];
		const from = todayLocal(zoneStore.value);
		form = base ? formFromModel(base, from) : defaultWorkModelForm(from, zoneStore.value);
		errors = {};
		formError = '';
		showForm = true;
	}

	function toggleWorkday(day: number, checked: boolean) {
		form.workdays = checked ? [...form.workdays, day] : form.workdays.filter((d) => d !== day);
	}

	async function create(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		const result = buildWorkModelInput(form);
		if ('errors' in result) {
			errors = result.errors;
			return;
		}
		errors = {};
		pending = true;
		try {
			await api.createWorkModel(result.input);
			showForm = false;
			notice = t('work_model.created');
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
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
							<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
								<div><dt class="text-muted-foreground">{t('work_model.weekly')}</dt><dd class="font-medium tabular-nums">{formatDuration(model.weeklyTargetSeconds)}</dd></div>
								<div><dt class="text-muted-foreground">{t('work_model.daily')}</dt><dd class="font-medium tabular-nums">{formatDuration(Math.round(model.weeklyTargetSeconds / Math.max(1, model.workdays.length)))}</dd></div>
								<div><dt class="text-muted-foreground">{t('work_model.workdays')}</dt><dd>{model.workdays.map(weekdayLabel).join(', ')}</dd></div>
								<div><dt class="text-muted-foreground">{t('work_model.rounding')}</dt><dd>{model.roundingEnabled === false ? t('common.off') : t('work_model.rounding_value', { minutes: model.roundingMinutes ?? 15 })}</dd></div>
								<div><dt class="text-muted-foreground">{t('work_model.travel')}</dt><dd>{model.travelCountsAsWork === false ? t('common.no') : t('common.yes')}</dd></div>
								<div><dt class="text-muted-foreground">{t('work_model.school')}</dt><dd class="tabular-nums">{t('work_model.school_value', { threshold: formatDuration(model.schoolFullDayThresholdSeconds ?? 10800), credit: model.schoolCreditSeconds == null ? t('work_model.credit_daily_target') : formatDuration(model.schoolCreditSeconds) })}</dd></div>
								<div><dt class="text-muted-foreground">{t('work_model.fixed_breaks')}</dt><dd class="tabular-nums">{(model.fixedBreaks ?? []).length === 0 ? t('common.none') : (model.fixedBreaks ?? []).map((b) => `${b.start}–${b.end}`).join(', ')}</dd></div>
								<div><dt class="text-muted-foreground">{t('work_model.day_boundary')}</dt><dd class="tabular-nums">{t('work_model.minutes', { minutes: model.dayBoundaryMinutes ?? 0 })}</dd></div>
							</dl>
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
			<Card>
				<CardHeader>
					<CardTitle>{t('work_model.new_title')}</CardTitle>
					<CardDescription>{t('work_model.new_text')}</CardDescription>
				</CardHeader>
				<CardContent>
					<form class="flex flex-col gap-5" onsubmit={create} novalidate aria-label={t('work_model.new_title')}>
						{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}
						<div class="grid gap-3 sm:grid-cols-2">
							<Field id="wm-from" type="date" label={t('work_model.valid_from')} hint={t('work_model.valid_from_hint')} bind:value={form.validFrom} error={errors.validFrom} disabled={pending} />
							<Field id="wm-zone" label={t('work_model.timezone')} bind:value={form.timezone} error={errors.timezone} disabled={pending} />
							<Field id="wm-weekly" label={t('work_model.weekly')} hint={dailyPreview === null ? t('work_model.weekly_hint') : t('work_model.daily_preview', { duration: formatDuration(dailyPreview) })} placeholder="38:30" inputmode="numeric" bind:value={form.weeklyTarget} error={errors.weeklyTarget} disabled={pending} />
							<Field id="wm-boundary" type="number" min="0" max="719" label={t('work_model.day_boundary_label')} hint={t('work_model.day_boundary_hint')} bind:value={form.dayBoundaryMinutes} error={errors.dayBoundaryMinutes} disabled={pending} />
						</div>

						<fieldset class="flex flex-col gap-2">
							<legend class="mb-1 text-sm font-medium">{t('work_model.workdays')}</legend>
							<div class="flex flex-wrap gap-x-4 gap-y-2">
								{#each [1, 2, 3, 4, 5, 6, 7] as day (day)}
									<div class="flex items-center gap-1.5">
										<Checkbox id="wm-day-{day}" checked={form.workdays.includes(day)} onchange={(e) => toggleWorkday(day, e.currentTarget.checked)} disabled={pending} />
										<Label for="wm-day-{day}">{weekdayLabel(day)}</Label>
									</div>
								{/each}
							</div>
							{#if errors.workdays}<p class="text-xs text-destructive">{errors.workdays}</p>{/if}
						</fieldset>

						<fieldset class="flex flex-col gap-3">
							<legend class="mb-1 text-sm font-medium">{t('work_model.rounding')}</legend>
							<div class="flex items-center gap-2">
								<Checkbox id="wm-rounding" bind:checked={form.roundingEnabled} disabled={pending} />
								<Label for="wm-rounding">{t('work_model.rounding_enabled')}</Label>
							</div>
							{#if form.roundingEnabled}
								<div class="max-w-xs">
									<Field id="wm-rounding-min" type="number" min="1" max="60" label={t('work_model.rounding_minutes')} hint={t('work_model.rounding_hint')} bind:value={form.roundingMinutes} error={errors.roundingMinutes} disabled={pending} />
								</div>
							{/if}
						</fieldset>

						<div class="flex items-center gap-2">
							<Checkbox id="wm-travel" bind:checked={form.travelCountsAsWork} disabled={pending} />
							<Label for="wm-travel">{t('work_model.travel_counts')}</Label>
						</div>

						<fieldset class="grid gap-3 sm:grid-cols-2">
							<legend class="mb-1 text-sm font-medium">{t('work_model.school')}</legend>
							<Field id="wm-school-threshold" label={t('work_model.school_threshold')} hint={t('work_model.school_threshold_hint')} placeholder="3:00" inputmode="numeric" bind:value={form.schoolThreshold} error={errors.schoolThreshold} disabled={pending} />
							<Field id="wm-school-credit" label={t('work_model.school_credit')} hint={t('work_model.school_credit_hint')} placeholder="7:42" inputmode="numeric" bind:value={form.schoolCredit} error={errors.schoolCredit} disabled={pending} />
						</fieldset>

						<fieldset class="flex flex-col gap-2">
							<legend class="mb-1 text-sm font-medium">{t('work_model.fixed_breaks')}</legend>
							<p class="text-xs text-muted-foreground">{t('work_model.fixed_breaks_hint')}</p>
							{#each form.fixedBreaks as item, index (index)}
								<div class="flex flex-wrap items-end gap-2">
									<div class="flex flex-col gap-1.5">
										<Label for="wm-break-start-{index}">{t('work_model.break_start')}</Label>
										<input id="wm-break-start-{index}" type="time" bind:value={item.start} disabled={pending} class="h-9 rounded-lg border border-input bg-transparent px-3 text-base md:text-sm dark:bg-input/30" />
									</div>
									<div class="flex flex-col gap-1.5">
										<Label for="wm-break-end-{index}">{t('work_model.break_end')}</Label>
										<input id="wm-break-end-{index}" type="time" bind:value={item.end} disabled={pending} class="h-9 rounded-lg border border-input bg-transparent px-3 text-base md:text-sm dark:bg-input/30" />
									</div>
									<Button type="button" variant="ghost" size="sm" onclick={() => (form.fixedBreaks = form.fixedBreaks.filter((_, i) => i !== index))}>{t('common.remove')}</Button>
								</div>
							{/each}
							{#if errors.fixedBreaks}<p class="text-xs text-destructive">{errors.fixedBreaks}</p>{/if}
							<div><Button type="button" variant="outline" size="sm" onclick={() => (form.fixedBreaks = [...form.fixedBreaks, { start: '12:00', end: '12:30' }])}>{t('work_model.add_break')}</Button></div>
						</fieldset>

						{#if form.validFrom && form.validFrom < today}
							<Alert variant="warning">{t('work_model.past_warning')}</Alert>
						{/if}
						<div class="flex flex-wrap gap-2">
							<Button type="submit" disabled={pending}>{t('work_model.create')}</Button>
							<Button type="button" variant="outline" onclick={() => (showForm = false)} disabled={pending}>{t('common.cancel')}</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		{:else}
			<div><Button onclick={openForm}>{t('work_model.new')}</Button></div>
		{/if}
	</div>
{/if}
