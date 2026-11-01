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
	import { COMPANY_NAME_MAX, MAX_COMPANY_DAYS, SUGGESTED_COMPANY_DAYS, TREATMENTS, treatmentLabel, validateRows, withSuggested, type CompanyDayRow } from '#lib/planning/company-days.js';
	import type { CompanyDayTreatment } from '#lib/api/types.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';

	let { settings, year, onsaved }: { settings: VacationSettings; year: number; onsaved: (settings: VacationSettings) => void } = $props();

	// Initial values are read once (the page re-creates the form per year). Until settings are saved (`configured: false`) the server's
	// defaults are shown but never saved on their own. The carry-over field edits the selected year only; other years are kept.
	const initial = untrack(() => settings);
	const selectedYear = untrack(() => year);
	let suggested = $state(initial.configured === false);
	let region = $state(initial.region || SUGGESTED_SETTINGS.region);
	let entitlement = $state(halfDaysToInput(initial.annualEntitlementHalfDays));
	let carryOver = $state(halfDaysToInput(initial.carryOverByYear?.[String(selectedYear)] ?? 0));
	let expiry = $state(initial.carryOverExpiry ? formatDayMonth(initial.carryOverExpiry) : '');
	// Company days (contract 0.32.0): the suggested 24.12./31.12. keep a fixed date, further own rules are editable rows.
	const isSuggested = (month: number, day: number) => SUGGESTED_COMPANY_DAYS.some((d) => d.month === month && d.day === day);
	const initialDays = withSuggested(initial.companyDays);
	let fixedRows = $state(initialDays.filter((d) => isSuggested(d.month, d.day)).map((d) => ({ month: d.month, day: d.day, name: d.name ?? '', treatment: d.treatment as CompanyDayTreatment })));
	let ownRows = $state<(CompanyDayRow & { key: number })[]>(initialDays.filter((d) => !isSuggested(d.month, d.day)).map((d, key) => ({ key, date: `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.`, treatment: d.treatment, name: d.name ?? '' })));
	let nextKey = untrack(() => ownRows.length);
	let rowErrors = $state<Record<number, string>>({});
	let listError = $state('');
	const fixedLabel = (row: { month: number; day: number; name: string }) => `${row.name || SUGGESTED_COMPANY_DAYS.find((d) => d.month === row.month && d.day === row.day)?.name} (${String(row.day).padStart(2, '0')}.${String(row.month).padStart(2, '0')}.)`;

	function addRule() {
		ownRows = [...ownRows, { key: nextKey++, date: '', treatment: 'full', name: '' }];
	}
	function removeRule(key: number) {
		ownRows = ownRows.filter((r) => r.key !== key);
		rowErrors = {};
		listError = '';
	}

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
		const company = validateRows([...fixedRows.map((r) => ({ date: `${r.day}.${r.month}.`, treatment: r.treatment, name: r.name })), ...ownRows]);
		// the fixed rows come first, so own row i has index fixedRows.length + i
		rowErrors = Object.fromEntries(Object.entries(company.errors).map(([i, message]) => [Number(i) - fixedRows.length, message]));
		listError = company.listError;
		if (Object.keys(next).length > 0 || annual === null || carry === null || Object.keys(company.errors).length > 0 || company.listError) return;
		pending = true;
		try {
			const carryOverByYear = { ...(settings.carryOverByYear ?? {}), [String(selectedYear)]: carry };
			const saved = await api.putVacationSettings({ region, annualEntitlementHalfDays: annual, carryOverByYear, carryOverExpiry: expiryValue, companyDays: company.days });
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
				<Field id="vs-carry" label={t('vacation.carry', { year: selectedYear })} hint={t('vacation.carry_hint', { year: selectedYear })} inputmode="decimal" bind:value={carryOver} error={errors.carryOver} disabled={pending} />
				<Field id="vs-expiry" label={t('vacation.expiry')} hint={t('vacation.expiry_hint')} placeholder="31.03." bind:value={expiry} error={errors.expiry} disabled={pending} />
			</div>
			<fieldset class="flex flex-col gap-3 rounded-lg border p-3" data-testid="company-days">
				<legend class="px-1 text-sm font-medium">{t('company.title')}</legend>
				<p class="text-xs text-muted-foreground">{t('company.text')}</p>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each fixedRows as row, index (row.month * 100 + row.day)}
						<div class="flex flex-col gap-1.5">
							<Label for="vs-company-{row.month}-{row.day}">{fixedLabel(row)}</Label>
							<Select id="vs-company-{row.month}-{row.day}" bind:value={fixedRows[index].treatment} disabled={pending} data-testid="company-{row.month}-{row.day}">
								{#each TREATMENTS as option (option)}<option value={option}>{treatmentLabel(option)}</option>{/each}
							</Select>
						</div>
					{/each}
				</div>
				<div class="flex flex-col gap-2" data-testid="company-own">
					<h3 class="text-sm font-medium">{t('company.own_title')}</h3>
					{#if ownRows.length === 0}<p class="text-xs text-muted-foreground">{t('company.own_empty')}</p>{/if}
					{#each ownRows as row, index (row.key)}
						<div class="grid items-start gap-2 sm:grid-cols-[7rem_1fr_9rem_auto]" data-testid="company-row">
							<Field id="vs-own-date-{row.key}" label={t('company.date')} placeholder="12.06." bind:value={ownRows[index].date} error={rowErrors[index]} disabled={pending} />
							<Field id="vs-own-name-{row.key}" label={t('company.name')} placeholder={t('company.name_placeholder')} maxlength={COMPANY_NAME_MAX} bind:value={ownRows[index].name} disabled={pending} />
							<div class="flex flex-col gap-1.5">
								<Label for="vs-own-treatment-{row.key}">{t('company.treatment_label', { name: row.name || row.date || t('company.name_placeholder') })}</Label>
								<Select id="vs-own-treatment-{row.key}" bind:value={ownRows[index].treatment} disabled={pending}>
									{#each TREATMENTS as option (option)}<option value={option}>{treatmentLabel(option)}</option>{/each}
								</Select>
							</div>
							<div class="sm:pt-[1.625rem]"><Button type="button" variant="outline" size="icon" disabled={pending} onclick={() => removeRule(row.key)} aria-label={t('company.remove', { name: row.name || row.date || t('company.name_placeholder') })} data-testid="company-remove"><Trash2 /></Button></div>
						</div>
					{/each}
					{#if listError}<p class="text-xs text-destructive" role="alert">{listError}</p>{/if}
					<div class="flex flex-wrap items-center gap-3">
						<Button type="button" variant="outline" size="sm" disabled={pending || fixedRows.length + ownRows.length >= MAX_COMPANY_DAYS} onclick={addRule} data-testid="company-add"><Plus />{t('company.add')}</Button>
						<span class="text-xs text-muted-foreground">{t('company.limit', { max: MAX_COMPANY_DAYS })}</span>
					</div>
				</div>
			</fieldset>
			<div><Button type="submit" disabled={pending}>{t('common.save')}</Button></div>
		</form>
	</CardContent>
</Card>
