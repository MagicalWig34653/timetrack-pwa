<script lang="ts">
	import { goto, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import type { PlanWeek, TimeWeekSummary } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import Toast from '#lib/components/app/Toast.svelte';
	import PlanRow from '#lib/components/week/PlanRow.svelte';
	import WeekNav from '#lib/components/week/WeekNav.svelte';
	import WeekSkeleton from '#lib/components/week/WeekSkeleton.svelte';
	import WeekTabs from '#lib/components/week/WeekTabs.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { addDays, isoWeekLabel, mondayOfIsoWeek, startOfWeek, todayLocal } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import {
		clearWeek,
		copyWeek,
		type DayDraft,
		draftFromDay,
		draftProblem,
		draftsEqual,
		fallbackWindow,
		sameForWorkdays,
		standardWeek,
		suggestWindow,
		weekRequest,
		weekTotals,
		withMode,
		type WindowSuggestion
	} from '#lib/week/plan-draft.js';
	import Copy from '@lucide/svelte/icons/copy';
	import Eraser from '@lucide/svelte/icons/eraser';
	import Equal from '@lucide/svelte/icons/equal';
	import Save from '@lucide/svelte/icons/save';
	import WandSparkles from '@lucide/svelte/icons/wand-sparkles';

	const timeZone = $derived(zoneStore.value);
	const today = $derived(todayLocal(timeZone));
	const currentMonday = $derived(startOfWeek(today));
	const requested = $derived(page.url.searchParams.get('week') ?? '');
	// Without ?week= the planner opens next week: planning is for weeks that have not started yet.
	const monday = $derived(mondayOfIsoWeek(requested) ?? addDays(currentMonday, 7));
	const isoWeek = $derived(isoWeekLabel(monday));

	let load = $state<LoadState>({ status: 'loading' });
	let week = $state<PlanWeek | null>(null);
	let drafts = $state<DayDraft[]>([]);
	let baseline = $state<DayDraft[]>([]);
	let suggestion = $state<WindowSuggestion>(fallbackWindow(27_720));
	let saving = $state(false);
	let saveError = $state('');
	let showProblems = $state(false);
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	const dirty = $derived(week !== null && !draftsEqual(drafts, baseline));
	const days = $derived(week?.days ?? []);
	const totals = $derived(weekTotals(days, drafts));
	const hasProblem = $derived(drafts.some((draft, index) => days[index]?.blockedBy === null && draftProblem(draft) !== null));
	const isPast = $derived(addDays(monday, 6) < today);
	const progress = $derived(totals.targetSeconds > 0 ? Math.min(100, Math.round((totals.plannedSeconds / totals.targetSeconds) * 100)) : totals.plannedSeconds > 0 ? 100 : 0);

	function showToast(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 4000);
	}

	/** Average start/end of the four completed weeks before the planned week (or before this week for future weeks). */
	async function loadSuggestion(reference: string, targetSeconds: number): Promise<WindowSuggestion> {
		const reach = reference < currentMonday ? reference : currentMonday;
		const results = await Promise.all(
			[1, 2, 3, 4].map((back) =>
				api.getTimeWeek(isoWeekLabel(addDays(reach, -7 * back))).then(
					(w) => w.summary as TimeWeekSummary,
					() => null
				)
			)
		);
		return suggestWindow(results.filter((s): s is TimeWeekSummary => s !== null), targetSeconds);
	}

	async function fetchWeek(target: string) {
		load = { status: 'loading' };
		saveError = '';
		showProblems = false;
		try {
			await zoneStore.ensure();
			const result = await api.getPlanWeek(target);
			const typical = Math.max(...result.days.map((d) => d.targetSeconds), 0);
			const suggested = await loadSuggestion(result.from, typical);
			if (target !== isoWeek) return;
			week = result;
			drafts = result.days.map(draftFromDay);
			baseline = result.days.map(draftFromDay);
			suggestion = suggested;
			load = { status: 'ready' };
		} catch (error) {
			if (target === isoWeek) load = toLoadState(error);
		}
	}

	$effect(() => {
		void fetchWeek(isoWeek);
	});

	// Leaving with unsaved changes asks first; a reload or tab close gets the browser's own prompt.
	beforeNavigate(({ cancel, willUnload }) => {
		if (!dirty) return;
		if (willUnload) cancel();
		else if (!window.confirm(t('weekplan.leave_confirm'))) cancel();
	});

	function setDraft(index: number, next: DayDraft) {
		drafts[index] = next;
	}
	function setMode(index: number, mode: DayDraft['mode']) {
		drafts[index] = withMode(drafts[index], mode, suggestion, days[index].targetSeconds);
	}

	function applyStandard() {
		drafts = standardWeek(days, drafts, suggestion);
	}
	function applySame() {
		drafts = sameForWorkdays(days, drafts);
	}
	function applyClear() {
		drafts = clearWeek(days, drafts);
	}
	async function applyCopy() {
		saveError = '';
		try {
			const previous = await api.getPlanWeek(isoWeekLabel(addDays(monday, -7)));
			if (previous.days.every((d) => d.plan === null)) {
				showToast(t('weekplan.copy_empty'));
				return;
			}
			drafts = copyWeek(previous, days, drafts);
		} catch (error) {
			saveError = errorMessage(error);
		}
	}
	function discard() {
		drafts = baseline.map((draft) => ({ ...draft }));
		showProblems = false;
		saveError = '';
	}

	async function save() {
		if (saving || !week) return;
		saveError = '';
		if (hasProblem) {
			showProblems = true;
			saveError = t('weekplan.fix_problems');
			return;
		}
		saving = true;
		try {
			const saved = await api.putPlanWeek(isoWeek, weekRequest(drafts));
			week = saved;
			drafts = saved.days.map(draftFromDay);
			baseline = saved.days.map(draftFromDay);
			showProblems = false;
			showToast(t('weekplan.saved'));
		} catch (error) {
			saveError = errorMessage(error);
		} finally {
			saving = false;
		}
	}

	const differenceText = $derived(
		totals.differenceSeconds === 0 ? t('weekplan.diff_equal') : t(totals.differenceSeconds < 0 ? 'weekplan.diff_under' : 'weekplan.diff_over', { time: formatDuration(Math.abs(totals.differenceSeconds)) })
	);
