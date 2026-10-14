<script lang="ts">
	import type { VacationBalance, VacationSettings } from '#lib/api/types.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDayMonth } from '#lib/planning/calendar.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatHalfDays, formatHalfDaysSigned } from '#lib/vacation/halfdays.js';

	let { balance, settings = null }: { balance: VacationBalance; settings?: VacationSettings | null } = $props();

	const snapshot = $derived(balance.snapshotDate ?? null);
	// With a snapshot the contract reports entitlement and carry-over as replaced; the stored remaining days follow from
	// available = snapshot + adjustments - booked (ADR-0005).
	const snapshotRemaining = $derived(balance.availableHalfDays - balance.adjustmentHalfDays + balance.bookedHalfDays);
	const rows = $derived(
		snapshot
			? [
					{ key: 'snapshot', label: t('vacation.row_snapshot', { date: formatDateNumeric(snapshot) }), value: formatHalfDays(snapshotRemaining), text: t('vacation.text_snapshot') },
					{ key: 'adjustments', label: t('vacation.row_adjustments_since'), value: formatHalfDaysSigned(balance.adjustmentHalfDays), text: t('vacation.text_adjustments') },
					{ key: 'booked', label: t('vacation.row_booked_since'), value: formatHalfDays(-balance.bookedHalfDays), text: t('vacation.text_booked') }
				]
			: [
					{ key: 'entitlement', label: t('vacation.row_entitlement'), value: formatHalfDays(balance.entitlementHalfDays), text: t('vacation.text_entitlement') },
					{ key: 'carry', label: t('vacation.row_carry'), value: formatHalfDays(balance.carryOverHalfDays), text: t('vacation.text_carry') },
					{ key: 'adjustments', label: t('vacation.row_adjustments'), value: formatHalfDaysSigned(balance.adjustmentHalfDays), text: t('vacation.text_adjustments') },
					{ key: 'booked', label: t('vacation.row_booked'), value: formatHalfDays(-balance.bookedHalfDays), text: t('vacation.text_booked') }
				]
	);
	const expiryNote = $derived(
		settings?.carryOverExpiry && balance.carryOverHalfDays > 0
			? t('vacation.expiry_note', { days: formatHalfDays(balance.carryOverHalfDays), date: formatDayMonth(settings.carryOverExpiry) })
			: ''
	);
</script>

<Card data-testid="vacation-balance">
	<CardHeader>
		<CardTitle>{t('vacation.balance_title', { year: balance.year })}</CardTitle>
		<CardDescription>{snapshot ? t('vacation.balance_with_snapshot') : t('vacation.balance_formula')}</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-5">
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<p class="text-sm text-muted-foreground">{t('vacation.available')}</p>
				<p class="text-3xl font-semibold tabular-nums {balance.availableHalfDays < 0 ? 'text-destructive' : ''}" data-testid="balance-available">{formatHalfDays(balance.availableHalfDays)}</p>
				<p class="mt-1 text-xs text-muted-foreground">{t('vacation.available_text')}</p>
			</div>
			<div>
				<p class="text-sm text-muted-foreground">{t('vacation.available_after_planned')}</p>
				<p class="text-3xl font-semibold tabular-nums {balance.availableAfterPlannedHalfDays < 0 ? 'text-destructive' : ''}" data-testid="balance-after-planned">{formatHalfDays(balance.availableAfterPlannedHalfDays)}</p>
				<p class="mt-1 text-xs text-muted-foreground">{t('vacation.after_planned_text', { planned: formatHalfDays(balance.plannedHalfDays) })}</p>
			</div>
		</div>

		<dl class="divide-y rounded-lg border text-sm">
			{#each rows as row (row.key)}
				<div class="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
					<dt class="font-medium">{row.label}</dt>
					<dd class="tabular-nums sm:text-right" data-testid="balance-{row.key}">{row.value}</dd>
					<p class="text-xs text-muted-foreground sm:col-span-2">{row.text}</p>
				</div>
			{/each}
			<div class="grid gap-x-4 gap-y-0.5 bg-muted/40 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
				<dt class="font-medium">{t('vacation.row_planned')}</dt>
				<dd class="tabular-nums sm:text-right" data-testid="balance-planned">{formatHalfDays(balance.plannedHalfDays)}</dd>
				<p class="text-xs text-muted-foreground sm:col-span-2">{t('vacation.text_planned')}</p>
			</div>
		</dl>
		{#if expiryNote}<p class="text-sm text-muted-foreground" data-testid="expiry-note">{expiryNote}</p>{/if}
	</CardContent>
</Card>
