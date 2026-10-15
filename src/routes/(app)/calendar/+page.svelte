<script lang="ts">
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import type { Absence, CalendarDay, DayEvaluation, Place, PlanDay } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import DayChips from '#lib/components/planning/DayChips.svelte';
	import DayPanel from '#lib/components/planning/DayPanel.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { addMonths, dayInfo, monthGrid, weekOf, yearsOf, type DayInfo } from '#lib/planning/calendar.js';
	import { ABSENCE_CLASSES, absenceKindLabel, HOLIDAY_CLASS, PLAN_CLASSES, planModeLabel, SCHOOL_HOLIDAY_CLASS } from '#lib/planning/labels.js';
	import { addDays, formatDateLong, formatDateNumeric, formatDateShort, isValidDate, todayLocal } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	const timeZone = $derived(zoneStore.value);
	const today = $derived(todayLocal(timeZone));
	const requested = $derived(page.url.searchParams.get('date') ?? '');
	// ?date=YYYY-MM-DD selects the month (grid) and the week (phone list) containing that day.
	const anchor = $derived(isValidDate(requested) ? requested : today);
	const weeks = $derived(monthGrid(anchor));
	const gridFrom = $derived(weeks[0][0]);
	const gridTo = $derived(weeks[weeks.length - 1][6]);
	const phoneWeek = $derived(weekOf(anchor));

	const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
	const monthTitle = $derived(`${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`);

	let load = $state<LoadState>({ status: 'loading' });
	let holidays = $state<CalendarDay[]>([]);
	let absences = $state<Absence[]>([]);
	let plan = $state<PlanDay[]>([]);
	let days = $state<DayEvaluation[]>([]);
	let places = $state<Place[]>([]);
	let selected = $state<string | null>(null);
	let panelEl = $state<HTMLElement | null>(null);
	let reloadToken = $state(0);

	$effect(() => {
		const from = gridFrom;
		const to = gridTo;
		void reloadToken;
		void (async () => {
			try {
				await zoneStore.ensure();
				const [h, a, p, d, pl] = await Promise.all([
					Promise.all(yearsOf(from, to).map((y) => api.listHolidays(y))),
					api.listAbsences(from, to),
					api.listPlanDays(from, to),
					// Evaluation hints are optional: a server without time tracking must not break the calendar.
					api.listDays(from, to).catch(() => [] as DayEvaluation[]),
					api.listPlaces().catch(() => [] as Place[])
				]);
				if (from !== gridFrom) return;
				holidays = h.flat();
				absences = a;
				plan = p;
				days = d;
				places = pl.filter((x) => !x.archived);
				load = { status: 'ready' };
			} catch (error) {
				load = toLoadState(error);
			}
		})();
	});

	const data = $derived({ holidays, absences, plan, days });
	const infoOf = (date: string): DayInfo => dayInfo(date, data);
	const selectedInfo = $derived(selected ? infoOf(selected) : null);

	function describe(info: DayInfo): string {
		const parts: string[] = [formatDateLong(info.date)];
		for (const h of info.holidays) parts.push(`${t('calendar.holiday')} ${h.name}`);
		for (const h of info.schoolHolidays) parts.push(h.name);
		for (const a of info.absences) parts.push(absenceKindLabel(a.kind));
		if (info.plan) parts.push(`${t('calendar.plan')} ${planModeLabel(info.plan.mode)}`);
		if (info.evaluation && info.evaluation.evaluatedWorkSeconds > 0) parts.push(t('calendar.worked', { time: formatDuration(info.evaluation.evaluatedWorkSeconds) }));
		return parts.join(', ');
	}

	function select(date: string) {
		selected = date;
		queueMicrotask(() => panelEl?.scrollIntoView?.({ block: 'nearest' }));
	}

	const href = (date: string) => `/calendar?date=${date}`;
	const isOtherMonth = (date: string) => date.slice(0, 7) !== anchor.slice(0, 7);
</script>