</script>

<PageHeader title={t('weekplan.title')} description={t('weekplan.description')}>
	{#snippet primary()}
		<span class="flex items-center gap-3">
			<span class="text-sm {dirty ? 'text-foreground' : 'text-muted-foreground'}" data-testid="plan-dirty" data-dirty={dirty}>{dirty ? t('weekplan.dirty') : t('weekplan.clean')}</span>
			<Button onclick={save} disabled={saving || !dirty} aria-busy={saving} data-testid="plan-save"><Save />{saving ? t('weekplan.saving') : t('weekplan.save')}</Button>
		</span>
	{/snippet}
</PageHeader>
<WeekTabs current="plan" week={isoWeek} />
<WeekNav {monday} {currentMonday} basePath="/plan" onpick={(picked) => goto(`/plan?week=${isoWeekLabel(picked)}`)} />

{#if load.status === 'loading'}
	<WeekSkeleton rows="rows" />
{:else if load.status === 'unavailable'}
	<Alert variant="warning" data-testid="plan-unavailable">{t('weekplan.unavailable')}</Alert>
{:else if load.status === 'error'}
	<Alert variant="destructive">
		<div class="flex flex-wrap items-center gap-3">
			<span>{load.message}</span>
			<Button size="sm" variant="outline" onclick={() => fetchWeek(isoWeek)}>{t('weekview.retry')}</Button>
		</div>
	</Alert>
{:else if week}
	<div class="flex flex-col gap-4" data-testid="week-planner" data-week={isoWeek}>
		{#if isPast}<Alert variant="warning">{t('weekplan.past_hint')}</Alert>{/if}
		{#if saveError}<Alert variant="destructive" data-testid="plan-error">{saveError}</Alert>{/if}

		<Panel data-testid="plan-total">
			<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
				<div class="min-w-0">
					<p class="text-[13px] font-medium text-muted-foreground">{t('weekplan.total_label')}</p>
					<p class="text-[22px] sm:text-[22px] sm:text-[28px] leading-tight font-semibold tracking-[-0.6px] tabular-nums" data-testid="plan-total-text">
						{t('weekplan.total_text', { planned: formatDuration(totals.plannedSeconds), target: formatDuration(totals.targetSeconds) })}
					</p>
				</div>
				<StatusChip tone={totals.differenceSeconds === 0 ? 'success' : totals.differenceSeconds < 0 ? 'warning' : 'accent'} dot={false}>
					<span data-testid="plan-diff">{differenceText}</span>
				</StatusChip>
			</div>
			<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div class="h-full rounded-full bg-ui-accent" style="width: {progress}%"></div></div>
			<p class="mt-3 text-[13px] text-muted-foreground" data-testid="plan-suggestion">
				{suggestion.source === 'history'
					? t('weekplan.suggestion_history', { start: suggestion.start, end: suggestion.end, break: suggestion.breakMinutes })
					: t('weekplan.suggestion_fallback', { start: suggestion.start, break: suggestion.breakMinutes })}
			</p>
		</Panel>

		<div class="flex flex-wrap gap-2" role="group" aria-label={t('weekplan.actions_label')}>
			<Button variant="outline" size="sm" onclick={applyStandard} data-testid="plan-standard"><WandSparkles />{t('weekplan.action_standard')}</Button>
			<Button variant="outline" size="sm" onclick={applyCopy} data-testid="plan-copy"><Copy />{t('weekplan.action_copy')}</Button>
			<Button variant="outline" size="sm" onclick={applySame} data-testid="plan-same"><Equal />{t('weekplan.action_same')}</Button>
			<Button variant="outline" size="sm" onclick={applyClear} data-testid="plan-clear"><Eraser />{t('weekplan.action_clear')}</Button>
			{#if dirty}<Button variant="ghost" size="sm" onclick={discard} data-testid="plan-discard">{t('weekplan.discard')}</Button>{/if}
		</div>

		<ul class="flex flex-col gap-2.5" data-testid="plan-rows">
			{#each days as day, index (day.date)}
				<PlanRow {day} draft={drafts[index]} {showProblems} onmode={(mode) => setMode(index, mode)} onchange={(next) => setDraft(index, next)} />
			{/each}
		</ul>
	</div>
{/if}

<Toast message={toast} />
