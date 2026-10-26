<script lang="ts">
	import type { PlanMode, PlanWeekDay } from '#lib/api/types.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';
	import { PLAN_MODES, planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { type DayDraft, type DraftMode, draftProblem, plannedSecondsOf, STEP_MINUTES } from '#lib/week/plan-draft.js';
	import { MARK_CLASSES } from '#lib/week/overview.js';
	import HolidayBadge from './HolidayBadge.svelte';
	import MarkIcon from './MarkIcon.svelte';

	/** One day of the week planner: mode, start, end, break, note and the live planned hours. */
	let {
		day,
		draft,
		onmode,
		onchange,
		showProblems = false,
		holiday = null
	}: {
		/** name of a public, custom or company holiday on this day (calendar list); a half company day keeps the plan open */
		holiday?: { name: string; treatment: 'half' | 'full' | null } | null;
		day: PlanWeekDay;
		draft: DayDraft;
		onmode: (mode: DraftMode) => void;
		onchange: (next: DayDraft) => void;
		showProblems?: boolean;
	} = $props();

	const blocked = $derived(day.blockedBy !== null);
	// On phones an unplanned or blocked day shows only its mode; the rest would be disabled noise.
	const hideOnPhone = $derived(blocked || draft.mode === '' ? 'max-lg:hidden' : '');
	const times = $derived(draft.mode !== '' && draft.mode !== 'off');
	const problem = $derived(blocked ? null : draftProblem(draft));
	const planned = $derived(blocked ? 0 : plannedSecondsOf(draft));
	const id = (name: string) => `plan-${name}-${day.date}`;
	const label = 'text-xs text-muted-foreground lg:sr-only';
	const markFor = (block: NonNullable<PlanWeekDay['blockedBy']>) => (block === 'holiday' ? 'holiday' : block);
</script>

<li
	class="rounded-[10px] border bg-card p-3 shadow-[var(--shadow-card)] {blocked ? 'bg-muted/40' : ''}"
	data-testid="plan-row-{day.date}"
	data-blocked={day.blockedBy ?? undefined}
	aria-label={t('weekplan.row_label', { date: `${weekdayLabel(day.weekday)} ${formatDateNumeric(day.date)}` })}
>
	<div class="grid gap-x-3 gap-y-2.5 grid-cols-2 lg:grid-cols-[6.5rem_10rem_8rem_8rem_5rem_4rem_minmax(0,1fr)] lg:items-center">
		<div class="col-span-2 flex items-baseline gap-2 lg:col-span-1 lg:block">
			<p class="text-sm font-semibold">{weekdayLabel(day.weekday)} <span class="font-normal text-muted-foreground tabular-nums">{formatDateNumeric(day.date).slice(0, 6)}</span></p>
			<p class="text-xs text-muted-foreground tabular-nums">{t('weekplan.day_target', { time: timeDisplay.duration(day.targetSeconds) })}</p>
		</div>

		<div class="col-span-2 flex flex-col gap-1 lg:col-span-1">
			<label class={label} for={id('mode')}>{t('weekplan.mode')}</label>
			<Select id={id('mode')} value={draft.mode} disabled={blocked} onchange={(e) => onmode(e.currentTarget.value as DraftMode)}>
				<option value="">{t('weekplan.mode_none')}</option>
				{#each PLAN_MODES as option (option)}<option value={option}>{planModeLabel(option as PlanMode)}</option>{/each}
			</Select>
		</div>

		<div class="{hideOnPhone} flex flex-col gap-1">
			<label class={label} for={id('start')}>{t('weekplan.start')}</label>
			<Input
				id={id('start')}
				type="time"
				step={STEP_MINUTES * 60}
				value={draft.start}
				disabled={blocked || !times}
				aria-invalid={problem !== null && showProblems ? 'true' : undefined}
				oninput={(e) => onchange({ ...draft, start: e.currentTarget.value })}
			/>
		</div>
		<div class="{hideOnPhone} flex flex-col gap-1">
			<label class={label} for={id('end')}>{t('weekplan.end')}</label>
			<Input
				id={id('end')}
				type="time"
				step={STEP_MINUTES * 60}
				value={draft.end}
				disabled={blocked || !times}
				aria-invalid={problem !== null && showProblems ? 'true' : undefined}
				oninput={(e) => onchange({ ...draft, end: e.currentTarget.value })}
			/>
		</div>
		<div class="{hideOnPhone} flex flex-col gap-1">
			<label class={label} for={id('break')}>{t('weekplan.break')}</label>
			<Input
				id={id('break')}
				type="number"
				min="0"
				max="600"
				step="5"
				inputmode="numeric"
				value={draft.breakMinutes}
				disabled={blocked || !times}
				oninput={(e) => onchange({ ...draft, breakMinutes: e.currentTarget.value === '' ? 0 : Math.round(Number(e.currentTarget.value)) })}
			/>
		</div>

		<div class="{hideOnPhone} flex flex-col gap-1">
			<span class={label}>{t('weekplan.planned_hours')}</span>
			<p class="flex h-10 items-center text-[17px] font-semibold tabular-nums {planned ? '' : 'text-muted-foreground'}" data-testid="plan-hours-{day.date}" aria-label="{t('weekplan.planned_hours')} {planned ? timeDisplay.duration(planned) : '0:00'}">
				{planned ? timeDisplay.duration(planned) : '–'}
			</p>
		</div>

		<div class="{hideOnPhone} col-span-2 flex flex-col gap-1 lg:col-span-1">
			<label class={label} for={id('note')}>{t('weekplan.note')}</label>
			<Input id={id('note')} value={draft.note} maxlength={200} placeholder={t('weekplan.note')} disabled={blocked || draft.mode === ''} oninput={(e) => onchange({ ...draft, note: e.currentTarget.value })} />
		</div>
	</div>

	{#if blocked && day.blockedBy}
		<p class="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="plan-blocked-{day.date}">
			{#if day.blockedBy === 'holiday' && holiday}<HolidayBadge name={holiday.name} treatment={holiday.treatment} testid="plan-holiday-{day.date}" />{:else}<span class="inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium {MARK_CLASSES[markFor(day.blockedBy)]}"><MarkIcon mark={markFor(day.blockedBy)} class="size-3" />{t(`weekview.mark.${markFor(day.blockedBy)}`)}</span>{/if}
			<span class="text-muted-foreground">{t(`weekplan.blocked.${day.blockedBy}`)}{#if day.plan} {t('weekplan.blocked_plan_kept')}{/if}</span>
		</p>
	{:else if holiday}
		<p class="mt-2 flex flex-wrap items-center gap-2 text-sm"><HolidayBadge name={holiday.name} treatment={holiday.treatment} testid="plan-holiday-{day.date}" /></p>
		{#if showProblems && problem}<p class="mt-2 text-sm text-destructive" role="alert" data-testid="plan-problem-{day.date}">{t(`weekplan.problem.${problem}`)}</p>{/if}
	{:else if showProblems && problem}
		<p class="mt-2 text-sm text-destructive" role="alert" data-testid="plan-problem-{day.date}">{t(`weekplan.problem.${problem}`)}</p>
	{/if}
</li>
