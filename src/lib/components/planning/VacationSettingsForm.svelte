<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { VacationSettings } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDayMonth, parseDayMonth } from '#lib/planning/calendar.js';
	import { REGIONS, SUGGESTED_SETTINGS } from '#lib/planning/regions.js';
	import { formatHalfDays, halfDaysToInput, parseDaysInput } from '#lib/vacation/halfdays.js';
	import { untrack } from 'svelte';

	let { settings, onsaved }: { settings: VacationSettings | null; onsaved: (settings: VacationSettings) => void } = $props();

	// Initial values are read once; with no stored settings the ADR-0005 defaults are prefilled but never saved on their own.
	const initial = untrack(() => settings);
	let suggested = $state(initial === null);
	let region = $state(initial?.region ?? SUGGESTED_SETTINGS.region);
	let entitlement = $state(halfDaysToInput(initial?.annualEntitlementHalfDays ?? SUGGESTED_SETTINGS.annualEntitlementHalfDays));
	let carryOver = $state(halfDaysToInput(initial?.carryOverHalfDays ?? 0));
	let expiry = $state(initial?.carryOverExpiry ? formatDayMonth(initial.carryOverExpiry) : '');
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	let notice = $state('');
	let pending = $state(false);

	const regionOptions = $derived(REGIONS.some((r) => r.code === region) ? REGIONS : [...REGIONS, { code: region, name: region }]);

	async function submit(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		notice = '';
		const next: Record<string, string> = {};
		const annual = parseDaysInput(entitlement);
		const carry = parseDaysInput(carryOver);
		const expiryValue = expiry.trim() ? parseDayMonth(expiry) : null;
		if (annual === null) next.entitlement = t('vacation.error_days');
		if (carry === null) next.carryOver = t('vacation.error_days');
		if (expiry.trim() && expiryValue === null) next.expiry = t('vacation.error_expiry');
		errors = next;
		if (Object.keys(next).length > 0 || annual === null || carry === null) return;
		pending = true;
		try {
			const saved = await api.putVacationSettings({ region, annualEntitlementHalfDays: annual, carryOverHalfDays: carry, carryOverExpiry: expiryValue });
			notice = t('vacation.settings_saved');
			suggested = false;
			onsaved(saved);
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>{t('vacation.settings_title')}</CardTitle>
		<CardDescription>{t('vacation.settings_text')}</CardDescription>
	</CardHeader>
	<CardContent>
		<form class="flex flex-col gap-4" onsubmit={submit} novalidate aria-label={t('vacation.settings_title')}>
			{#if suggested}
				<Alert variant="warning" data-testid="settings-suggestion">{t('vacation.settings_suggestion', { days: formatHalfDays(SUGGESTED_SETTINGS.annualEntitlementHalfDays) })}</Alert>
			{/if}
			{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}
			{#if notice}<Alert variant="success">{notice}</Alert>{/if}
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="vs-region">{t('vacation.region')}</Label>
					<Select id="vs-region" bind:value={region} disabled={pending}>
						{#each regionOptions as option (option.code)}<option value={option.code}>{option.name} ({option.code})</option>{/each}
					</Select>
					<p class="text-xs text-muted-foreground">{t('vacation.region_hint')}</p>
				</div>
				<Field id="vs-entitlement" label={t('vacation.entitlement')} hint={t('vacation.entitlement_hint')} inputmode="decimal" bind:value={entitlement} error={errors.entitlement} disabled={pending} />
				<Field id="vs-carry" label={t('vacation.carry')} hint={t('vacation.carry_hint')} inputmode="decimal" bind:value={carryOver} error={errors.carryOver} disabled={pending} />
				<Field id="vs-expiry" label={t('vacation.expiry')} hint={t('vacation.expiry_hint')} placeholder="31.03." bind:value={expiry} error={errors.expiry} disabled={pending} />
			</div>
			<div><Button type="submit" disabled={pending}>{t('common.save')}</Button></div>
		</form>
	</CardContent>
</Card>
