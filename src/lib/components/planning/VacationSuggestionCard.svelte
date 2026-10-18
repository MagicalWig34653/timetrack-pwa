<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { VacationConflictType, VacationSuggestion } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, formatDateShort } from '#lib/time/dates.js';
	import { conflictLabel, formatDays, formatFactor, offDaysText, vacationBlocks, vacationDaysText } from '#lib/vacation/planner.js';
	import SuggestionTimeline from './SuggestionTimeline.svelte';
	import CalendarRange from '@lucide/svelte/icons/calendar-range';
	import PartyPopper from '@lucide/svelte/icons/party-popper';
	import School from '@lucide/svelte/icons/school';
	import TreePalm from '@lucide/svelte/icons/tree-palm';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	let { suggestion, ontaken }: { suggestion: VacationSuggestion; ontaken: (message: string, partial?: boolean) => void } = $props();

	let confirming = $state(false);
	let ackConflicts = $state(false);
	let ackBudget = $state(false);
	let pending = $state(false);
	let error = $state('');

	const KIND_ICON = { bridge: CalendarRange, holiday_cluster: PartyPopper, school_holiday_extension: School, long_break: TreePalm } as const;
	const Icon = $derived(KIND_ICON[suggestion.kind]);
	const range = $derived(
		suggestion.start.slice(0, 4) === suggestion.end.slice(0, 4)
			? t('planner.card_range', { start: formatDateShort(suggestion.start), end: `${formatDateShort(suggestion.end)}${suggestion.end.slice(0, 4)}` })
			: t('planner.card_range', { start: formatDateNumeric(suggestion.start), end: formatDateNumeric(suggestion.end) })
	);
	const blocks = $derived(vacationBlocks(suggestion));
	/** Conflicts grouped by type (a day can carry several). */
	const conflictGroups = $derived(
		(['school_day', 'absence', 'plan', 'already_vacation'] as VacationConflictType[])
			.map((type) => ({ type, dates: [...new Set(suggestion.conflicts.filter((c) => c.type === type).map((c) => c.date))].sort() }))
			.filter((group) => group.dates.length > 0)
	);
	const hasConflicts = $derived(conflictGroups.length > 0);
	const needsAck = $derived(hasConflicts);
	const ready = $derived((!needsAck || ackConflicts) && (suggestion.fitsBudget || ackBudget));
	const missing = $derived(Math.max(0, -suggestion.remainingAfter));

	function open() {
		error = '';
		ackConflicts = false;
		ackBudget = false;
		confirming = true;
	}

	async function takeOver() {
		if (pending || !ready) return;
		pending = true;
		error = '';
		let done = 0;
		try {
			for (const block of blocks) {
				await api.createAbsence({ kind: 'vacation', startDate: block.start, endDate: block.end, status: 'planned' });
				done += 1;
			}
			const first = blocks[0];
			const last = blocks[blocks.length - 1];
			ontaken(
				blocks.length === 1
					? t('planner.take_done_one', { start: formatDateNumeric(first.start), end: formatDateNumeric(first.end) })
					: t('planner.take_done', { count: blocks.length, start: formatDateNumeric(first.start), end: formatDateNumeric(last.end) })
			);
		} catch (e) {
			const reason = errorMessage(e);
			error = done > 0 ? t('planner.take_partial', { done, total: blocks.length, reason }) : reason;
			if (done > 0) ontaken(error, true);
		} finally {
			pending = false;
		}
	}
</script>

