<script lang="ts">
	import type { Place, PlanBlockKind, PlanMode, PlanWeekDay } from '#lib/api/types.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';
	import { BLOCK_KINDS, blockKindLabel, PLAN_MODES, planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { type DayDraft, type DraftBlock, type DraftMode, draftProblem, MAX_BLOCKS, newBlock, planHintsOfDay, plannedSecondsOf, spanOf, STEP_MINUTES } from '#lib/week/plan-draft.js';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { MARK_CLASSES } from '#lib/week/overview.js';
	import HolidayBadge from './HolidayBadge.svelte';
	import MarkIcon from './MarkIcon.svelte';

	/**
	 * One day of the week planner: day mode, the blocks (kind, start, end, place, note; contract 0.35.0) or on an older
	 * server one window with a break, the day note and the live planned hours.
	 */
	let {
		day,
		draft,
		multi = false,
		places = [],
		onmode,
		onchange,
		showProblems = false,
		holiday = null
	}: {
		/** block lists per day (contract 0.35.0) */
		multi?: boolean;
		places?: Place[];
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
	// legacy: the single window is the first block
	const first = $derived(draft.blocks[0]);
	function setWindow(patch: Partial<DraftBlock>) {
		const base = first ?? newBlock(0, 1, draft.mode === '' || draft.mode === 'off' ? 'office' : draft.mode);
		const next = { ...base, start: first ? first.start : '', end: first ? first.end : '', ...patch };
		onchange({ ...draft, blocks: next.start === '' && next.end === '' ? [] : [next] });
	}
	function setBlock(index: number, patch: Partial<DraftBlock>) {
		onchange({ ...draft, blocks: draft.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
	}
	function removeBlock(index: number) {
		onchange({ ...draft, blocks: draft.blocks.filter((_, i) => i !== index) });
	}
	function addBlock() {
		const span = spanOf(draft);
		const start = span ? Math.min(span.end + 60, 22 * 60) : 8 * 60;
		const kind: PlanBlockKind = draft.mode === '' || draft.mode === 'off' ? 'office' : draft.mode;
		onchange({ ...draft, blocks: [...draft.blocks, newBlock(start, Math.min(start + 240, 23 * 60 + 59), kind)] });
	}
	const hints = $derived(multi && !blocked ? planHintsOfDay(draft) : []);
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
	<div class="grid gap-x-3 gap-y-2.5 grid-cols-2 {multi ? 'lg:grid-cols-[6.5rem_10rem_5rem_minmax(0,1fr)]' : 'lg:grid-cols-[6.5rem_10rem_8rem_8rem_5rem_4rem_minmax(0,1fr)]'} lg:items-center">
		<div class="col-span-2 flex items-baseline gap-2 lg:col-span-1 lg:block">
			<p class="text-sm font-semibold">{weekdayLabel(day.weekday)} <span class="font-normal text-muted-foreground tabular-nums">{formatDateNumeric(day.date).slice(0, 6)}</span></p>
			<p class="text-xs text-muted-foreground tabular-nums">{t('weekplan.day_target', { time: timeDisplay.duration(day.targetSeconds) })}</p>
		</div>

		<div class="col-span-2 flex flex-col gap-1 lg:col-span-1">
			<label class={label} for={id('mode')}>{multi ? t('wg.dialog_day_mode') : t('weekplan.mode')}</label>
			<Select id={id('mode')} value={draft.mode} disabled={blocked} onchange={(e) => onmode(e.currentTarget.value as DraftMode)}>
				<option value="">{t('weekplan.mode_none')}</option>
				{#each PLAN_MODES as option (option)}<option value={option}>{planModeLabel(option as PlanMode)}</option>{/each}
			</Select>
		</div>

		{#if !multi}
		<div class="{hideOnPhone} flex flex-col gap-1">
			<label class={label} for={id('start')}>{t('weekplan.start')}</label>
			<Input
				id={id('start')}
				type="time"
				step={STEP_MINUTES * 60}
				value={first?.start ?? ''}
				disabled={blocked || !times}
				aria-invalid={problem !== null && showProblems ? 'true' : undefined}
				oninput={(e) => setWindow({ start: e.currentTarget.value })}
			/>
		</div>
		<div class="{hideOnPhone} flex flex-col gap-1">
			<label class={label} for={id('end')}>{t('weekplan.end')}</label>
			<Input
				id={id('end')}
				type="time"
				step={STEP_MINUTES * 60}
				value={first?.end ?? ''}
				disabled={blocked || !times}
				aria-invalid={problem !== null && showProblems ? 'true' : undefined}
				oninput={(e) => setWindow({ end: e.currentTarget.value })}
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

		{/if}

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

	{#if multi && times && !blocked}
		<div class="mt-3 flex flex-col gap-2" data-testid="plan-blocks-{day.date}">
			{#each draft.blocks as block, n (n)}
				<div class="grid grid-cols-2 items-end gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[9rem_8.5rem_8.5rem_minmax(0,1fr)_minmax(0,1.2fr)_auto]" data-testid="plan-block-{day.date}-{n}" data-kind={block.kind}>
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground" for={id(`kind-${n}`)}>{t('wg.dialog_kind')}</label>
						<Select id={id(`kind-${n}`)} value={block.kind} onchange={(e) => setBlock(n, { kind: e.currentTarget.value as PlanBlockKind })} data-testid="plan-kind-{day.date}-{n}">
							{#each BLOCK_KINDS as option (option)}<option value={option}>{blockKindLabel(option)}</option>{/each}
						</Select>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground" for={id(`start-${n}`)}>{t('weekplan.start')}</label>
						<Input id={id(`start-${n}`)} type="time" step={STEP_MINUTES * 60} value={block.start} aria-invalid={problem !== null && showProblems ? 'true' : undefined} oninput={(e) => setBlock(n, { start: e.currentTarget.value })} data-testid="plan-start-{day.date}-{n}" />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground" for={id(`end-${n}`)}>{t('weekplan.end')}</label>
						<Input id={id(`end-${n}`)} type="time" step={STEP_MINUTES * 60} value={block.end} aria-invalid={problem !== null && showProblems ? 'true' : undefined} oninput={(e) => setBlock(n, { end: e.currentTarget.value })} data-testid="plan-end-{day.date}-{n}" />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground" for={id(`place-${n}`)}>{t('plan.place')}</label>
						<Select id={id(`place-${n}`)} value={block.placeId ?? ''} onchange={(e) => setBlock(n, { placeId: e.currentTarget.value || null })}>
							<option value="">{t('timer.no_place')}</option>
							{#each places.filter((p) => !p.archived) as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
						</Select>
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground" for={id(`bnote-${n}`)}>{t('weekplan.note')}</label>
						<Input id={id(`bnote-${n}`)} value={block.note} maxlength={200} oninput={(e) => setBlock(n, { note: e.currentTarget.value })} />
					</div>
					<Button type="button" variant="ghost" size="icon" class="size-10" onclick={() => removeBlock(n)} aria-label={t('wg.list_remove_block', { n: n + 1 })} data-testid="plan-remove-{day.date}-{n}"><X /></Button>
				</div>
			{/each}
			<div class="flex flex-wrap items-center gap-3">
				<Button type="button" variant="outline" size="sm" onclick={addBlock} disabled={draft.blocks.length >= MAX_BLOCKS} data-testid="plan-addblock-{day.date}"><Plus />{t('wg.list_add_block')}</Button>
				<span class="text-xs text-muted-foreground tabular-nums" data-testid="plan-gaps-{day.date}">{t('wg.list_gaps_hint')}</span>
			</div>
		</div>
		{#if hints.length > 0}
			<ul class="mt-2 flex flex-col gap-1 text-[13px] text-muted-foreground" data-testid="plan-hints-{day.date}">
				{#each hints as hint (hint)}<li data-hint={hint}>{t(`plan.hint.${hint}` as 'plan.hint.planned_break_short', { day: weekdayLabel(day.weekday) })}</li>{/each}
			</ul>
		{/if}
	{/if}

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
