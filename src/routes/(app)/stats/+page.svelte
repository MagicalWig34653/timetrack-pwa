<script lang="ts">
	import Chart from '#lib/components/stats/Chart.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import KpiCard from '#lib/components/app/KpiCard.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { clockText, presetRange, type Granularity, type RangePreset, type StatsData } from '#lib/stats/aggregate.js';
	import type { ChartSeries } from '#lib/stats/chart-types.js';
	import { hourTicks } from '#lib/stats/scale.js';
	import { statsSource } from '#lib/stats/source.js';
	import { addDays, isValidDate, todayLocal } from '#lib/time/dates.js';
	import Dur from '#lib/components/app/Dur.svelte';
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import BarChart3 from '@lucide/svelte/icons/chart-column';
	import Clock from '@lucide/svelte/icons/clock';
	import Coffee from '@lucide/svelte/icons/coffee';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Plane from '@lucide/svelte/icons/plane';
	import Scale from '@lucide/svelte/icons/scale';
	import Target from '@lucide/svelte/icons/target';
	import Wallet from '@lucide/svelte/icons/wallet';

	const PRESETS: Exclude<RangePreset, 'custom'>[] = ['w4', 'w12', 'w26', 'w52', 'year'];
	const GRANS: Granularity[] = ['day', 'week', 'month'];
	const DEFAULT_GRAN: Record<RangePreset, Granularity> = { w4: 'day', w12: 'week', w26: 'week', w52: 'week', year: 'month', custom: 'week' };

	const timeZone = $derived(zoneStore.value);
	const today = $derived(todayLocal(timeZone));

	let preset = $state<RangePreset>('w12');
	let granularity = $state<Granularity>('week');
	let rounded = $state(true);
	let customFrom = $state('');
	let customTo = $state('');
	let load = $state<LoadState>({ status: 'loading' });
	let data = $state<StatsData | null>(null);
	let endBalance = $state<number | null>(null);
	let reloadToken = $state(0);

	const range = $derived.by(() => {
		if (preset !== 'custom') return presetRange(preset, today);
		const from = isValidDate(customFrom) ? customFrom : addDays(today, -83);
		const to = isValidDate(customTo) ? customTo : today;
		return to < from ? { from: to, to: from } : { from, to };
	});

	function pickPreset(next: RangePreset) {
		preset = next;
		granularity = DEFAULT_GRAN[next];
		if (next === 'custom' && !customFrom) {
			customFrom = addDays(today, -83);
			customTo = today;
		}
	}

	$effect(() => {
		void reloadToken;
		const query = { from: range.from, to: range.to, granularity, rounded, today, timeZone };
		load = { status: 'loading' };
		void (async () => {
			try {
				await zoneStore.ensure();
				const result = await statsSource.load(query);
				if (query.from !== range.from || query.to !== range.to || query.granularity !== granularity || query.rounded !== rounded) return;
				data = result;
				const last = result.points.at(-1);
				endBalance = !result.balanceAvailable ? null : last ? last.balanceSeconds : result.openingBalanceSeconds;
				load = { status: 'ready' };
			} catch (e) {
				load = toLoadState(e);
			}
		})();
	});

	const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
	const fmtHours = (h: number) => timeDisplay.duration(h * 3600);
	const fmtDeltaHours = (h: number) => timeDisplay.delta(Math.round(h * 3600));
	const labels = $derived(data?.points.map((p) => p.label) ?? []);

	const accountSeries = $derived<ChartSeries[]>([{ key: 'balance', label: t('stats.series.balance'), values: data?.points.map((p) => hours(p.balanceSeconds)) ?? [], cls: 'text-ui-accent' }]);
	const sollIstSeries = $derived<ChartSeries[]>([
		{ key: 'target', label: t('stats.series.target'), values: data?.points.map((p) => hours(p.targetSeconds)) ?? [], cls: 'text-zinc-400 dark:text-zinc-500' },
		{ key: 'actual', label: t('stats.series.actual'), values: data?.points.map((p) => hours(p.actualSeconds)) ?? [], cls: 'text-ui-accent' }
	]);
	const diffSeries = $derived<ChartSeries[]>([{ key: 'delta', label: t('stats.kpi.balance'), values: data?.points.map((p) => hours(p.deltaSeconds)) ?? [], cls: 'text-emerald-600 dark:text-emerald-400', negCls: 'text-amber-600 dark:text-amber-400' }]);
	const monthLabels = $derived(data?.monthly.map((p) => p.label) ?? []);
	const absenceSeries = $derived<ChartSeries[]>([
		{ key: 'vacation', label: t('stats.series.vacation'), values: data?.monthly.map((p) => p.vacationDays) ?? [], cls: 'text-sky-500' },
		{ key: 'sick', label: t('stats.series.sick'), values: data?.monthly.map((p) => p.sickDays) ?? [], cls: 'text-rose-500' },
		{ key: 'other', label: t('stats.series.other'), values: data?.monthly.map((p) => p.otherAbsenceDays) ?? [], cls: 'text-violet-500' }
	]);
	const timesSeries = $derived<ChartSeries[]>([
		{ key: 'start', label: t('stats.series.start'), values: data?.points.map((p) => p.avgStartMinutes) ?? [], cls: 'text-ui-accent' },
		{ key: 'end', label: t('stats.series.end'), values: data?.points.map((p) => p.avgEndMinutes) ?? [], cls: 'text-orange-500' }
	]);
	const breakSeries = $derived<ChartSeries[]>([{ key: 'breaks', label: t('stats.series.breaks'), values: data?.points.map((p) => hours(p.breakSeconds)) ?? [], cls: 'text-amber-500' }]);

	const kinds = $derived.by(() => {
		if (!data) return [];
		const { workSeconds, travelSeconds, schoolSeconds } = data.totals;
		const total = workSeconds + travelSeconds + schoolSeconds;
		return [
			{ key: 'work', label: t('stats.series.work'), seconds: workSeconds, cls: 'bg-ui-accent' },
			{ key: 'travel', label: t('stats.series.travel'), seconds: travelSeconds, cls: 'bg-sky-500' },
			{ key: 'school', label: t('stats.series.school'), seconds: schoolSeconds, cls: 'bg-violet-500' }
		].map((k) => ({ ...k, share: total > 0 ? k.seconds / total : 0 }));
	});
	const kindTotal = $derived(kinds.reduce((sum, k) => sum + k.seconds, 0));
	const segBtn = 'h-8 px-3 text-sm';
