<script lang="ts">
	import type { DayEvaluation, Segment } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import { dayBounds, localTimeOf } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { kindLabel } from '#lib/time/labels.js';

	let {
		date,
		timeZone,
		segments,
		evaluation,
		now
	}: { date: string; timeZone: string; segments: Segment[]; evaluation: DayEvaluation | null; now: number } = $props();

	const HOUR = 3600_000;
	const kindColor = { work: 'text-sky-600 dark:text-sky-400', travel: 'text-amber-500', school: 'text-violet-600 dark:text-violet-400' } as const;

	const live = $derived(segments.filter((s) => !s.voided).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)));
	const dayStart = $derived(dayBounds(date, timeZone).start.getTime());

	const range = $derived.by(() => {
		const points: number[] = [];
		for (const s of live) {
			points.push(Date.parse(s.startedAt), Date.parse(s.rawStartedAt));
			points.push(s.endedAt ? Date.parse(s.endedAt) : now);
		}
		if (evaluation?.evaluatedStart) points.push(Date.parse(evaluation.evaluatedStart));
		if (evaluation?.evaluatedEnd) points.push(Date.parse(evaluation.evaluatedEnd));
		let from = 6;
		let to = 18;
		if (points.length > 0) {
			from = Math.max(0, Math.min(from, Math.floor((Math.min(...points) - dayStart) / HOUR)));
			to = Math.min(25, Math.max(to, Math.ceil((Math.max(...points) - dayStart) / HOUR)));
		}
		return { from, to };
	});

	const span = $derived((range.to - range.from) * HOUR);
	const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - dayStart - range.from * HOUR) / span) * 100));
	const box = (start: number, end: number) => `left:${pct(start)}%;width:${Math.max(0.6, pct(end) - pct(start))}%`;

	const ticks = $derived.by(() => {
		const step = range.to - range.from > 12 ? 3 : 2;
		const out: { hour: number; left: number }[] = [];
		for (let h = Math.ceil(range.from / step) * step; h <= range.to; h += step) {
			out.push({ hour: h, left: pct(dayStart + h * HOUR) });
		}
		return out;
	});

	const evaluated = $derived(
		live.map((s) => ({ s, start: Date.parse(s.startedAt), end: s.endedAt ? Date.parse(s.endedAt) : now }))
	);
	const gaps = $derived(
		evaluated.slice(1).flatMap((cur, i) => {
			const prev = evaluated[i];
			return cur.start > prev.end ? [{ start: prev.end, end: cur.start }] : [];
		})
	);
	const first = $derived(evaluated[0]);
	const last = $derived(evaluated.at(-1));
	const startExt = $derived(
		evaluation?.evaluatedStart && first && Date.parse(evaluation.evaluatedStart) < first.start
			? { start: Date.parse(evaluation.evaluatedStart), end: first.start }
			: null
	);
	const endExt = $derived(
		evaluation?.evaluatedEnd && last && Date.parse(evaluation.evaluatedEnd) > last.end
			? { start: last.end, end: Date.parse(evaluation.evaluatedEnd) }
			: null
	);
	const stripes = 'background-image:repeating-linear-gradient(135deg,currentColor 0 2px,transparent 2px 6px)';
</script>

<div class="flex flex-col gap-3">
	{#if live.length === 0}
		<p class="text-sm text-muted-foreground">{t('timeline.empty')}</p>
	{:else}
		<div class="flex flex-col gap-2" role="img" aria-label={t('timeline.aria', { count: live.length })} data-testid="timeline">
			<div class="grid grid-cols-[4.5rem_1fr] items-center gap-2 sm:grid-cols-[6rem_1fr]">
				<span class="text-xs text-muted-foreground">{t('timeline.raw')}</span>
				<div class="relative h-7 rounded-md bg-muted/60" data-testid="timeline-raw">
					{#each live as s (s.id)}
						<div
							class="absolute inset-y-1 rounded-sm bg-current {kindColor[s.kind]} opacity-60"
							style={box(Date.parse(s.rawStartedAt), s.rawEndedAt ? Date.parse(s.rawEndedAt) : now)}
							title="{kindLabel(s.kind)} {localTimeOf(s.rawStartedAt, timeZone)}–{s.rawEndedAt ? localTimeOf(s.rawEndedAt, timeZone) : t('timeline.running')}"
						></div>
					{/each}
				</div>
				<span class="text-xs font-medium">{t('timeline.evaluated')}</span>
				<div class="relative h-7 rounded-md bg-muted/60" data-testid="timeline-evaluated">
					{#each gaps as gap (gap.start)}
						<div
							class="absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-sm border border-dashed border-muted-foreground/50 text-[10px] text-muted-foreground"
							style={box(gap.start, gap.end)}
							title={t('timeline.pause', { duration: formatDuration((gap.end - gap.start) / 1000) })}
							data-testid="timeline-gap"
						>
							<span class="hidden sm:inline">{formatDuration((gap.end - gap.start) / 1000)}</span>
						</div>
					{/each}
					{#each evaluated as e (e.s.id)}
						<div
							class="absolute inset-y-1 rounded-sm bg-current {kindColor[e.s.kind]}"
							style={box(e.start, e.end)}
							title="{kindLabel(e.s.kind)} {localTimeOf(e.start, timeZone)}–{e.s.endedAt ? localTimeOf(e.end, timeZone) : t('timeline.running')}"
						></div>
					{/each}
					{#if startExt}
						<div class="absolute inset-y-1 rounded-sm text-foreground/70" style="{box(startExt.start, startExt.end)};{stripes}" title={t('timeline.rounding')} data-testid="timeline-rounding"></div>
					{/if}
					{#if endExt}
						<div class="absolute inset-y-1 rounded-sm text-foreground/70" style="{box(endExt.start, endExt.end)};{stripes}" title={t('timeline.rounding')} data-testid="timeline-rounding"></div>
					{/if}
				</div>
				<span></span>
				<div class="relative h-4 text-[10px] text-muted-foreground" aria-hidden="true">
					{#each ticks as tick (tick.hour)}
						<span class="absolute -translate-x-1/2 tabular-nums" style="left:{tick.left}%">{tick.hour % 24}:00</span>
					{/each}
				</div>
			</div>
		</div>
		<ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t('timeline.legend')}>
			<li class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-sky-600 dark:bg-sky-400"></span>{t('kind.work')}</li>
			<li class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-amber-500"></span>{t('kind.travel')}</li>
			<li class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-violet-600 dark:bg-violet-400"></span>{t('kind.school')}</li>
			<li class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-sm border border-dashed border-muted-foreground/60"></span>{t('timeline.legend_pause')}
			</li>
			<li class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-sm text-foreground/70" style={stripes}></span>{t('timeline.legend_rounding')}
			</li>
		</ul>
	{/if}
</div>