<PageHeader title={t('calendar.title')} description={t('calendar.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<!-- navigation by month (tablet and desktop) -->
		<nav class="hidden items-center gap-2 sm:flex" aria-label={t('calendar.nav_month')}>
			<Button variant="outline" size="icon" href={href(addMonths(anchor, -1))} aria-label={t('calendar.previous_month')}><ChevronLeft /></Button>
			<h2 class="min-w-40 text-center text-lg font-medium" data-testid="calendar-month">{monthTitle}</h2>
			<Button variant="outline" size="icon" href={href(addMonths(anchor, 1))} aria-label={t('calendar.next_month')}><ChevronRight /></Button>
			<Button variant="outline" size="sm" href={href(today)}>{t('datenav.today')}</Button>
		</nav>
		<!-- navigation by week (phone) -->
		<nav class="flex items-center gap-2 sm:hidden" aria-label={t('calendar.nav_week')}>
			<Button variant="outline" size="icon" href={href(addDays(anchor, -7))} aria-label={t('calendar.previous_week')}><ChevronLeft /></Button>
			<p class="flex-1 text-center text-sm font-medium" data-testid="calendar-week">{formatDateNumeric(phoneWeek[0])}–{formatDateNumeric(phoneWeek[6])}</p>
			<Button variant="outline" size="icon" href={href(addDays(anchor, 7))} aria-label={t('calendar.next_week')}><ChevronRight /></Button>
			<Button variant="outline" size="sm" href={href(today)}>{t('datenav.today')}</Button>
		</nav>

		<ul class="flex flex-wrap gap-2 text-xs" aria-label={t('calendar.legend')} data-testid="calendar-legend">
			<li class="rounded px-1.5 py-0.5 {HOLIDAY_CLASS}">{t('calendar.holiday')}</li>
			<li class="rounded px-1.5 py-0.5 {SCHOOL_HOLIDAY_CLASS}">{t('calendar.school_holiday')}</li>
			<li class="rounded px-1.5 py-0.5 {ABSENCE_CLASSES.vacation}">{absenceKindLabel('vacation')}</li>
			<li class="rounded px-1.5 py-0.5 {ABSENCE_CLASSES.sick}">{absenceKindLabel('sick')}</li>
			<li class="rounded px-1.5 py-0.5 {ABSENCE_CLASSES.excused}">{absenceKindLabel('excused')}</li>
			<li class="rounded px-1.5 py-0.5 {ABSENCE_CLASSES.other}">{absenceKindLabel('other')}</li>
			<li class="rounded px-1.5 py-0.5 {PLAN_CLASSES.office}">{t('calendar.plan')}</li>
		</ul>

		<!-- month grid (tablet and desktop) -->
		<table class="hidden w-full table-fixed border-collapse sm:table" data-testid="month-grid" aria-label={monthTitle}>
			<thead>
				<tr>
					{#each [1, 2, 3, 4, 5, 6, 7] as weekday (weekday)}
						<th scope="col" class="border-b px-1 py-1.5 text-left text-xs font-medium text-muted-foreground">{weekdayLabel(weekday)}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each weeks as week (week[0])}
					<tr>
						{#each week as date (date)}
							{@const info = infoOf(date)}
							<td class="h-28 border p-0 align-top {isOtherMonth(date) ? 'bg-muted/30' : ''}">
								<button
									type="button"
									class="flex h-full w-full flex-col gap-1 p-1.5 text-left hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none {selected === date ? 'bg-muted ring-2 ring-primary ring-inset' : ''}"
									aria-label={describe(info)}
									aria-pressed={selected === date}
									data-date={date}
									onclick={() => select(date)}
								>
									<span class="text-xs {date === today ? 'inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground' : isOtherMonth(date) ? 'text-muted-foreground' : 'font-medium'}">{Number(date.slice(8))}</span>
									<DayChips {info} compact />
								</button>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>

		<!-- week list (phone) -->
		<ul class="flex flex-col gap-2 sm:hidden" data-testid="week-days">
			{#each phoneWeek as date (date)}
				{@const info = infoOf(date)}
				<li>
					<button
						type="button"
						class="flex min-h-14 w-full items-start gap-3 rounded-lg border bg-card p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none {selected === date ? 'ring-2 ring-primary' : ''}"
						aria-label={describe(info)}
						aria-pressed={selected === date}
						data-date={date}
						onclick={() => select(date)}
					>
						<span class="w-16 shrink-0 text-sm {date === today ? 'font-semibold' : 'text-muted-foreground'}">{formatDateShort(date)}</span>
						<DayChips {info} />
					</button>
				</li>
			{/each}
		</ul>

		<div bind:this={panelEl}>
			{#if selectedInfo}
				<DayPanel info={selectedInfo} {places} onchanged={() => reloadToken++} onclose={() => (selected = null)} />
			{:else}
				<p class="text-sm text-muted-foreground">{t('calendar.pick_day')}</p>
			{/if}
		</div>
	</div>
{/if}
