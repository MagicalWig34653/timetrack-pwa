<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import type { DayEvaluation, TimeWeek } from '#lib/api/types.js';
	import DayDetail from '#lib/components/day/DayDetail.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import KpiCard from '#lib/components/app/KpiCard.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import DayCard from '#lib/components/week/DayCard.svelte';
	import StatChip from '#lib/components/week/StatChip.svelte';
	import WeekNav from '#lib/components/week/WeekNav.svelte';
	import WeekSkeleton from '#lib/components/week/WeekSkeleton.svelte';
	import WeekTabs from '#lib/components/week/WeekTabs.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { addDays, formatDateLong, formatDateNumeric, isoWeekLabel, isoWeekNumber, mondayOfIsoWeek, startOfWeek, todayLocal } from '#lib/time/dates.js';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { entriesForDay, vacationByDay } from '#lib/week/vacation.js';
	import { absenceRuns, absenceWarning, hasOpenAbsence } from '#lib/week/absences.js';
	import { prefetchAdjacentWeeks } from '#lib/week/prefetch.js';
	import { recalledWeek, rememberWeek } from '#lib/week/last-week.js';
	import { ABSENCE_CLASSES, absenceKindLabel } from '#lib/planning/labels.js';
	import { isEmptyWeek, summarySentence } from '#lib/week/overview.js';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import CalendarRange from '@lucide/svelte/icons/calendar-range';
	import Car from '@lucide/svelte/icons/car';
	import Clock from '@lucide/svelte/icons/clock';
	import Coffee from '@lucide/svelte/icons/coffee';
	import Flag from '@lucide/svelte/icons/flag';
	import Flame from '@lucide/svelte/icons/flame';
	import Gauge from '@lucide/svelte/icons/gauge';
	import GraduationCap from '@lucide/svelte/icons/graduation-cap';
	import Plane from '@lucide/svelte/icons/plane';
	import Scale from '@lucide/svelte/icons/scale';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import Trophy from '@lucide/svelte/icons/trophy';
	import Target from '@lucide/svelte/icons/target';
	import Wallet from '@lucide/svelte/icons/wallet';
	import { onMount, untrack } from 'svelte';

	const timeZone = $derived(zoneStore.value);
	const today = $derived(todayLocal(timeZone));
	const currentMonday = $derived(startOfWeek(today));
	const requested = $derived(page.url.searchParams.get('week') ?? '');
	// The URL names the week when it can; without ?week the last viewed week of this tab is restored (P12).
	const explicit = $derived(mondayOfIsoWeek(requested));
	const recalled = $derived(requested === '' ? recalledWeek() : null);
	const monday = $derived(explicit ?? mondayOfIsoWeek(recalled ?? '') ?? currentMonday);
	const isoWeek = $derived(isoWeekLabel(monday));
	const isCurrent = $derived(monday === currentMonday);

	$effect(() => {
		if (explicit) rememberWeek(isoWeekLabel(explicit));
		else if (recalled && monday !== currentMonday) void goto(`/week?week=${isoWeekLabel(monday)}`, { replace: true });
	});

	let load = $state<LoadState>({ status: 'loading' });
	let week = $state<TimeWeek | null>(null);
	/** a different week is loading while the previous one stays visible */
	let refreshing = $state(false);
	/** day evaluations of the week, only used to find entries that need a check (the review filter of the former time list) */
	let reviewDates = $state<string[]>([]);
	const reviewOnly = $derived(page.url.searchParams.get('review') === '1');

	async function fetchWeek(target: string, silent: boolean) {
		// Stale-while-revalidate: with a week on screen it stays visible (dimmed) until the next one arrives.
		if (!silent) {
			if (week) refreshing = true;
			else load = { status: 'loading' };
		}
		try {
			await zoneStore.ensure();
			const [result, evaluations] = await Promise.all([api.getTimeWeek(target), api.listDays(monday, addDays(monday, 6)).catch((): DayEvaluation[] => [])]);
			if (target !== isoWeek) return;
			week = result;
			reviewDates = evaluations.filter((day) => day.segments?.some((segment) => segment.needsReview)).map((day) => day.date);
			load = { status: 'ready' };
			refreshing = false;
		} catch (error) {
			if (target === isoWeek && !(silent && load.status === 'ready')) {
				week = null;
				load = toLoadState(error);
			}
			if (target === isoWeek) refreshing = false;
		}
	}

	$effect(() => {
		const target = isoWeek;
		untrack(() => void fetchWeek(target, false));
	});

	// The running week changes by itself (open segment, provisional day): refresh quietly once a minute.
	onMount(() => {
		const poll = setInterval(() => {
			if (isCurrent && document.visibilityState === 'visible') void fetchWeek(isoWeek, true);
		}, 60_000);
		return () => clearInterval(poll);
	});

	/** vacation of the visible week from the absence list (N3); null while unknown or when planning is off */
	let vacationDays = $state<ReturnType<typeof vacationByDay> | null>(null);
	$effect(() => {
		const from = monday;
		let current = true;
		if (!moduleStore.enabled('planning')) {
			vacationDays = null;
			return;
		}
		void api
			.listAbsences(from, addDays(from, 6))
			.then((list) => current && (vacationDays = vacationByDay(list, from, addDays(from, 6))))
			.catch(() => current && (vacationDays = null));
		return () => (current = false);
	});

	// Warm the neighbouring weeks once this one is on screen (idle, sequential, cancelled on navigation).
	$effect(() => {
		if (load.status !== 'ready' || refreshing || !week || week.week !== isoWeek) return;
		const planning = moduleStore.enabled('planning');
		return prefetchAdjacentWeeks(monday, {
			load: (from, label) =>
				Promise.all([api.getTimeWeek(label), api.listDays(from, addDays(from, 6)), planning ? api.listAbsences(from, addDays(from, 6)) : null])
		});
	});

	const summary = $derived(week?.summary ?? null);
	const allDays = $derived(week?.days ?? []);
	const days = $derived(reviewOnly ? allDays.filter((day) => reviewDates.includes(day.date)) : allDays);
	// The day panel: ?day=YYYY-MM-DD inside this week, else today in the current week.
	const dayParam = $derived(page.url.searchParams.get('day') ?? '');
	const selectedDate = $derived(allDays.some((day) => day.date === dayParam) ? dayParam : isCurrent && allDays.some((day) => day.date === today) ? today : null);
	function hrefFor(date: string | null): string {
		const params = new URLSearchParams({ week: isoWeek });
		if (date) params.set('day', date);
		if (reviewOnly) params.set('review', '1');
		return `/week?${params}`;
	}
	const selectDay = (date: string) => void goto(hrefFor(date), { replace: true, reset: false });
	function toggleReview() {
		const params = new URLSearchParams({ week: isoWeek });
		if (!reviewOnly) params.set('review', '1');
		void goto(`/week?${params}`, { replace: true, reset: false });
	}
	const planned = $derived(summary?.plannedSeconds ?? null);
	const plannedToDate = $derived(allDays.filter((d) => !d.isFuture).reduce((sum, d) => sum + (d.plannedSeconds ?? 0), 0));
	const workedHours = $derived(summary ? summary.workSeconds + summary.creditSeconds : 0);
	const sentence = $derived(summary ? summarySentence(summary, isCurrent, isoWeekNumber(monday)) : '');
	const longestWeekday = $derived(summary?.longestDay ? weekdayLabel(allDays.find((d) => d.date === summary.longestDay!.date)?.weekday ?? 1) : '');
	const planDiff = $derived(workedHours - plannedToDate);
	const runs = $derived(absenceRuns(allDays));
	const openAbsence = $derived(hasOpenAbsence(allDays));
