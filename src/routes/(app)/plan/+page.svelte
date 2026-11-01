<script lang="ts">
	import { goto, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import { capabilities } from '#lib/api/capabilities.svelte.js';
	import type { Place, PlanWeek, TimeWeekSummary } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import Toast from '#lib/components/app/Toast.svelte';
	import FollowWeeksDialog from '#lib/components/week/FollowWeeksDialog.svelte';
	import PlanRow from '#lib/components/week/PlanRow.svelte';
	import PlannerBoard from '#lib/components/week/PlannerBoard.svelte';
	import WeekNav from '#lib/components/week/WeekNav.svelte';
	import WeekSkeleton from '#lib/components/week/WeekSkeleton.svelte';
	import WeekTabs from '#lib/components/week/WeekTabs.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { addDays, isoWeekLabel, mondayOfIsoWeek, startOfWeek, todayLocal } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { followEntries } from '#lib/week/follow.js';
	import { DraftHistory } from '#lib/week/history.js';
	import { settleSave } from '#lib/week/save-merge.js';
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
	import CalendarRange from '@lucide/svelte/icons/calendar-range';
	import LayoutList from '@lucide/svelte/icons/layout-list';
	import Layers from '@lucide/svelte/icons/layers';
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

	// Block lists per day need API 0.35.0; older servers keep the single window with a break (P13, ADR-0031).
	const multi = $derived(capabilities.planBlocks);
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
	let places = $state<Place[]>([]);
	let followOpen = $state(false);
	let followBusy = $state(false);
	let followError = $state('');
	let followAnchor = $state<DOMRect | null>(null);
	let followTrigger = $state<HTMLElement | null>(null);

	// Grid (P11) or the form list of K1; the choice is remembered per browser, ?view= wins.
	const VIEW_KEY = 'tt.plan.view';
	function storedView(): 'grid' | 'list' {
		try {
			return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
		} catch {
			return 'grid';
		}
	}
	const initialQuery = page.url.searchParams.get('view');
	let view = $state<'grid' | 'list'>(initialQuery === 'list' || initialQuery === 'grid' ? initialQuery : storedView());
	function pickView(next: 'grid' | 'list') {
		view = next;
		try {
			localStorage.setItem(VIEW_KEY, next);
		} catch {
			/* optional */
		}
	}

	// Unsaved edits are undoable in memory; list edits and loads start a fresh history.
	const history = new DraftHistory();
	let historyTick = $state(0);
	const canUndo = $derived.by(() => (historyTick >= 0 ? history.canUndo : false));
	const canRedo = $derived.by(() => (historyTick >= 0 ? history.canRedo : false));
	const undoLabel = $derived.by(() => (historyTick >= 0 ? history.undoLabel : null));
	const redoLabel = $derived.by(() => (historyTick >= 0 ? history.redoLabel : null));
	function commit(label: string, next: DayDraft[]) {
		history.record(label, drafts, next);
		drafts = next;
		historyTick++;
	}
	function undo() {
		const step = history.undo();
		if (step) drafts = step.drafts;
		historyTick++;
		if (step) showToast(t('wg.undone', { label: step.label }));
	}
	function redo() {
		const step = history.redo();
		if (step) drafts = step.drafts;
		historyTick++;
		if (step) showToast(t('wg.redone', { label: step.label }));
	}

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
			await Promise.all([zoneStore.ensure(), capabilities.ensure()]);
			const result = await api.getPlanWeek(target);
			const typical = Math.max(...result.days.map((d) => d.targetSeconds), 0);
			const suggested = await loadSuggestion(result.from, typical);
			if (target !== isoWeek) return;
			week = result;
			drafts = result.days.map(draftFromDay);
			baseline = result.days.map(draftFromDay);
			suggestion = suggested;
			history.clear();
			historyTick++;
			load = { status: 'ready' };
		} catch (error) {
			if (target === isoWeek) load = toLoadState(error);
		}
	}

	$effect(() => {
		void fetchWeek(isoWeek);
	});
	// holiday names and company-day treatment of the shown week (contract 0.32.0); optional, the plan works without them
	let holidays = $state<Record<string, { name: string; treatment: 'half' | 'full' | null }>>({});
	$effect(() => {
		const days = week?.days;
		if (!days || days.length === 0) return;
		const years = [...new Set([days[0].date.slice(0, 4), days[days.length - 1].date.slice(0, 4)].map(Number))];
		let current = true;
		void Promise.all(years.map((y) => api.listHolidays(y).catch(() => [])))
			.then((lists) => {
				if (!current) return;
				const next: Record<string, { name: string; treatment: 'half' | 'full' | null }> = {};
				for (const entry of lists.flat()) {
					if (entry.kind !== 'holiday') continue;
					for (const day of days) if (day.date >= entry.startDate && day.date <= entry.endDate) next[day.date] = { name: entry.name, treatment: entry.companyTreatment ?? null };
				}
				holidays = next;
			})
			.catch(() => undefined);
		return () => (current = false);
	});
	$effect(() => {
		void api.listPlaces().then(
			(list) => (places = list),
			() => (places = [])
		);
	});

	// Leaving with unsaved changes asks first; a reload or tab close gets the browser's own prompt.
	beforeNavigate(({ cancel, willUnload }) => {
		if (!dirty) return;
		if (willUnload) cancel();
		else if (!window.confirm(t('weekplan.leave_confirm'))) cancel();
	});

	function setDraft(index: number, next: DayDraft) {
		drafts[index] = next;
		history.clear();
		historyTick++;
	}
	function setMode(index: number, mode: DayDraft['mode']) {
		drafts[index] = withMode(drafts[index], mode, suggestion, days[index].targetSeconds, multi);
		history.clear();
		historyTick++;
	}

	function applyStandard() {
		commit(t('weekplan.action_standard'), standardWeek(days, drafts, suggestion, multi));
	}
	function applySame() {
		commit(t('weekplan.action_same'), sameForWorkdays(days, drafts));
	}
	function applyClear() {
		commit(t('weekplan.action_clear'), clearWeek(days, drafts));
	}
	async function applyCopy() {
		saveError = '';
		try {
			const previous = await api.getPlanWeek(isoWeekLabel(addDays(monday, -7)));
			if (previous.days.every((d) => d.plan === null)) {
				showToast(t('weekplan.copy_empty'));
				return;
			}
			commit(t('weekplan.action_copy'), copyWeek(previous, days, drafts));
		} catch (error) {
			saveError = errorMessage(error);
		}
	}
	function discard() {
		commit(t('weekplan.discard'), baseline.map((draft) => ({ ...draft })));
		showProblems = false;
		saveError = '';
	}

	function openFollow(event: MouseEvent) {
		followTrigger = event.currentTarget as HTMLElement;
		followAnchor = followTrigger.getBoundingClientRect();
		followError = '';
		followOpen = true;
	}

	/** Writes the shown plan onto the next weeks; blocked days and (unless asked) existing plans stay as they are. */
	async function applyFollow(input: { weeks: number; overwrite: boolean }) {
		followBusy = true;
		followError = '';
		let written = 0;
		let skipped = 0;
		try {
			for (let n = 1; n <= input.weeks; n++) {
				const label = isoWeekLabel(addDays(monday, 7 * n));
				const target = await api.getPlanWeek(label);
				const plan = followEntries(drafts, target, input.overwrite, multi);
				skipped += plan.skippedBlocked + plan.skippedExisting;
				if (plan.entries.length === 0) continue;
				await api.putPlanWeek(label, { replace: false, days: plan.entries });
				written += plan.entries.length;
			}
			followOpen = false;
			showToast(t('wg.follow_done', { days: written, skipped }));
		} catch (error) {
			followError = errorMessage(error);
		} finally {
			followBusy = false;
		}
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
			const target = isoWeek;
			const sent = $state.snapshot(drafts) as DayDraft[];
			const saved = await api.putPlanWeek(target, weekRequest(sent, multi));
			// another week was opened meanwhile: its own load owns the state now
			if (target !== isoWeek) {
				showToast(t('weekplan.saved'));
				return;
			}
			// edits made while the request was in flight stay (and stay unsaved); only the server version moves
			const settled = settleSave(sent, $state.snapshot(drafts) as DayDraft[], saved.days.map(draftFromDay));
			week = saved;
			drafts = settled.drafts;
			baseline = settled.baseline;
			if (!settled.keepHistory) history.clear();
			historyTick++;
			showProblems = false;
			showToast(t('weekplan.saved'));
		} catch (error) {
			saveError = errorMessage(error);
		} finally {
			saving = false;
		}
	}

	// Save bar variants: side panel foot, grid view (sticky on phones/tablets, plain inside the bottom row on landscape desktops), list view (always sticky).
	const SAVE_BASE = 'flex flex-wrap items-center justify-end gap-3';
	const SAVE_SIDE = 'flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-lg border bg-background/95 p-2.5';
	const SAVE_STICKY = `${SAVE_BASE} sticky bottom-0 z-30 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:rounded-lg sm:border`;
	const SAVE_GRID = `${SAVE_STICKY} fit:static! fit:z-auto! fit:m-0! fit:ml-auto! fit:shrink-0 fit:flex-nowrap fit:rounded-none! fit:border-0! fit:bg-transparent! fit:p-0! fit:backdrop-blur-none!`;
	const SAVE_LIST = `${SAVE_STICKY} fit:shrink-0 fit:py-2`;
	const actionItems = $derived([
		{ testid: 'plan-standard', label: t('weekplan.action_standard'), icon: WandSparkles, run: applyStandard },
		{ testid: 'plan-copy', label: t('weekplan.action_copy'), icon: Copy, run: applyCopy },
		{ testid: 'plan-follow', label: t('wg.follow_action'), icon: Layers, run: openFollow },
		{ testid: 'plan-same', label: t('weekplan.action_same'), icon: Equal, run: applySame },
		{ testid: 'plan-clear', label: t('weekplan.action_clear'), icon: Eraser, run: applyClear }
	]);
	const differenceText = $derived(
		totals.differenceSeconds === 0 ? t('weekplan.diff_equal') : t(totals.differenceSeconds < 0 ? 'weekplan.diff_under' : 'weekplan.diff_over', { time: timeDisplay.duration(Math.abs(totals.differenceSeconds)) })
	);
