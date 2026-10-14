<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { ExportFormat } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
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

	const formats: ExportFormat[] = ['xlsx', 'pdf', 'csv'];

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
		busy = true;
		try {
			const file = await api.exportTime(from, to, format);
			const name = file.filename ?? fallbackExportName(from, to, format);
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
				<div class="grid gap-2 sm:grid-cols-3">
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

			<section class="rounded-lg border bg-muted/40 p-4 text-sm" aria-labelledby="columns-heading" data-testid="export-columns">
				<h2 id="columns-heading" class="font-medium">{t('export.columns_title')}</h2>
				<ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
					<li>{t('export.columns_actual')}</li>
					<li>{t('export.columns_evaluated')}</li>
					<li>{t('export.columns_target')}</li>
					<li>{t('export.columns_own')}</li>
				</ul>
			</section>

			<div><Button type="submit" disabled={busy}>{busy ? t('export.running') : t('export.run')}</Button></div>
		</form>
	</div>
{/if}