</script>

<PageHeader title={t('weekview.title')} description={t('weekview.description')} />
<WeekTabs current="overview" week={isoWeek} />
<WeekNav {monday} {currentMonday} basePath="/week" onpick={(picked) => goto(`/week?week=${isoWeekLabel(picked)}`)} />

{#if load.status === 'loading' || (load.status === 'ready' && !summary)}
	<WeekSkeleton />
{:else if load.status === 'unavailable'}
	<Alert variant="warning" data-testid="week-unavailable">{t('weekview.unavailable')}</Alert>
{:else if load.status === 'error'}
	<Alert variant="destructive">
		<div class="flex flex-wrap items-center gap-3">
			<span>{load.message}</span>
			<Button size="sm" variant="outline" onclick={() => fetchWeek(isoWeek, false)}>{t('weekview.retry')}</Button>
		</div>
	</Alert>
{:else if summary}
	<div class="flex flex-col gap-4 transition-opacity {refreshing ? 'opacity-60' : ''}" data-testid="week-overview" data-week={week?.week ?? isoWeek} aria-busy={refreshing}>
		<section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('weekview.summary_label')} data-testid="week-kpis">
			<KpiCard title={t('weekview.actual')} seconds={workedHours} hint={t('weekview.actual_hint')} icon={Gauge} testid="week-actual" />
			<KpiCard
				title={t('weekview.target')}
				seconds={summary.targetSeconds}
				hint={isCurrent && summary.targetToDateSeconds < summary.targetSeconds ? t('weekview.target_hint_to_date', { time: timeDisplay.duration(summary.targetToDateSeconds) }) : t('weekview.target_hint_full')}
				icon={Target}
				testid="week-target"
			/>
			<KpiCard title={t('weekview.balance')} seconds={summary.balanceSeconds} delta hint={isCurrent ? t('weekview.balance_hint') : t('weekview.balance_hint_past')} icon={Scale} tone={summary.balanceSeconds < 0 ? 'negative' : 'default'} testid="week-balance" />
			<KpiCard
				title={t('weekview.account')}
				seconds={summary.accountBalanceAfterSeconds} delta
				hint={t('weekview.account_hint_before', { time: timeDisplay.delta(summary.accountBalanceBeforeSeconds) })}
				icon={Wallet}
				tone={summary.accountBalanceAfterSeconds < 0 ? 'negative' : 'default'}
				testid="week-account"
			/>
		</section>

		{#if reviewDates.length > 0}
			<Alert variant="warning" data-testid="review-banner">
				{t('segments.review_overview', { count: reviewDates.length })}
				<button type="button" class="underline" onclick={toggleReview} data-testid="review-toggle">{reviewOnly ? t('segments.show_all') : t('segments.show_review_only')}</button>
			</Alert>
		{/if}

		{#if isEmptyWeek(allDays) && planned === null}
			<EmptyState title={t('weekview.empty_title')} description={t('weekview.empty_text')} icon={CalendarRange} testid="week-empty">
				{#snippet action()}
					{#if moduleStore.enabled('planning')}<Button variant="outline" size="sm" href="/plan?week={isoWeek}">{t('weekview.empty_plan')}</Button>{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<ol class="grid gap-3 lg:grid-cols-7 lg:items-stretch" aria-label={t('weekview.days_label')} data-testid="week-days">
				{#each days as day (day.date)}
					<li class="min-w-0 *:h-full"><DayCard {day} {timeZone} href={hrefFor(day.date)} selected={day.date === selectedDate} review={reviewDates.includes(day.date)} vacation={entriesForDay(vacationDays, day.date, day.mark)} onselect={() => selectDay(day.date)} /></li>
				{/each}
			</ol>
		{/if}

		{#if selectedDate}
			<section class="flex flex-col gap-3" aria-label={t('n2.day_panel_label', { date: formatDateLong(selectedDate) })} data-testid="week-day-panel" data-date={selectedDate}>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-lg font-semibold">{formatDateLong(selectedDate)}</h2>
					<Button variant="outline" size="sm" href="/time/{selectedDate}" data-testid="week-day-open">{t('n2.day_open_page')}</Button>
				</div>
				{#key selectedDate}
					<DayDetail date={selectedDate} heading={false} weekDay={allDays.find((d) => d.date === selectedDate) ?? null} onchanged={() => void fetchWeek(isoWeek, true)} />
				{/key}
			</section>
		{:else if allDays.length > 0}
			<p class="text-sm text-muted-foreground" data-testid="week-day-hint">{t('n2.day_pick_hint')}</p>
		{/if}

		{#if runs.length > 0}
			<Panel title={t('weekview.absences_title')} description={openAbsence ? t('weekview.absences_open_hint') : undefined} data-testid="week-absences">
				<ul class="flex flex-col gap-2" aria-label={t('weekview.absences_label')}>
					{#each runs as run, i (i)}
						{@const warning = absenceWarning(run.status)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[15px]" data-testid="week-absence-run" data-status={run.status}>
							<span class="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium {ABSENCE_CLASSES[run.kind]}">{absenceKindLabel(run.kind)}</span>
							<span class="tabular-nums">{run.from === run.to ? formatDateNumeric(run.from) : `${formatDateNumeric(run.from)} – ${formatDateNumeric(run.to)}`}</span>
							<span class="text-muted-foreground">{t(run.counted === 1 ? 'weekview.absence.days_one' : 'weekview.absence.days_other', { count: String(run.counted).replace('.', ',') })}</span>
							<span class="text-muted-foreground">{t(`absence.status.${run.status}`)}</span>
							{#if warning}<StatusChip tone="warning" dot={false}>{warning}</StatusChip>{/if}
						</li>
					{/each}
				</ul>
				{#if moduleStore.enabled('planning')}
					<div class="mt-4 flex flex-wrap gap-2">
						<Button size="sm" variant="outline" href="/vacation/planner" data-testid="week-absence-planner">{t('weekview.absence.planner_link')}</Button>
						{#if openAbsence}<Button size="sm" variant="outline" href="/absences?year={monday.slice(0, 4)}" data-testid="week-absence-request">{t('weekview.absence.request_link')}</Button>{/if}
					</div>
				{/if}
			</Panel>
		{/if}

		<p class="text-xs"><a class="underline underline-offset-4" href="/time/cancelled" data-testid="cancelled-link">{t('trash.link')}</a></p>

		<p class="text-[15px] text-foreground" data-testid="week-sentence">{sentence}</p>

		<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 wide:grid-cols-4" aria-label={t('weekview.chips_label')} data-testid="week-chips">
			<StatChip icon={Briefcase} value={String(summary.workDays)} caption={t(summary.workDays === 1 ? 'weekview.chip.workdays_one' : 'weekview.chip.workdays_other')} testid="chip-workdays" />
			{#if summary.vacationDays > 0}<StatChip icon={Plane} value={String(summary.vacationDays).replace('.', ',')} caption={t(summary.vacationDays === 1 ? 'weekview.chip.vacation_one' : 'weekview.chip.vacation_other')} testid="chip-vacation" />{/if}
			{#if summary.sickDays > 0}<StatChip icon={Stethoscope} value={String(summary.sickDays)} caption={t(summary.sickDays === 1 ? 'weekview.chip.sick_one' : 'weekview.chip.sick_other')} testid="chip-sick" />{/if}
			{#if summary.schoolDays > 0}<StatChip icon={GraduationCap} value={String(summary.schoolDays)} caption={t(summary.schoolDays === 1 ? 'weekview.chip.school_one' : 'weekview.chip.school_other')} testid="chip-school" />{/if}
			{#if summary.holidayDays > 0}<StatChip icon={Flag} value={String(summary.holidayDays)} caption={t(summary.holidayDays === 1 ? 'weekview.chip.holiday_one' : 'weekview.chip.holiday_other')} testid="chip-holiday" />{/if}
			{#if summary.travelSeconds > 0}<StatChip icon={Car} seconds={summary.travelSeconds} caption={t('weekview.chip.travel')} testid="chip-travel" />{/if}
			{#if summary.breakSeconds > 0}<StatChip icon={Coffee} seconds={summary.breakSeconds} caption={t('weekview.chip.breaks')} testid="chip-breaks" />{/if}
			{#if summary.averageStart && summary.averageEnd}<StatChip icon={Clock} value="{summary.averageStart}–{summary.averageEnd}" caption={t('weekview.chip.average')} testid="chip-average" />{/if}
			{#if summary.longestDay}<StatChip icon={isCurrent ? Flame : Trophy} seconds={summary.longestDay.seconds} caption={t('weekview.chip.longest', { weekday: longestWeekday })} testid="chip-longest" />{/if}
		</ul>

		{#if planned !== null}
			<Panel title={t('weekview.plan_card_title')} data-testid="week-plan-card">
				<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
					<p class="text-[15px]">{t('weekview.plan_card_line', { planned: timeDisplay.duration(planned), actual: timeDisplay.duration(workedHours) })}</p>
					{#if isCurrent || plannedToDate > 0}
						<StatusChip tone={planDiff === 0 ? 'neutral' : planDiff < 0 ? 'warning' : 'success'} dot={false}>
							{planDiff === 0 ? t('weekview.plan_card_diff_equal') : t(planDiff < 0 ? 'weekview.plan_card_diff_under' : 'weekview.plan_card_diff_over', { time: timeDisplay.duration(Math.abs(planDiff)) })}
						</StatusChip>
					{/if}
				</div>
			</Panel>
		{/if}
	</div>
{/if}
