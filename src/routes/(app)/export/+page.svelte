<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { ExportFormat, WorktimeExportOptions } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { todayLocal } from '#lib/time/dates.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { fallbackExportName, monthRange, saveBlob, validateExportRange, yearRange } from '#lib/transfer/export.js';

	const today = todayLocal(zoneStore.value);
	const initial = monthRange(today, -1);
	let from = $state(initial.from);
	let to = $state(initial.to);
	let format = $state<ExportFormat>('xlsx');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let unavailable = $state(false);
	let rangeError = $state('');

	const formats: ExportFormat[] = ['xlsx', 'pdf', 'csv', 'worktime-xlsx'];

	// options of the worktime workbook (ADR-0013)
	let wtTimes = $state<'evaluated' | 'actual'>('evaluated');
	let wtPauseSource = $state<'auto' | 'override'>('auto');
	let wtPauseMinutes = $state('30');
	let wtStart = $state('08:00');
	let wtDateSystem = $state<'1900' | '1904'>('1900');
	let wtErrors = $state<{ pause?: string; start?: string }>({});

	function worktimeOptions(): WorktimeExportOptions | null {
		const errors: { pause?: string; start?: string } = {};
		const pause = Number(wtPauseMinutes.trim());
		if (wtPauseSource === 'override' && (!/^\d+$/.test(wtPauseMinutes.trim()) || pause > 240)) errors.pause = t('export.worktime_error_pause');
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(wtStart.trim())) errors.start = t('export.worktime_error_start');
		wtErrors = errors;
		if (errors.pause || errors.start) return null;
		return { times: wtTimes, standardStart: wtStart.trim(), dateSystem: wtDateSystem, ...(wtPauseSource === 'override' ? { pauseMinutes: pause } : {}) };
	}

	function preset(range: { from: string; to: string }) {
		from = range.from;
		to = range.to;
		rangeError = '';
	}

	async function run(event: Event) {
		event.preventDefault();
		if (busy) return;
		error = notice = rangeError = '';
		const problem = validateExportRange(from, to);
		if (problem) {
			rangeError = t(`export.error_${problem}` as MessageKey);
			return;
		}
		let options: WorktimeExportOptions = {};
		if (format === 'worktime-xlsx') {
			const parsed = worktimeOptions();
			if (!parsed) return;
			options = parsed;
		}
		busy = true;
		try {
			const file = await api.exportTime(from, to, format, options);
			const name = file.filename ?? fallbackExportName(from, to, format === 'worktime-xlsx' ? 'xlsx' : format);
			saveBlob(file.blob, name);
			notice = t('export.done', { name });
		} catch (e) {
			if (e instanceof ApiError && (e.status === 404 || e.status === 501)) unavailable = true;
			else error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={t('export.title')} description={t('export.description')} />

{#if unavailable}
	<Unavailable />
{:else}
	<div class="flex flex-col gap-6">
		{#if error}<Alert variant="destructive" data-testid="export-error">{error}</Alert>{/if}
		{#if notice}<Alert variant="success" data-testid="export-done">{notice}</Alert>{/if}

		<form class="flex flex-col gap-6" onsubmit={run} novalidate>
			<Card>
				<CardHeader><CardTitle>{t('export.period')}</CardTitle></CardHeader>
				<CardContent class="flex flex-col gap-4">
					<div class="flex flex-wrap gap-2" role="group" aria-label={t('export.shortcuts')}>
						<Button type="button" variant="outline" size="sm" onclick={() => preset(monthRange(today, 0))}>{t('export.this_month')}</Button>
						<Button type="button" variant="outline" size="sm" onclick={() => preset(monthRange(today, -1))}>{t('export.last_month')}</Button>
						<Button type="button" variant="outline" size="sm" onclick={() => preset(yearRange(today))}>{t('export.this_year')}</Button>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<Field id="export-from" type="date" label={t('export.from')} bind:value={from} required />
						<Field id="export-to" type="date" label={t('export.to')} bind:value={to} required error={rangeError} />
					</div>
					<p class="text-xs text-muted-foreground">{t('export.max_hint')}</p>
				</CardContent>
			</Card>

			<fieldset class="flex flex-col gap-2">
				<legend class="mb-1 font-medium">{t('export.format')}</legend>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each formats as option (option)}
						<label class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
							<input type="radio" class="mt-1 size-4 accent-primary" name="export-format" value={option} bind:group={format} />
							<span>
								<span class="block text-sm font-medium">{t(`export.format_${option}` as MessageKey)}</span>
								<span class="block text-xs text-muted-foreground">{t(`export.format_${option}_text` as MessageKey)}</span>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>

			{#if format === 'worktime-xlsx'}
				<section class="flex flex-col gap-4 rounded-lg border p-4" aria-labelledby="wt-export-heading" data-testid="export-worktime">
					<div>
						<h2 id="wt-export-heading" class="font-medium">{t('export.worktime_title')}</h2>
						<p class="mt-1 text-sm text-muted-foreground">{t('export.worktime_note')}</p>
					</div>
					<fieldset class="flex flex-col gap-2">
						<legend class="mb-1 text-sm font-medium">{t('export.worktime_times')}</legend>
						<label class="flex items-start gap-2 text-sm">
							<input type="radio" class="mt-0.5 size-4 accent-primary" name="wt-times" value="evaluated" bind:group={wtTimes} />
							<span>{t('export.worktime_times_evaluated')}<span class="block text-xs text-muted-foreground">{t('export.worktime_times_evaluated_text')}</span></span>
						</label>
						<label class="flex items-start gap-2 text-sm">
							<input type="radio" class="mt-0.5 size-4 accent-primary" name="wt-times" value="actual" bind:group={wtTimes} />
							<span>{t('export.worktime_times_actual')}<span class="block text-xs text-muted-foreground">{t('export.worktime_times_actual_text')}</span></span>
						</label>
					</fieldset>
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<Label for="wt-pause-source">{t('export.worktime_pause')}</Label>
							<Select id="wt-pause-source" bind:value={wtPauseSource}>
								<option value="auto">{t('export.worktime_pause_auto')}</option>
								<option value="override">{t('export.worktime_pause_override')}</option>
							</Select>
							<p class="text-xs text-muted-foreground">{t('export.worktime_pause_hint')}</p>
						</div>
						{#if wtPauseSource === 'override'}
							<Field id="wt-pause-minutes" type="number" inputmode="numeric" label={t('export.worktime_pause_minutes')} bind:value={wtPauseMinutes} error={wtErrors.pause} />
						{/if}
						<Field id="wt-start" type="time" label={t('export.worktime_start')} hint={t('export.worktime_start_hint')} bind:value={wtStart} error={wtErrors.start} />
						<div class="flex flex-col gap-1.5">
							<Label for="wt-date-system">{t('export.worktime_date_system')}</Label>
							<Select id="wt-date-system" bind:value={wtDateSystem}>
								<option value="1900">{t('export.worktime_date_1900')}</option>
								<option value="1904">{t('export.worktime_date_1904')}</option>
							</Select>
							<p class="text-xs text-muted-foreground">{t('export.worktime_date_hint')}</p>
						</div>
					</div>
				</section>
			{:else}
			<section class="rounded-lg border bg-muted/40 p-4 text-sm" aria-labelledby="columns-heading" data-testid="export-columns">
				<h2 id="columns-heading" class="font-medium">{t('export.columns_title')}</h2>
				<ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
					<li>{t('export.columns_actual')}</li>
					<li>{t('export.columns_evaluated')}</li>
					<li>{t('export.columns_target')}</li>
					<li>{t('export.columns_own')}</li>
				</ul>
			</section>
			{/if}

			<div><Button type="submit" disabled={busy}>{busy ? t('export.running') : t('export.run')}</Button></div>
		</form>
	</div>
{/if}
