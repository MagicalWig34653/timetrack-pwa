<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { VacationBalance } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { isValidDate } from '#lib/time/dates.js';
	import { parseDaysInput } from '#lib/vacation/halfdays.js';

	let { today, onsaved }: { today: string; onsaved: (balance: VacationBalance) => void } = $props();

	let snapshotDate = $state('');
	let snapshotDays = $state('');
	let adjustDate = $state('');
	let adjustDays = $state('');
	let adjustReason = $state('');
	let snapshotErrors = $state<Record<string, string>>({});
	let adjustErrors = $state<Record<string, string>>({});
	let snapshotError = $state('');
	let adjustError = $state('');
	let notice = $state('');
	let pending = $state(false);

	$effect(() => {
		if (!snapshotDate) snapshotDate = today;
		if (!adjustDate) adjustDate = today;
	});

	async function submitSnapshot(event: Event) {
		event.preventDefault();
		if (pending) return;
		snapshotError = '';
		notice = '';
		const next: Record<string, string> = {};
		const halfDays = parseDaysInput(snapshotDays);
		if (!isValidDate(snapshotDate)) next.date = t('vacation.error_date');
		if (halfDays === null) next.days = t('vacation.error_days');
		snapshotErrors = next;
		if (Object.keys(next).length > 0 || halfDays === null) return;
		pending = true;
		try {
			onsaved(await api.createVacationSnapshot({ date: snapshotDate, remainingHalfDays: halfDays }));
			notice = t('vacation.snapshot_saved');
			snapshotDays = '';
		} catch (e) {
			snapshotError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function submitAdjustment(event: Event) {
		event.preventDefault();
		if (pending) return;
		adjustError = '';
		notice = '';
		const next: Record<string, string> = {};
		const halfDays = parseDaysInput(adjustDays, { allowNegative: true });
		if (!isValidDate(adjustDate)) next.date = t('vacation.error_date');
		if (halfDays === null || halfDays === 0) next.days = t('vacation.error_adjust_days');
		if (!adjustReason.trim()) next.reason = t('segment_form.reason_required');
		adjustErrors = next;
		if (Object.keys(next).length > 0 || halfDays === null) return;
		pending = true;
		try {
			onsaved(await api.createVacationAdjustment({ date: adjustDate, halfDays, reason: adjustReason.trim() }));
			notice = t('vacation.adjustment_saved');
			adjustDays = '';
			adjustReason = '';
		} catch (e) {
			adjustError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

{#if notice}<Alert variant="success">{notice}</Alert>{/if}
<div class="grid gap-4 md:grid-cols-2">
	<Card>
		<CardHeader>
			<CardTitle>{t('vacation.snapshot_title')}</CardTitle>
			<CardDescription>{t('vacation.snapshot_text')}</CardDescription>
		</CardHeader>
		<CardContent>
			<form class="flex flex-col gap-4" onsubmit={submitSnapshot} novalidate aria-label={t('vacation.snapshot_title')}>
				{#if snapshotError}<Alert variant="destructive">{snapshotError}</Alert>{/if}
				<Field id="snap-date" type="date" label={t('vacation.snapshot_date')} bind:value={snapshotDate} error={snapshotErrors.date} disabled={pending} />
				<Field id="snap-days" label={t('vacation.snapshot_days')} hint={t('vacation.days_hint')} inputmode="decimal" bind:value={snapshotDays} error={snapshotErrors.days} disabled={pending} />
				<div><Button type="submit" disabled={pending}>{t('vacation.snapshot_save')}</Button></div>
			</form>
		</CardContent>
	</Card>
	<Card>
		<CardHeader>
			<CardTitle>{t('vacation.adjustment_title')}</CardTitle>
			<CardDescription>{t('vacation.adjustment_text')}</CardDescription>
		</CardHeader>
		<CardContent>
			<form class="flex flex-col gap-4" onsubmit={submitAdjustment} novalidate aria-label={t('vacation.adjustment_title')}>
				{#if adjustError}<Alert variant="destructive">{adjustError}</Alert>{/if}
				<Field id="adj-date" type="date" label={t('vacation.adjustment_date')} bind:value={adjustDate} error={adjustErrors.date} disabled={pending} />
				<Field id="adj-days" label={t('vacation.adjustment_days')} hint={t('vacation.adjustment_days_hint')} inputmode="decimal" bind:value={adjustDays} error={adjustErrors.days} disabled={pending} />
				<Field id="adj-reason" label={t('segment_form.reason')} bind:value={adjustReason} error={adjustErrors.reason} maxlength={200} disabled={pending} />
				<div><Button type="submit" disabled={pending}>{t('vacation.adjustment_save')}</Button></div>
			</form>
		</CardContent>
	</Card>
</div>