</script>

<PageHeader title={t('stats.title')} description={t('stats.description')} />

<div class="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3" data-testid="stats-controls">
	<div role="group" aria-label={t('stats.range_label')} class="flex flex-wrap gap-1">
		{#each PRESETS as p (p)}
			<Button variant={preset === p ? 'default' : 'outline'} size="sm" class={segBtn} aria-pressed={preset === p} onclick={() => pickPreset(p)} data-testid="range-{p}">{t(`stats.range.${p}`)}</Button>
		{/each}
		<Button variant={preset === 'custom' ? 'default' : 'outline'} size="sm" class={segBtn} aria-pressed={preset === 'custom'} onclick={() => pickPreset('custom')} data-testid="range-custom">{t('stats.range.custom')}</Button>
	</div>
	{#if preset === 'custom'}
		<div class="flex items-end gap-2">
			<label class="flex flex-col gap-1 text-xs text-muted-foreground">{t('stats.from')}<input type="date" bind:value={customFrom} max={customTo || today} class="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30" data-testid="stats-from" /></label>
			<label class="flex flex-col gap-1 text-xs text-muted-foreground">{t('stats.to')}<input type="date" bind:value={customTo} min={customFrom} class="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30" data-testid="stats-to" /></label>
		</div>
	{/if}
	<div role="group" aria-label={t('stats.granularity_label')} class="flex gap-1">
		{#each GRANS as g (g)}
			<Button variant={granularity === g ? 'default' : 'outline'} size="sm" class={segBtn} aria-pressed={granularity === g} onclick={() => (granularity = g)} data-testid="gran-{g}">{t(`stats.gran.${g}`)}</Button>
		{/each}
	</div>
	<label class="flex items-center gap-2 text-sm" title={t('stats.rounded_hint')}>
		<input type="checkbox" bind:checked={rounded} class="size-4 accent-primary" data-testid="stats-rounded" />
		{t('stats.rounded')}
	</label>
</div>

{#if load.status === 'loading' && !data}
	<p class="text-sm text-muted-foreground" data-testid="stats-loading">{t('stats.loading')}</p>
{:else if load.status === 'unavailable'}
	<Alert variant="warning">{t('stats.unavailable')}</Alert>
{:else if load.status === 'error'}
	<Alert variant="destructive">
		<div class="flex flex-wrap items-center gap-3"><span>{load.message}</span><Button size="sm" variant="outline" onclick={() => reloadToken++}>{t('stats.retry')}</Button></div>
	</Alert>
{:else if data}
	<div class="flex flex-col gap-4 transition-opacity {load.status === 'loading' ? 'opacity-60' : ''}" data-testid="stats-ready" aria-busy={load.status === 'loading'}>
		{#if data.empty}
			<EmptyState title={t('stats.empty_title')} description={t('stats.empty_text')} icon={BarChart3} testid="stats-empty" />
		{:else}
			<section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('stats.title')} data-testid="stats-kpis">
				<KpiCard title={t('stats.kpi.actual')} seconds={data.totals.actualSeconds} icon={Gauge} testid="stats-actual" />
				<KpiCard title={t('stats.kpi.target')} seconds={data.totals.targetSeconds} icon={Target} testid="stats-target" />
				<KpiCard title={t('stats.kpi.balance')} seconds={data.totals.deltaSeconds} delta icon={Scale} tone={data.totals.deltaSeconds < 0 ? 'negative' : 'default'} testid="stats-delta" />
				<KpiCard title={t('stats.kpi.account')} value={endBalance === null ? '–' : timeDisplay.delta(endBalance)} icon={Wallet} tone={(endBalance ?? 0) < 0 ? 'negative' : 'default'} testid="stats-account" />
				<KpiCard title={t('stats.kpi.avg_start')} value={data.totals.avgStartMinutes === null ? '–' : clockText(data.totals.avgStartMinutes)} icon={Clock} testid="stats-avg-start" />
				<KpiCard title={t('stats.kpi.avg_end')} value={data.totals.avgEndMinutes === null ? '–' : clockText(data.totals.avgEndMinutes)} icon={Clock} testid="stats-avg-end" />
				<KpiCard title={t('stats.kpi.breaks')} seconds={data.totals.breakSeconds} icon={Coffee} testid="stats-breaks" />
				<KpiCard title={t('stats.kpi.absences')} value={data.absencesAvailable === false ? '–' : String(data.totals.absenceDays).replace('.', ',')} icon={Plane} testid="stats-absences" />
			</section>

			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<Panel class="lg:col-span-2">
					{#if data.balanceAvailable}
						<Chart title={t('stats.chart.account')} description={t('stats.chart.account_desc')} categories={labels} series={accountSeries} type="line" format={fmtDeltaHours} ticks={hourTicks} axisFormat={(v) => `${Math.round(v)} h`} testid="chart-account" legend={false} />
					{:else}
						<p class="text-sm text-muted-foreground" data-testid="chart-account-unavailable">{t('stats.account_unavailable')}</p>
					{/if}
				</Panel>
				<Panel>
					<Chart title={t('stats.chart.soll_ist')} description={t('stats.chart.soll_ist_desc')} categories={labels} series={sollIstSeries} type="bars" format={fmtHours} axisFormat={(v) => `${Math.round(v)} h`} testid="chart-soll-ist" />
				</Panel>
				<Panel>
					<Chart title={t('stats.chart.diff')} description={t('stats.chart.diff_desc')} categories={labels} series={diffSeries} type="bars" format={fmtDeltaHours} axisFormat={(v) => `${Math.round(v)} h`} testid="chart-diff" legend={false} />
				</Panel>
				<Panel title={t('stats.chart.kinds')} description={t('stats.chart.kinds_desc')} data-testid="chart-kinds">
					{#if kindTotal === 0}
						<p class="text-sm text-muted-foreground">{t('stats.nodata_chart')}</p>
					{:else}
						<div class="mb-3 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={kinds.map((k) => `${k.label} ${Math.round(k.share * 100)} %`).join(', ')}>
							{#each kinds as k (k.key)}{#if k.share > 0}<span class="{k.cls} h-full" style="width: {k.share * 100}%"></span>{/if}{/each}
						</div>
						<ul class="flex flex-col gap-2 text-sm">
							{#each kinds as k (k.key)}
								<li class="flex items-center gap-2" data-testid="kind-{k.key}">
									<span class="inline-block size-2.5 rounded-sm {k.cls}"></span>
									<span class="flex-1">{k.label}</span>
									<Dur seconds={k.seconds} class="tabular-nums" />
									<span class="w-12 text-right text-muted-foreground tabular-nums">{Math.round(k.share * 100)} %</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Panel>
				<Panel>
					{#if data.absencesAvailable === false}
						<h3 class="text-sm font-medium">{t('stats.chart.absences')}</h3>
						<p class="mt-2 text-sm text-muted-foreground" data-testid="chart-absences-unavailable">{t('stats.absences_unavailable')}</p>
					{:else}
					<Chart title={t('stats.chart.absences')} description={t('stats.chart.absences_desc')} categories={monthLabels} series={absenceSeries} type="stacked" format={(v) => t('stats.days', { count: String(v).replace('.', ',') })} axisFormat={(v) => String(v)} testid="chart-absences" />
					{/if}
				</Panel>
				<Panel>
					<Chart title={t('stats.chart.times')} description={t('stats.chart.times_desc')} categories={labels} series={timesSeries} type="line" format={(v) => clockText(Math.round(v))} ticks={(lo, hi) => { const step = 60; const out: number[] = []; for (let v = Math.floor(lo / step) * step; v <= hi + step; v += step) out.push(v); return out.length > 7 ? out.filter((_, i) => i % 2 === 0) : out; }} axisFormat={(v) => clockText(Math.round(v))} testid="chart-times" />
				</Panel>
				<Panel>
					<Chart title={t('stats.chart.breaks')} description={t('stats.chart.breaks_desc')} categories={labels} series={breakSeries} type="bars" format={fmtHours} axisFormat={(v) => `${v.toFixed(1).replace('.', ',')} h`} testid="chart-breaks" legend={false} />
				</Panel>
			</div>
		{/if}
	</div>
{/if}