</script>

<!-- U1: on landscape desktops the planner fills the viewport height (header row, grid with the remaining height, sticky save bar). -->
<div class="fit:flex fit:h-[calc(100dvh-60px-2rem)] fit:flex-col fit:gap-2" data-testid="plan-page">
<div class="fit:flex fit:shrink-0 fit:flex-wrap fit:items-center fit:gap-x-5 fit:gap-y-1">
	<PageHeader compact title={t('weekplan.title')} description={view === 'grid' ? undefined : t('weekplan.description')} />
	<WeekTabs compact current="plan" week={isoWeek} />
	<WeekNav compact {monday} {currentMonday} basePath="/plan" onpick={(picked) => goto(`/plan?week=${isoWeekLabel(picked)}`)} />
</div>

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
	{#snippet alerts(side: boolean)}
		{#if isPast}<Alert variant="warning" class={side ? 'text-[13px]' : ''}>{t('weekplan.past_hint')}</Alert>{/if}
		{#if saveError}<Alert variant="destructive" class={side ? 'text-[13px]' : ''} data-testid="plan-error">{saveError}</Alert>{/if}
	{/snippet}

	{#snippet actionButtons(side: boolean)}
		<div class="flex gap-2 {side ? 'flex-col items-stretch' : 'max-sm:flex-nowrap sm:flex-wrap'}" role="group" aria-label={t('weekplan.actions_label')}>
			{#each actionItems as item (item.testid)}
				<Button variant="outline" size="sm" class={side ? 'justify-start' : ''} onclick={item.run} title={item.label} data-testid={item.testid}><item.icon /><span class={side ? '' : 'fit:max-[1599px]:sr-only'}>{item.label}</span></Button>
			{/each}
		</div>
	{/snippet}

	{#snippet viewSwitch(side: boolean)}
		<Segmented
			class={side ? '' : 'ml-auto'}
			label={t('wg.view_label')}
			value={view}
			items={[
				{ id: 'grid', label: t('wg.view_grid'), icon: CalendarRange, testid: 'view-grid' },
				{ id: 'list', label: t('wg.view_list'), icon: LayoutList, testid: 'view-list' }
			]}
			onchange={(id) => pickView(id as 'grid' | 'list')}
		/>
	{/snippet}

	{#snippet suggestionText()}
		{suggestion.source === 'history'
			? t('weekplan.suggestion_history', { start: suggestion.start, end: suggestion.end, break: suggestion.breakMinutes })
			: t('weekplan.suggestion_fallback', { start: suggestion.start, break: suggestion.breakMinutes })}
	{/snippet}

	{#snippet overview(side: boolean)}
		{#if side}
			<!-- Side panel: week sum with progress and suggestion, the stacked actions and the view switch. -->
			<div class="flex flex-col gap-3" data-testid="plan-total">
				<div class="flex flex-col gap-2">
					<p class="text-[15px] leading-tight font-semibold tabular-nums" data-testid="plan-total-text">
						{t('weekplan.total_text', { planned: timeDisplay.duration(totals.plannedSeconds), target: timeDisplay.duration(totals.targetSeconds) })}
					</p>
					<div class="flex items-center gap-2">
						<StatusChip tone={totals.differenceSeconds === 0 ? 'success' : totals.differenceSeconds < 0 ? 'warning' : 'accent'} dot={false}>
							<span data-testid="plan-diff">{differenceText}</span>
						</StatusChip>
						<div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div class="h-full rounded-full bg-ui-accent" style="width: {progress}%"></div></div>
					</div>
					<p class="text-[13px] text-muted-foreground" data-testid="plan-suggestion">{@render suggestionText()}</p>
				</div>
				{@render actionButtons(true)}
				{@render viewSwitch(true)}
			</div>
		{:else}
			<!-- Grid view on landscape desktops: week sum, actions and the view switch share one row, so the grid keeps the height. -->
			<div class="flex flex-col gap-4 {view === 'grid' ? 'fit:flex-row fit:items-center fit:gap-4 fit:shrink-0' : ''}">
				{#if view === 'grid'}
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2 fit:shrink-0" data-testid="plan-total">
						<p class="text-[15px] font-semibold tabular-nums" data-testid="plan-total-text">
							{t('weekplan.total_text', { planned: timeDisplay.duration(totals.plannedSeconds), target: timeDisplay.duration(totals.targetSeconds) })}
						</p>
						<StatusChip tone={totals.differenceSeconds === 0 ? 'success' : totals.differenceSeconds < 0 ? 'warning' : 'accent'} dot={false}>
							<span data-testid="plan-diff">{differenceText}</span>
						</StatusChip>
						<div class="h-1.5 w-32 overflow-hidden rounded-full bg-muted max-sm:hidden fit:w-20 fit:max-[1599px]:hidden" aria-hidden="true"><div class="h-full rounded-full bg-ui-accent" style="width: {progress}%"></div></div>
						<p class="text-[13px] text-muted-foreground max-[1700px]:hidden" data-testid="plan-suggestion">{@render suggestionText()}</p>
					</div>
				{:else}
					<Panel data-testid="plan-total">
						<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
							<div class="min-w-0">
								<p class="text-[13px] font-medium text-muted-foreground">{t('weekplan.total_label')}</p>
								<p class="text-[22px] sm:text-[22px] sm:text-[28px] leading-tight font-semibold tracking-[-0.6px] tabular-nums" data-testid="plan-total-text">
									{t('weekplan.total_text', { planned: timeDisplay.duration(totals.plannedSeconds), target: timeDisplay.duration(totals.targetSeconds) })}
								</p>
							</div>
							<StatusChip tone={totals.differenceSeconds === 0 ? 'success' : totals.differenceSeconds < 0 ? 'warning' : 'accent'} dot={false}>
								<span data-testid="plan-diff">{differenceText}</span>
							</StatusChip>
						</div>
						<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div class="h-full rounded-full bg-ui-accent" style="width: {progress}%"></div></div>
						<p class="mt-3 text-[13px] text-muted-foreground" data-testid="plan-suggestion">{@render suggestionText()}</p>
					</Panel>
				{/if}

				<div class="flex items-center gap-2 max-sm:flex-nowrap max-sm:overflow-x-auto sm:flex-wrap fit:min-w-0 fit:flex-1 fit:flex-nowrap">
					{@render actionButtons(false)}
					{@render viewSwitch(false)}
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet saveBar(side: boolean)}
		<!-- Save bar: always reachable. Phones and the list view keep it at the bottom of the viewport while the week scrolls; landscape grid views place it in the bottom row or at the foot of the side panel. -->
		<div
			class={side ? SAVE_SIDE : view === 'grid' ? SAVE_GRID : SAVE_LIST}
			data-testid="plan-savebar"
		>
			<span class="mr-auto text-sm {dirty ? 'font-medium text-foreground' : 'text-muted-foreground'}" role="status" data-testid="plan-dirty" data-dirty={dirty}>{dirty ? t('weekplan.dirty') : t('weekplan.clean')}</span>
			{#if dirty}<Button variant="ghost" size={side ? 'sm' : 'default'} onclick={discard} data-testid="plan-discard">{t('weekplan.discard')}</Button>{/if}
			<Button size={side ? 'sm' : 'default'} onclick={save} disabled={saving || !dirty} aria-busy={saving} data-testid="plan-save"><Save />{saving ? t('weekplan.saving') : t('weekplan.save')}</Button>
		</div>
	{/snippet}

	{#if view === 'grid'}
		<div class="flex flex-col gap-4 fit:flex fit:min-h-0 fit:flex-1 fit:flex-col" data-testid="week-planner" data-week={isoWeek}>
			<PlannerBoard
				{week}
				{drafts}
				{multi}
				{commit}
				{undo}
				{redo}
				{canUndo}
				{canRedo}
				{undoLabel}
				{redoLabel}
				{suggestion}
				{places}
				{today}
				{timeZone}
				{monday}
				onstandard={applyStandard}
				oncopylast={applyCopy}
				{alerts}
				{overview}
				{saveBar}
			/>
		</div>
	{:else}
		<div class="flex flex-col gap-4 fit:min-h-0 fit:flex-1 fit:gap-2.5" data-testid="week-planner" data-week={isoWeek}>
			{@render alerts(false)}
			{@render overview(false)}
			<ul class="relative flex flex-col gap-2.5 fit:min-h-0 fit:flex-1 fit:overflow-y-auto" data-testid="plan-rows">
				{#each days as day, index (day.date)}
					<PlanRow {day} {multi} {places} holiday={holidays[day.date] ?? null} draft={drafts[index]} {showProblems} onmode={(mode) => setMode(index, mode)} onchange={(next) => setDraft(index, next)} />
				{/each}
			</ul>
			{@render saveBar(false)}
		</div>
	{/if}
{/if}

{#if followOpen}
	<FollowWeeksDialog busy={followBusy} error={followError} anchor={followAnchor} returnFocus={followTrigger} onsubmit={applyFollow} onclose={() => (followOpen = false)} />
{/if}

<Toast message={toast} />
</div>
