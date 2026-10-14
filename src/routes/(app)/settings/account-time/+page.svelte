<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { TimeAccount } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, isValidDate, todayLocal } from '#lib/time/dates.js';
	import { formatDelta, parseDuration } from '#lib/time/format.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let account = $state<TimeAccount | null>(null);
	let notice = $state('');

	let openingDate = $state('');
	let openingValue = $state('0:00');
	let openingReason = $state('Anfangsstand');
	let correctionDate = $state('');
	let correctionValue = $state('');
	let correctionReason = $state('');
	let openingErrors = $state<Record<string, string>>({});
	let correctionErrors = $state<Record<string, string>>({});
	let openingFormError = $state('');
	let correctionFormError = $state('');
	let pending = $state(false);

	async function refresh() {
		try {
			const zone = await zoneStore.ensure();
			account = await api.getTimeAccount();
			if (!openingDate) openingDate = todayLocal(zone);
			if (!correctionDate) correctionDate = todayLocal(zone);
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}
	onMount(refresh);

	function check(date: string, value: string, reason: string) {
		const errors: Record<string, string> = {};
		if (!isValidDate(date)) errors.date = t('account_time.error_date');
		const seconds = parseDuration(value);
		if (seconds === null) errors.value = t('account_time.error_value');
		if (!reason.trim()) errors.reason = t('segment_form.reason_required');
		return { errors, seconds };
	}

	async function submit(kind: 'opening' | 'correction', event: Event) {
		event.preventDefault();
		if (pending) return;
		const opening = kind === 'opening';
		const { errors, seconds } = opening
			? check(openingDate, openingValue, openingReason)
			: check(correctionDate, correctionValue, correctionReason);
		if (opening) {
			openingErrors = errors;
			openingFormError = '';
		} else {
			correctionErrors = errors;
			correctionFormError = '';
		}
		if (Object.keys(errors).length > 0 || seconds === null) return;
		pending = true;
		try {
			await api.createAccountAdjustment({
				kind,
				date: opening ? openingDate : correctionDate,
				seconds,
				reason: (opening ? openingReason : correctionReason).trim()
			});
			notice = opening ? t('account_time.opening_saved') : t('account_time.correction_saved');
			if (!opening) {
				correctionValue = '';
				correctionReason = '';
			}
			await refresh();
		} catch (e) {
			if (opening) openingFormError = errorMessage(e);
			else correctionFormError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('account_time.title')} description={t('account_time.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else if account}
	<div class="flex flex-col gap-4">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		<Card>
			<CardHeader>
				<CardTitle>{t('account_time.balance')}</CardTitle>
				<CardDescription>
					{account.accountStart ? t('account_time.since', { date: formatDateNumeric(account.accountStart) }) : t('account_time.no_start')}
					{#if account.provisional} · {t('home.balance_provisional')}{/if}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<dl class="grid grid-cols-3 gap-4 text-sm">
					<div><dt class="text-muted-foreground">{t('account_time.balance')}</dt><dd class="text-2xl font-semibold tabular-nums {account.balanceSeconds < 0 ? 'text-destructive' : ''}" data-testid="account-balance">{formatDelta(account.balanceSeconds)}</dd></div>
					<div><dt class="text-muted-foreground">{t('account_time.opening')}</dt><dd class="text-lg tabular-nums" data-testid="account-opening">{formatDelta(account.openingSeconds)}</dd></div>
					<div><dt class="text-muted-foreground">{t('account_time.corrections')}</dt><dd class="text-lg tabular-nums" data-testid="account-corrections">{formatDelta(account.adjustmentSeconds)}</dd></div>
				</dl>
			</CardContent>
		</Card>

		{#if !account.accountStart}
			<Card>
				<CardHeader>
					<CardTitle>{t('account_time.opening_title')}</CardTitle>
					<CardDescription>{t('account_time.opening_text')}</CardDescription>
				</CardHeader>
				<CardContent>
					<form class="flex flex-col gap-4" onsubmit={(e) => submit('opening', e)} novalidate aria-label={t('account_time.opening_title')}>
						{#if openingFormError}<Alert variant="destructive">{openingFormError}</Alert>{/if}
						<div class="grid gap-3 sm:grid-cols-2">
							<Field id="opening-date" type="date" label={t('account_time.start_date')} bind:value={openingDate} error={openingErrors.date} disabled={pending} />
							<Field id="opening-value" label={t('account_time.opening_value')} hint={t('account_time.value_hint')} inputmode="numeric" bind:value={openingValue} error={openingErrors.value} disabled={pending} />
						</div>
						<Field id="opening-reason" label={t('segment_form.reason')} bind:value={openingReason} error={openingErrors.reason} maxlength={200} disabled={pending} />
						<div><Button type="submit" disabled={pending}>{t('account_time.opening_save')}</Button></div>
					</form>
				</CardContent>
			</Card>
		{/if}

		<Card>
			<CardHeader>
				<CardTitle>{t('account_time.correction_title')}</CardTitle>
				<CardDescription>{t('account_time.correction_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="flex flex-col gap-4" onsubmit={(e) => submit('correction', e)} novalidate aria-label={t('account_time.correction_title')}>
					{#if correctionFormError}<Alert variant="destructive">{correctionFormError}</Alert>{/if}
					<div class="grid gap-3 sm:grid-cols-2">
						<Field id="correction-date" type="date" label={t('account_time.correction_date')} bind:value={correctionDate} error={correctionErrors.date} disabled={pending} />
						<Field id="correction-value" label={t('account_time.correction_value')} hint={t('account_time.value_hint')} inputmode="text" bind:value={correctionValue} error={correctionErrors.value} disabled={pending} />
					</div>
					<Field id="correction-reason" label={t('segment_form.reason')} bind:value={correctionReason} error={correctionErrors.reason} maxlength={200} disabled={pending} />
					<div><Button type="submit" disabled={pending}>{t('account_time.correction_save')}</Button></div>
				</form>
			</CardContent>
		</Card>
	</div>
{/if}
