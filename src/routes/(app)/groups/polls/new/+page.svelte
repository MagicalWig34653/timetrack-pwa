<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { api } from '#lib/api/client.js';
	import type { PollChoiceMode, PollInput, PollKind, PollOptionInput } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { deadlineFromInput, isKnownZone } from '#lib/groups/format.js';
	import { freshLinks } from '#lib/groups/fresh-links.svelte.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { addDays, isValidDate, todayLocal } from '#lib/time/dates.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';

	let title = $state('');
	let description = $state('');
	let kind = $state<PollKind>('date');
	let choiceMode = $state<PollChoiceMode>('multi');
	let zone = $state('Europe/Berlin');
	let deadline = $state('');
	let hideResults = $state(false);
	let dates = $state<{ date: string; start: string; end: string }[]>([{ date: '', start: '', end: '' }]);
	let labels = $state<string[]>(['', '']);
	let errors = $state<{ title?: string; options?: string; deadline?: string; zone?: string }>({});
	let formError = $state('');
	let busy = $state(false);
	let optionList: HTMLElement | undefined = $state();

	onMount(async () => {
		zone = await zoneStore.ensure();
		dates[0].date = addDays(todayLocal(zone), 1);
	});

	function setKind(next: string) {
		kind = next as PollKind;
	}

	async function addRow() {
		if (kind === 'date') {
			const last = dates.at(-1);
			dates.push({ date: last && isValidDate(last.date) ? addDays(last.date, 1) : '', start: last?.start ?? '', end: last?.end ?? '' });
		} else labels.push('');
		await tick();
		const inputs = optionList?.querySelectorAll<HTMLInputElement>('input[data-first]');
		inputs?.[inputs.length - 1]?.focus();
	}

	function removeRow(index: number) {
		if (kind === 'date') dates.splice(index, 1);
		else labels.splice(index, 1);
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (busy) return;
		errors = {};
		formError = '';
		const options: PollOptionInput[] = [];
		if (kind === 'date') {
			for (const row of dates) {
				if (!row.date && !row.start && !row.end) continue;
				if (!isValidDate(row.date) || (row.end && !row.start) || (row.end && row.end <= row.start)) {
					errors.options = t('groups.error_dates');
					break;
				}
				options.push({ date: row.date, ...(row.start ? { startTime: row.start } : {}), ...(row.end ? { endTime: row.end } : {}) });
			}
		} else {
			for (const label of labels) if (label.trim()) options.push({ label: label.trim() });
		}
		if (!errors.options && options.length === 0) errors.options = t('groups.error_options_required');
		if (!errors.options && options.length > 50) errors.options = t('groups.error_options_max');
		if (!title.trim()) errors.title = t('groups.error_title_required');
		const trimmedZone = zone.trim();
		if (kind === 'date' && !isKnownZone(trimmedZone)) errors.zone = t('groups.error_zone');
		const deadlineIso = deadline ? deadlineFromInput(deadline, zone) : null;
		if (deadline && !deadlineIso) errors.deadline = t('groups.error_deadline');
		else if (deadlineIso && Date.parse(deadlineIso) <= Date.now()) errors.deadline = t('groups.error_deadline_past');
		if (errors.title || errors.options || errors.deadline || errors.zone) return;

		const input: PollInput = {
			title: title.trim(),
			kind,
			choiceMode,
			options,
			hideResults,
			...(description.trim() ? { description: description.trim() } : {}),
			...(kind === 'date' ? { timeZone: trimmedZone } : {}),
			...(deadlineIso ? { deadline: deadlineIso } : {})
		};
		busy = true;
		try {
			const poll = await api.createPoll(input);
			if (poll.id && poll.path) freshLinks.set(poll.id, poll.path);
			await goto(`/groups/polls/${poll.id}`);
		} catch (error) {
			formError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={t('groups.poll_new_title')} description={t('groups.poll_new_description')} />

<form class="flex max-w-3xl flex-col gap-6" onsubmit={submit} novalidate data-testid="poll-form">
	<Field id="poll-title" label={t('groups.field_title')} bind:value={title} maxlength={120} required error={errors.title} placeholder={t('groups.poll_title_placeholder')} />
	<div class="flex flex-col gap-1.5">
		<Label for="poll-description">{t('groups.field_description')}</Label>
		<Textarea id="poll-description" bind:value={description} maxlength={2000} rows={3} />
	</div>

	<div class="flex flex-wrap gap-x-8 gap-y-4">
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium" id="kind-label">{t('groups.field_kind')}</span>
			<Segmented items={[{ id: 'date', label: t('groups.kind_date'), testid: 'kind-date' }, { id: 'text', label: t('groups.kind_text'), testid: 'kind-text' }]} value={kind} label={t('groups.field_kind')} onchange={setKind} />
		</div>
		<div class="flex flex-col gap-1.5">
			<span class="text-sm font-medium">{t('groups.field_mode')}</span>
			<Segmented
				items={[{ id: 'multi', label: kind === 'date' ? t('groups.mode_multi_date') : t('groups.mode_multi_text'), testid: 'mode-multi' }, { id: 'single', label: t('groups.mode_single'), testid: 'mode-single' }]}
				value={choiceMode}
				label={t('groups.field_mode')}
				onchange={(id) => (choiceMode = id as PollChoiceMode)}
			/>
		</div>
	</div>

	<fieldset class="flex flex-col gap-3" bind:this={optionList}>
		<legend class="mb-1 text-sm font-medium">{kind === 'date' ? t('groups.options_dates') : t('groups.options_texts')}</legend>
		{#if kind === 'date'}
			{#each dates as row, index (index)}
				<div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" data-testid="date-row">
					<div class="col-span-2 flex flex-col gap-1 sm:col-span-1">
						<Label for="date-{index}" class="text-xs">{t('groups.field_date')}</Label>
						<Input id="date-{index}" type="date" bind:value={row.date} data-first />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="start-{index}" class="text-xs">{t('groups.field_start')}</Label>
						<Input id="start-{index}" type="time" bind:value={row.start} />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="end-{index}" class="text-xs">{t('groups.field_end')}</Label>
						<Input id="end-{index}" type="time" bind:value={row.end} />
					</div>
					<Button type="button" variant="ghost" size="icon" aria-label={t('groups.option_remove', { n: index + 1 })} disabled={dates.length <= 1} onclick={() => removeRow(index)} class="col-start-2 row-start-2 sm:col-start-4 sm:row-start-1"><X /></Button>
				</div>
			{/each}
		{:else}
			{#each labels as _label, index (index)}
				<div class="flex items-center gap-2" data-testid="text-row">
					<Input
						aria-label={t('groups.option_n', { n: index + 1 })}
						bind:value={labels[index]}
						maxlength={200}
						placeholder={t('groups.option_placeholder', { n: index + 1 })}
						data-first
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								void addRow();
							}
						}}
					/>
					<Button type="button" variant="ghost" size="icon" aria-label={t('groups.option_remove', { n: index + 1 })} disabled={labels.length <= 1} onclick={() => removeRow(index)}><X /></Button>
				</div>
			{/each}
		{/if}
		{#if errors.options}<p class="text-sm text-destructive" role="alert">{errors.options}</p>{/if}
		<div><Button type="button" variant="outline" size="sm" onclick={addRow} data-testid="add-option"><Plus />{kind === 'date' ? t('groups.add_date') : t('groups.add_option')}</Button></div>
	</fieldset>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="poll-deadline">{t('groups.field_deadline')}</Label>
			<Input id="poll-deadline" type="datetime-local" bind:value={deadline} aria-invalid={errors.deadline ? true : undefined} />
			<p class="text-xs text-muted-foreground">{t('groups.deadline_hint', { zone })}</p>
			{#if errors.deadline}<p class="text-xs text-destructive">{errors.deadline}</p>{/if}
		</div>
		{#if kind === 'date'}
			<Field id="poll-zone" label={t('groups.field_zone')} bind:value={zone} hint={t('groups.zone_hint')} error={errors.zone} autocomplete="off" />
		{/if}
	</div>

	<div class="flex items-start gap-3">
		<Switch id="poll-hide" bind:checked={hideResults} class="mt-0.5" />
		<div>
			<Label for="poll-hide">{t('groups.field_hide')}</Label>
			<p class="text-xs text-muted-foreground">{t('groups.hide_hint')}</p>
		</div>
	</div>

	{#if formError}<Alert variant="destructive" data-testid="form-error">{formError}</Alert>{/if}
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={busy}>{t('groups.poll_create')}</Button>
		<a href="/groups" class="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted">{t('common.cancel')}</a>
	</div>
</form>
