<script lang="ts">
	import { untrack } from 'svelte';
	import { api } from '#lib/api/client.js';
	import type { CalendarDayKind } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { isValidDate } from '#lib/time/dates.js';

	let { date, onsaved, oncancel }: { date: string; onsaved: () => void; oncancel: () => void } = $props();

	let kind = $state<CalendarDayKind>('holiday');
	let startDate = $state(untrack(() => date));
	let endDate = $state(untrack(() => date));
	let name = $state('');
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	let pending = $state(false);

	async function save(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		const next: Record<string, string> = {};
		if (!isValidDate(startDate)) next.startDate = t('absence.error_date');
		if (!isValidDate(endDate)) next.endDate = t('absence.error_date');
		else if (isValidDate(startDate) && endDate < startDate) next.endDate = t('absence.error_end_before_start');
		if (!name.trim()) next.name = t('custom_day.error_name');
		errors = next;
		if (Object.keys(next).length > 0) return;
		pending = true;
		try {
			await api.createCustomDay({ kind, startDate, endDate, name: name.trim() });
			onsaved();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<form class="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4" onsubmit={save} novalidate aria-label={t('custom_day.title')} data-testid="custom-day-form">
	<h3 class="font-medium">{t('custom_day.title')}</h3>
	<p class="text-xs text-muted-foreground">{t('custom_day.hint')}</p>
	{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="cd-kind">{t('custom_day.kind')}</Label>
			<Select id="cd-kind" bind:value={kind} disabled={pending}>
				<option value="holiday">{t('custom_day.kind_holiday')}</option>
				<option value="school_holiday">{t('custom_day.kind_school_holiday')}</option>
			</Select>
		</div>
		<Field id="cd-name" label={t('custom_day.name')} bind:value={name} error={errors.name} maxlength={80} disabled={pending} />
		<Field id="cd-start" type="date" label={t('absence.start')} bind:value={startDate} error={errors.startDate} disabled={pending} />
		<Field id="cd-end" type="date" label={t('absence.end')} bind:value={endDate} error={errors.endDate} disabled={pending} />
	</div>
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={pending}>{t('common.save')}</Button>
		<Button type="button" variant="outline" onclick={oncancel} disabled={pending}>{t('common.cancel')}</Button>
	</div>
</form>