<Card data-testid="suggestion-card" data-id={suggestion.id} data-kind={suggestion.kind} data-conflicts={hasConflicts ? 'yes' : 'no'} class="gap-3 p-4 sm:p-5 {hasConflicts ? 'border-amber-500/60' : ''} {suggestion.fitsBudget ? '' : 'border-destructive/50'}">
	<div class="flex flex-wrap items-center gap-2">
		<Badge variant="secondary" data-testid="suggestion-kind"><Icon aria-hidden="true" />{t(`planner.kind.${suggestion.kind}`)}</Badge>
		<Badge data-testid="suggestion-factor">{t('planner.factor', { value: formatFactor(suggestion.efficiency) })}</Badge>
		{#if !suggestion.fitsBudget}
			<Badge variant="destructive" data-testid="suggestion-no-budget">{t('planner.no_budget')}</Badge>
		{/if}
	</div>

	<div>
		<h3 class="text-lg font-semibold" data-testid="suggestion-range">{range}</h3>
		<p class="text-base" data-testid="suggestion-summary">
			{t('planner.card_summary', { vacation: vacationDaysText(suggestion.vacationDaysNeeded), off: offDaysText(suggestion.totalDaysOff) })}
		</p>
	</div>

	{#if hasConflicts}
		<Alert variant="warning" data-testid="suggestion-conflicts" class="flex flex-col gap-1">
			<p class="flex items-center gap-2 font-medium"><TriangleAlert class="size-4 shrink-0" aria-hidden="true" />{t('planner.conflicts_title')}</p>
			<ul class="list-disc pl-6">
				{#each conflictGroups as group (group.type)}
					<li data-conflict-type={group.type}>
						<strong>{conflictLabel(group.type)}:</strong>
						{group.dates.map((date) => formatDateShort(date)).join(', ')}
					</li>
				{/each}
			</ul>
		</Alert>
	{/if}

	{#if !suggestion.fitsBudget}
		<Alert variant="destructive" data-testid="suggestion-budget-warning">
			{t('planner.no_budget_text', {
				needed: vacationDaysText(suggestion.vacationDaysNeeded),
				year: suggestion.start.slice(0, 4),
				available: formatDays(suggestion.remainingAfter + suggestion.vacationDaysNeeded)
			})}
		</Alert>
	{/if}

	<SuggestionTimeline {suggestion} />

	<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
		<div>
			<dt class="text-muted-foreground">{t('planner.vacation_dates')}</dt>
			<dd class="flex flex-wrap gap-1" data-testid="suggestion-vacation-dates">
				{#each suggestion.vacationDates as date (date)}
					<span class="rounded-md bg-primary/10 px-1.5 py-0.5 tabular-nums">{formatDateShort(date)}</span>
				{/each}
			</dd>
		</div>
		{#if suggestion.holidays.length > 0}
			<div>
				<dt class="text-muted-foreground">{t('planner.holidays')}</dt>
				<dd data-testid="suggestion-holidays">
					{suggestion.holidays.map((h) => `${h.name} (${formatDateShort(h.date)})`).join(', ')}
				</dd>
			</div>
		{/if}
		{#if suggestion.schoolHolidays.length > 0}
			<div>
				<dt class="text-muted-foreground">{t('planner.school_holidays')}</dt>
				<dd>{suggestion.schoolHolidays.map((s) => `${s.name} (${formatDateNumeric(s.startDate)} bis ${formatDateNumeric(s.endDate)})`).join(', ')}</dd>
			</div>
		{/if}
	</dl>

	<p class="text-sm text-muted-foreground" data-testid="suggestion-remaining">
		{suggestion.remainingAfter < 0
			? t('planner.remaining_after_negative', { remaining: formatDays(suggestion.remainingAfter) })
			: t('planner.remaining_after', { remaining: formatDays(suggestion.remainingAfter) })}
	</p>

	{#if !confirming}
		<div>
			<Button onclick={open} data-testid="take-over">{t('planner.take')}</Button>
		</div>
	{:else}
		<div class="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4" role="group" aria-label={t('planner.take_confirm_title')} data-testid="take-over-confirm">
			<p class="font-medium">{t('planner.take_confirm_title')}</p>
			<p class="text-sm">{blocks.length === 1 ? t('planner.take_confirm_text_one') : t('planner.take_confirm_text', { count: blocks.length })}</p>
			<ul class="list-disc pl-6 text-sm" data-testid="take-over-blocks">
				{#each blocks as block (block.start)}
					<li>{t('planner.take_block', { start: formatDateShort(block.start), end: `${formatDateShort(block.end)}${block.end.slice(0, 4)}`, days: vacationDaysText(block.dates.length) })}</li>
				{/each}
			</ul>
			<p class="text-sm text-muted-foreground">{t('planner.take_total', { days: vacationDaysText(suggestion.vacationDaysNeeded) })}</p>
			{#if needsAck}
				<div class="flex items-start gap-2">
					<Checkbox id={`ack-conflicts-${suggestion.id}`} bind:checked={ackConflicts} data-testid="ack-conflicts" class="mt-0.5" />
					<Label for={`ack-conflicts-${suggestion.id}`} class="font-normal">{t('planner.take_ack_conflicts')}</Label>
				</div>
			{/if}
			{#if !suggestion.fitsBudget}
				<div class="flex items-start gap-2">
					<Checkbox id={`ack-budget-${suggestion.id}`} bind:checked={ackBudget} data-testid="ack-budget" class="mt-0.5" />
					<Label for={`ack-budget-${suggestion.id}`} class="font-normal">{t('planner.take_ack_budget')} ({formatDays(missing)})</Label>
				</div>
			{/if}
			{#if error}<Alert variant="destructive" data-testid="take-over-error">{error}</Alert>{/if}
			<div class="flex flex-wrap gap-2">
				<Button onclick={takeOver} disabled={pending || !ready} data-testid="take-over-confirm-button">{pending ? t('planner.take_busy') : t('planner.take_confirm')}</Button>
				<Button variant="outline" onclick={() => (confirming = false)} disabled={pending}>{t('planner.take_cancel')}</Button>
			</div>
		</div>
	{/if}
</Card>
