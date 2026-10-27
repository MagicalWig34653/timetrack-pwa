<script lang="ts">
	import type { Absence, CalendarDay, DayEvaluation, WorkModel } from '#lib/api/types.js';
	import { api } from '#lib/api/client.js';
	import { t } from '#lib/i18n/index.js';
	import { dayInfo, dayWorkState, monthGrid } from '#lib/planning/calendar.js';
	import { heatLevel } from '#lib/planning/cell-model.js';
	import { weekdayLabel } from '#lib/time/labels.js';

	/** Year heat map (C2): twelve mini months, each day shaded by worked time against the Soll. Loads its own year of data. */
	let { year, today, models, onpick }: { year: number; today: string; models: WorkModel[]; onpick: (date: string) => void } = $props();

	const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
	let holidays = $state<CalendarDay[]>([]);
	let absences = $state<Absence[]>([]);
	let days = $state<DayEvaluation[]>([]);
	let failed = $state(false);

	$effect(() => {
		const y = year;
		holidays = [];
		absences = [];
		days = [];
		failed = false;
		void (async () => {
			try {
				const [h, a, d] = await Promise.all([api.listHolidays(y), api.listAbsences(`${y}-01-01`, `${y}-12-31`), api.listDays(`${y}-01-01`, `${y}-12-31`).catch(() => [] as DayEvaluation[])]);
				if (y !== year) return;
				holidays = h;
				absences = a;
				days = d;
			} catch {
				failed = true;
			}
		})();
	});

	const byDate = $derived(new Map(days.map((d) => [d.date, d])));
	const data = $derived({ holidays, absences, plan: [], days });
	const LEVEL = ['', 'bg-emerald-500/20', 'bg-emerald-500/40', 'bg-emerald-500/65', 'bg-emerald-600/90 text-white'];

	function cellOf(date: string) {
		const info = dayInfo(date, data);
		const ev = byDate.get(date);
		const level = heatLevel(ev ? ev.evaluatedWorkSeconds + ev.creditSeconds : 0, ev?.targetSeconds ?? 0);
		const state = dayWorkState(info, models);
		return { level, open: info.absences.some((a) => a.kind === 'vacation' && (a.status === 'planned' || a.status === 'requested')), booked: info.absences.some((a) => a.kind === 'vacation' && (a.status === 'approved' || a.status === 'taken')), sick: info.absences.some((a) => a.kind === 'sick'), holiday: info.holidays.length > 0, free: state === 'free' };
	}
</script>

<section class="rounded-xl border bg-card p-3" aria-label={t('c2.year_overview', { year })} data-testid="year-overview">
	{#if failed}<p class="text-sm text-destructive">{t('c2.year_failed')}</p>{/if}
	<div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
		{#each MONTHS as name, m (name)}
			{@const first = `${year}-${String(m + 1).padStart(2, '0')}-01`}
			<div class="rounded-lg border p-2" data-testid="year-month-{m + 1}">
				<button type="button" class="mb-1 text-sm font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={t('c2.year_month', { month: `${name} ${year}` })} onclick={() => onpick(first)}>{name}</button>
				<div class="grid grid-cols-7 gap-px text-center text-[9px] text-muted-foreground" aria-hidden="true">
					{#each [1, 2, 3, 4, 5, 6, 7] as wd (wd)}<span>{weekdayLabel(wd).slice(0, 1)}</span>{/each}
				</div>
				<div class="grid grid-cols-7 gap-px" role="presentation">
					{#each monthGrid(first).flat() as date (date)}
						{#if date.slice(0, 7) === first.slice(0, 7)}
							{@const c = cellOf(date)}
							<span
								class="flex aspect-square items-center justify-center rounded-[3px] text-[9px] tabular-nums {LEVEL[c.level]} {c.free && c.level === 0 ? 'bg-muted/60' : ''} {c.booked ? 'bg-sky-500/50' : ''} {c.sick ? 'bg-rose-500/45' : ''} {c.open ? 'ring-1 ring-dashed ring-sky-500 ring-inset' : ''} {c.holiday ? 'outline outline-1 outline-amber-500' : ''} {date === today ? 'font-bold underline' : ''}"
								data-date={date}
								data-level={c.level}>{Number(date.slice(8))}</span>
						{:else}
							<span></span>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
	<p class="mt-2 text-xs text-muted-foreground">{t('c2.year_legend')}</p>
</section>
