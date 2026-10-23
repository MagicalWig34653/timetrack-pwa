<script lang="ts">
	import type { Place, PlanMode, PlanWeekDay } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';
	import { PLAN_MODES, planModeLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { type DayDraft, draftProblem, plannedSecondsOf } from '#lib/week/plan-draft.js';
	import { formatDuration } from '#lib/time/format.js';
	import { untrack } from 'svelte';

	/**
	 * Keyboard- and screen-reader-friendly way to add or edit a block of the week grid (the alternative to dragging):
	 * day, kind, place, start, end, break, note. Only collects and validates; the planner applies it to the drafts.
	 */
	let {
		days,
		seed,
		isNew,
		places,
		anchor = null,
		returnFocus = null,
		onsubmit,
		ondelete,
		onclose
	}: {
		days: PlanWeekDay[];
		seed: DayDraft;
		isNew: boolean;
		places: Place[];
		anchor?: DOMRect | null;
		returnFocus?: HTMLElement | null;
		onsubmit: (draft: DayDraft, fromDate: string) => void;
		ondelete?: (date: string) => void;
		onclose: () => void;
	} = $props();

	const fromDate = untrack(() => seed.date);
	let form = $state(untrack(() => ({ ...seed, breakMinutes: String(seed.breakMinutes), placeId: seed.placeId ?? '' })));
	let showErrors = $state(false);
	const timed = $derived(form.mode !== '' && form.mode !== 'off');
	const draft = $derived<DayDraft>({
		date: form.date,
		mode: form.mode,
		start: timed ? form.start : '',
		end: timed ? form.end : '',
		breakMinutes: timed ? Number(form.breakMinutes === '' ? 0 : form.breakMinutes) : 0,
		note: form.note,
		placeId: form.placeId === '' ? null : form.placeId
	});
	const problem = $derived(timed && form.start === '' && form.end === '' ? 'times_required' : draftProblem(draft));
	const planned = $derived(plannedSecondsOf(draft));

	function submit(event: Event) {
		event.preventDefault();
		if (problem) {
			showErrors = true;
			return;
		}
		onsubmit(draft, fromDate);
	}
</script>

<FloatingPanel titleId="bd-title" {anchor} {returnFocus} {onclose} data-testid="block-dialog">
	<form class="flex flex-col gap-4 p-5" onsubmit={submit} novalidate aria-labelledby="bd-title">
		<div>
			<h2 id="bd-title" class="text-lg leading-tight font-semibold">{isNew ? t('wg.dialog_new') : t('wg.dialog_edit')}</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">{t('wg.dialog_hint')}</p>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1.5">
				<Label for="bd-day">{t('wg.dialog_day')}</Label>
				<Select id="bd-day" bind:value={form.date} data-testid="bd-day">
					{#each days as day (day.date)}
						<option value={day.date} disabled={day.blockedBy !== null && day.date !== form.date}>{weekdayLabel(day.weekday)} {formatDateNumeric(day.date).slice(0, 6)}{day.blockedBy ? ` (${t(`weekview.mark.${day.blockedBy}`)})` : ''}</option>
					{/each}
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="bd-mode">{t('weekplan.mode')}</Label>
				<Select id="bd-mode" bind:value={form.mode} data-testid="bd-mode">
					{#each PLAN_MODES as option (option)}<option value={option}>{planModeLabel(option as PlanMode)}</option>{/each}
				</Select>
			</div>
		</div>

		{#if timed}
			<div class="grid grid-cols-3 gap-3">
				<Field id="bd-start" type="time" step="300" label={t('weekplan.start')} bind:value={form.start} aria-invalid={showErrors && problem ? 'true' : undefined} data-testid="bd-start" />
				<Field id="bd-end" type="time" step="300" label={t('weekplan.end')} bind:value={form.end} aria-invalid={showErrors && problem ? 'true' : undefined} data-testid="bd-end" />
				<Field id="bd-break" type="number" min="0" max="600" step="5" inputmode="numeric" label={t('weekplan.break')} bind:value={form.breakMinutes} data-testid="bd-break" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="bd-place">{t('plan.place')}</Label>
				<Select id="bd-place" bind:value={form.placeId}>
					<option value="">{t('timer.no_place')}</option>
					{#each places.filter((p) => !p.archived) as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
				</Select>
			</div>
			<p class="text-sm text-muted-foreground tabular-nums" data-testid="bd-planned">{planned !== null ? t('wg.dialog_planned', { time: formatDuration(planned) }) : ''}</p>
		{/if}
		<Field id="bd-note" label={t('weekplan.note')} bind:value={form.note} maxlength={200} />
		{#if showErrors && problem}<p class="text-sm text-destructive" role="alert" data-testid="bd-problem">{t(`weekplan.problem.${problem}`)}</p>{/if}

		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if !isNew && ondelete}<Button type="button" variant="destructive" class="mr-auto" onclick={() => ondelete(fromDate)} data-testid="bd-delete">{t('wg.menu_delete')}</Button>{/if}
			<Button type="button" variant="ghost" onclick={onclose}>{t('wg.cancel')}</Button>
			<Button type="submit" data-testid="bd-submit">{isNew ? t('wg.dialog_add') : t('wg.dialog_apply')}</Button>
		</div>
	</form>
</FloatingPanel>
