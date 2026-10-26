<script lang="ts">
	import type { Absence, VacationBalance, VacationSettings } from '#lib/api/types.js';
	import { splitPlanned } from '#lib/vacation/breakdown.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDayMonth } from '#lib/planning/calendar.js';
	import { SUGGESTED_SETTINGS } from '#lib/planning/regions.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatHalfDays, formatHalfDaysSigned } from '#lib/vacation/halfdays.js';

	let { balance, settings = null, absences = null }: { balance: VacationBalance; settings?: VacationSettings | null; /** Vacation absences of the year; splits "planned" into requested and not-yet-submitted. */ absences?: Absence[] | null } = $props();
	const split = $derived(absences ? splitPlanned(balance, absences) : null);

	const snapshot = $derived(balance.snapshotDate ?? null);
	const snapshotRemaining = $derived(balance.snapshotRemainingHalfDays ?? 0);
	// With a snapshot the contract reports entitlement and carry-over as 0 (the stored remaining days replace them); the stored
	// settings are still shown so the user sees what is saved. Without saved settings and without a snapshot nothing is configured.
	const notConfigured = $derived(settings?.configured === false && !snapshot);
	const entitlement = $derived(snapshot ? (settings?.annualEntitlementHalfDays ?? 0) : balance.entitlementHalfDays);
	const carryOver = $derived(snapshot ? (settings?.carryOverByYear?.[String(balance.year)] ?? 0) : balance.carryOverHalfDays);
	const tiles = $derived([
		{ key: 'entitlement', label: t('vacation.row_entitlement'), value: formatHalfDays(entitlement), text: snapshot ? t('vacation.tile_replaced') : t('vacation.tile_entitlement') },
		{ key: 'carry', label: t('vacation.tile_carry'), value: formatHalfDays(carryOver), text: snapshot ? t('vacation.tile_replaced') : t('vacation.tile_carry_text') },
		{ key: 'adjustments', label: t('vacation.row_adjustments'), value: formatHalfDaysSigned(balance.adjustmentHalfDays), text: t('vacation.tile_adjustments') },
		...(snapshot
			? [{ key: 'snapshot', label: t('vacation.tile_snapshot'), value: formatHalfDays(snapshotRemaining), text: t('vacation.tile_snapshot_text', { date: formatDateNumeric(snapshot) }) }]
			: []),
		{ key: 'booked', label: t('vacation.tile_booked'), value: formatHalfDays(balance.bookedHalfDays), text: t('vacation.tile_booked_text') },
		...(split
			? [
					{ key: 'requested', label: t('vacation.tile_requested'), value: formatHalfDays(split.requestedHalfDays), text: t('vacation.tile_requested_text') },
					{ key: 'planned', label: t('vacation.tile_planned_unsubmitted'), value: formatHalfDays(split.unsubmittedHalfDays), text: t('vacation.tile_planned_unsubmitted_text') }
				]
			: [{ key: 'planned', label: t('vacation.tile_planned'), value: formatHalfDays(balance.plannedHalfDays), text: t('vacation.tile_planned_text') }])
	]);
	const expiryNote = $derived(
		settings?.carryOverExpiry && balance.carryOverHalfDays > 0
			? t('vacation.expiry_note', { days: formatHalfDays(balance.carryOverHalfDays), date: formatDayMonth(settings.carryOverExpiry) })
			: ''
	);

	/** One click from the summary to the saved values: scroll to the settings form and focus the entitlement field. */
	function openSettings(event: Event) {
		event.preventDefault();
		const form = document.getElementById('vacation-settings');
		form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		document.getElementById('vs-entitlement')?.focus({ preventScroll: true });
	}
</script>

{#if notConfigured}
	<Card data-testid="vacation-cta" class="border-2 border-dashed border-primary/50">
		<CardHeader>
			<CardTitle>{t('vacation.cta_title', { year: balance.year })}</CardTitle>
			<CardDescription>{t('vacation.cta_text', { days: formatHalfDays(SUGGESTED_SETTINGS.annualEntitlementHalfDays) })}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-wrap items-center gap-3">
			<Button href="#vacation-settings" onclick={openSettings} data-testid="vacation-cta-action">{t('vacation.cta_action')}</Button>
			<span class="text-sm text-muted-foreground">{t('vacation.cta_hint')}</span>
		</CardContent>
	</Card>
{/if}
{#if !notConfigured || balance.entitlementHalfDays > 0 || balance.bookedHalfDays > 0 || balance.plannedHalfDays > 0 || balance.adjustmentHalfDays !== 0}
	<Card data-testid="vacation-balance">
		<CardHeader>
			<CardTitle class="flex flex-wrap items-center justify-between gap-2">
				<span>{t('vacation.summary_title', { year: balance.year })}</span>
				<Button href="#vacation-settings" onclick={openSettings} variant="outline" size="sm" data-testid="vacation-edit-settings">{t('vacation.edit_settings')}</Button>
			</CardTitle>
			<CardDescription>{notConfigured ? t('vacation.balance_suggested') : snapshot ? t('vacation.balance_with_snapshot') : t('vacation.balance_formula')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-5">
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<p class="text-sm text-muted-foreground">{t('vacation.available')}</p>
					<p class="text-4xl font-semibold tabular-nums {balance.availableHalfDays < 0 ? 'text-destructive' : ''}" data-testid="balance-available">{formatHalfDays(balance.availableHalfDays)}</p>
					<p class="mt-1 text-xs text-muted-foreground">{t('vacation.available_text')}</p>
				</div>
				<div>
					<p class="text-sm text-muted-foreground">{t('vacation.available_after_planned')}</p>
					<p class="text-4xl font-semibold tabular-nums {balance.availableAfterPlannedHalfDays < 0 ? 'text-destructive' : ''}" data-testid="balance-after-planned">{formatHalfDays(balance.availableAfterPlannedHalfDays)}</p>
					<p class="mt-1 text-xs text-muted-foreground">{t('vacation.after_planned_text', { planned: formatHalfDays(balance.plannedHalfDays) })}</p>
				</div>
			</div>

			<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="vacation-tiles">
				{#each tiles as tile (tile.key)}
					<div class="rounded-lg border bg-muted/30 px-3 py-2">
						<dt class="text-xs font-medium text-muted-foreground">{tile.label}</dt>
						<dd class="text-xl font-semibold tabular-nums" data-testid="balance-{tile.key}">{tile.value}</dd>
						<dd class="text-xs text-muted-foreground">{tile.text}</dd>
					</div>
				{/each}
			</dl>
			{#if expiryNote}<p class="text-sm text-muted-foreground" data-testid="expiry-note">{expiryNote}</p>{/if}
		</CardContent>
	</Card>
{/if}
