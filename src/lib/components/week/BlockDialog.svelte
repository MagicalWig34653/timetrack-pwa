<script lang="ts">
	import type { Place, PlanBlockKind, PlanMode, PlanWeekDay } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';
	import { BLOCK_KINDS, blockKindLabel, planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { type BlockId, parseBlockId } from '#lib/week/grid-edit.js';
	import { type DayDraft, type DraftBlock, MAX_BLOCKS, MAX_BREAK_MINUTES, MAX_NOTE_LENGTH, parseClock, validRanges } from '#lib/week/plan-draft.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { untrack } from 'svelte';

	/**
	 * Keyboard- and screen-reader-friendly way to add or edit one block of the week grid (the alternative to dragging):
	 * day, kind, start, end, place, note, and with block lists the day-level mode. On an older server (one window per day)
	 * the kind is the day's mode and the break is a number. `dayOnly` edits just the day (mode, note), for a plan without
	 * times. Only collects and validates; the planner applies the result to the drafts.
	 */
	let {
		days,
		drafts,
		multi,
		seed,
		editId,
		dayOnly = false,
		places,
		anchor = null,
		returnFocus = null,
		onsubmit,
		ondelete,
		onclose
	}: {
		days: PlanWeekDay[];
		drafts: DayDraft[];
		multi: boolean;
		seed: { date: string; block: DraftBlock; mode: PlanMode; breakMinutes: number; note: string };
		/** id of the block being edited, null for a new block */
		editId: BlockId | null;
		dayOnly?: boolean;
		places: Place[];
		anchor?: DOMRect | null;
		returnFocus?: HTMLElement | null;
		onsubmit: (input: { date: string; block: DraftBlock; mode: PlanMode; breakMinutes: number }) => void;
		ondelete?: () => void;
		onclose: () => void;
	} = $props();

	const isNew = $derived(editId === null && !dayOnly);
	const initial = untrack(() => seed);
	const startsAsDay = untrack(() => dayOnly);
	let form = $state({
		date: initial.date,
		kind: initial.block.kind as PlanBlockKind,
		start: startsAsDay ? '' : initial.block.start,
		end: startsAsDay ? '' : initial.block.end,
		placeId: initial.block.placeId ?? '',
		note: startsAsDay ? initial.note : initial.block.note,
		mode: initial.mode as PlanMode,
		breakMinutes: String(initial.breakMinutes)
	});
	let showErrors = $state(false);

	const kinds = $derived<PlanBlockKind[]>(multi ? BLOCK_KINDS : ['office', 'home', 'customer', 'school']);
	const dayModes: PlanMode[] = ['office', 'home', 'customer', 'school'];
	const block = $derived<DraftBlock>({ start: form.start, end: form.end, kind: form.kind, placeId: form.placeId === '' ? null : form.placeId, note: form.note });

	/** The other blocks of the chosen day (without the one being edited). */
	const siblings = $derived.by(() => {
		const day = drafts.find((d) => d.date === form.date);
		if (!day) return [];
		const own = editId && parseBlockId(editId).date === form.date ? parseBlockId(editId).index : -1;
		return day.blocks.filter((_, index) => index !== own);
	});
	const problem = $derived.by(() => {
		if (dayOnly) return null;
		const start = parseClock(form.start);
		const end = parseClock(form.end);
		if (start === null || end === null) return 'times_required' as const;
		if (end <= start) return 'end_before_start' as const;
		if (form.note.length > MAX_NOTE_LENGTH) return 'note_too_long' as const;
		if (multi) {
			if (siblings.length >= MAX_BLOCKS) return 'too_many_blocks' as const;
			if (validRanges(siblings).some((r) => r.start < end && start < r.end)) return 'blocks_overlap' as const;
			return null;
		}
		const pause = Number(form.breakMinutes === '' ? 0 : form.breakMinutes);
		if (!Number.isInteger(pause) || pause < 0 || pause > MAX_BREAK_MINUTES) return 'break_invalid' as const;
		return null;
	});
	const minutes = $derived.by(() => {
		const start = parseClock(form.start);
		const end = parseClock(form.end);
		if (start === null || end === null || end <= start) return null;
		return Math.max(0, end - start - (multi ? 0 : Math.max(0, Number(form.breakMinutes) || 0))) * 60;
	});

	function submit(event: Event) {
		event.preventDefault();
		if (problem) {
			showErrors = true;
			return;
		}
		const mode: PlanMode = dayOnly || multi ? form.mode : (form.kind as PlanMode);
		onsubmit({ date: form.date, block: { ...block, note: form.note }, mode, breakMinutes: multi ? 0 : Number(form.breakMinutes === '' ? 0 : form.breakMinutes) });
	}
</script>

<FloatingPanel titleId="bd-title" {anchor} {returnFocus} {onclose} data-testid="block-dialog">
	<form class="flex flex-col gap-4 p-5" onsubmit={submit} novalidate aria-labelledby="bd-title">
		<div>
			<h2 id="bd-title" class="text-lg leading-tight font-semibold">{dayOnly ? t('wg.dialog_day') : isNew ? t('wg.dialog_new') : t('wg.dialog_edit')}</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">{dayOnly ? t('wg.dialog_day_hint') : multi ? t('wg.dialog_hint_multi') : t('wg.dialog_hint')}</p>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1.5">
				<Label for="bd-day">{t('wg.dialog_day_label')}</Label>
				<Select id="bd-day" bind:value={form.date} disabled={dayOnly} data-testid="bd-day">
					{#each days as day (day.date)}
						<option value={day.date} disabled={day.blockedBy !== null && day.date !== form.date}>{weekdayLabel(day.weekday)} {formatDateNumeric(day.date).slice(0, 6)}{day.blockedBy ? ` (${t(`weekview.mark.${day.blockedBy}`)})` : ''}</option>
					{/each}
				</Select>
			</div>
			{#if dayOnly || multi}
				<div class="flex flex-col gap-1.5">
					<Label for="bd-daymode">{t('wg.dialog_day_mode')}</Label>
					<Select id="bd-daymode" bind:value={form.mode} data-testid="bd-daymode">
						{#each dayModes as option (option)}<option value={option}>{planModeLabel(option)}</option>{/each}
						{#if dayOnly}<option value="off">{planModeLabel('off')}</option>{/if}
					</Select>
				</div>
			{:else}
				<div class="flex flex-col gap-1.5">
					<Label for="bd-kind">{t('weekplan.mode')}</Label>
					<Select id="bd-kind" bind:value={form.kind} data-testid="bd-mode">
						{#each kinds as option (option)}<option value={option}>{blockKindLabel(option)}</option>{/each}
					</Select>
				</div>
			{/if}
		</div>

		{#if !dayOnly}
			{#if multi}
				<div class="flex flex-col gap-1.5">
					<Label for="bd-kind">{t('wg.dialog_kind')}</Label>
					<Select id="bd-kind" bind:value={form.kind} data-testid="bd-kind">
						{#each kinds as option (option)}<option value={option}>{blockKindLabel(option)}</option>{/each}
					</Select>
				</div>
			{/if}
			<div class="grid {multi ? 'grid-cols-2' : 'grid-cols-3'} gap-3">
				<Field id="bd-start" type="time" step="300" label={t('weekplan.start')} bind:value={form.start} aria-invalid={showErrors && problem ? 'true' : undefined} data-testid="bd-start" />
				<Field id="bd-end" type="time" step="300" label={t('weekplan.end')} bind:value={form.end} aria-invalid={showErrors && problem ? 'true' : undefined} data-testid="bd-end" />
				{#if !multi}<Field id="bd-break" type="number" min="0" max="600" step="5" inputmode="numeric" label={t('weekplan.break')} bind:value={form.breakMinutes} data-testid="bd-break" />{/if}
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="bd-place">{t('plan.place')}</Label>
				<Select id="bd-place" bind:value={form.placeId}>
					<option value="">{t('timer.no_place')}</option>
					{#each places.filter((p) => !p.archived) as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
				</Select>
			</div>
			<p class="text-sm text-muted-foreground tabular-nums" data-testid="bd-planned">{minutes !== null ? t('wg.dialog_planned', { time: timeDisplay.duration(minutes) }) : ''}</p>
		{/if}
		<Field id="bd-note" label={dayOnly ? t('wg.dialog_day_note') : t('weekplan.note')} bind:value={form.note} maxlength={MAX_NOTE_LENGTH} data-testid="bd-note" />
		{#if showErrors && problem}<p class="text-sm text-destructive" role="alert" data-testid="bd-problem">{t(`weekplan.problem.${problem}`)}</p>{/if}

		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if (!isNew || dayOnly) && ondelete}<Button type="button" variant="destructive" class="mr-auto" onclick={ondelete} data-testid="bd-delete">{dayOnly ? t('wg.dialog_delete_day') : t('wg.menu_delete')}</Button>{/if}
			<Button type="button" variant="ghost" onclick={onclose}>{t('wg.cancel')}</Button>
			<Button type="submit" data-testid="bd-submit">{isNew ? t('wg.dialog_add') : t('wg.dialog_apply')}</Button>
		</div>
	</form>
</FloatingPanel>
