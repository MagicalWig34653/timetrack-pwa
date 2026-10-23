<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import type { ChartSeries } from '#lib/stats/chart-types.js';
	import { labelIndexes, niceTicks } from '#lib/stats/scale.js';

	/**
	 * Small responsive SVG chart (line, grouped bars, stacked bars): zero dependencies, tooltip on hover and focus
	 * (arrow keys), text alternative as table below. Values are plain numbers in `unit`; `format` renders them.
	 */
	let {
		title,
		description,
		categories,
		series,
		type,
		format,
		axisFormat,
		testid,
		ticks,
		height = 220,
		legend = true
	}: {
		title: string;
		description?: string;
		categories: string[];
		series: ChartSeries[];
		type: 'line' | 'bars' | 'stacked';
		format: (value: number) => string;
		/** axis tick text; defaults to format */
		axisFormat?: (value: number) => string;
		testid: string;
		/** explicit tick values (e.g. hour steps) */
		ticks?: (min: number, max: number) => number[];
		height?: number;
		legend?: boolean;
	} = $props();

	const M = { left: 48, right: 10, top: 10, bottom: 26 };
	let width = $state(640);
	let active = $state<number | null>(null);
	let tableOpen = $state(false);
	const uid = $props.id();

	const extent = $derived.by(() => {
		let lo = 0;
		let hi = 0;
		const n = categories.length;
		for (let i = 0; i < n; i++) {
			if (type === 'stacked') {
				let pos = 0;
				let neg = 0;
				for (const s of series) {
					const v = s.values[i] ?? 0;
					if (v >= 0) pos += v;
					else neg += v;
				}
				hi = Math.max(hi, pos);
				lo = Math.min(lo, neg);
			} else
				for (const s of series) {
					const v = s.values[i];
					if (v === null || v === undefined) continue;
					hi = Math.max(hi, v);
					lo = Math.min(lo, v);
				}
		}
		// lines may float away from zero (balances, clock times): then do not force zero into view
		if (type === 'line') {
			const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
			if (all.length > 0) {
				lo = Math.min(...all);
				hi = Math.max(...all);
				const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
				lo -= pad;
				hi += pad;
			}
		}
		return { lo, hi };
	});
	const tickValues = $derived(ticks ? ticks(extent.lo, extent.hi) : niceTicks(extent.lo, extent.hi));
	const domain = $derived({ lo: Math.min(extent.lo, tickValues[0] ?? extent.lo), hi: Math.max(extent.hi, tickValues.at(-1) ?? extent.hi) });
	const plotW = $derived(Math.max(width - M.left - M.right, 10));
	const plotH = $derived(height - M.top - M.bottom);
	const band = $derived(plotW / Math.max(categories.length, 1));
	const y = (v: number) => M.top + plotH - ((v - domain.lo) / (domain.hi - domain.lo || 1)) * plotH;
	const xCenter = (i: number) => M.left + band * (i + 0.5);
	const zeroY = $derived(y(Math.min(Math.max(0, domain.lo), domain.hi)));
	const shown = $derived(labelIndexes(categories.length, plotW, 44));
	const hasData = $derived(series.some((s) => s.values.some((v) => v !== null)));

	const barW = $derived(Math.max(1, Math.min(band * 0.78, 40) / (type === 'bars' ? series.length : 1)));

	function barRects(s: ChartSeries, si: number) {
		const rects: { x: number; y: number; w: number; h: number; i: number; cls: string }[] = [];
		s.values.forEach((v, i) => {
			if (v === null || v === 0) return;
			let base = 0;
			if (type === 'stacked') {
				for (let k = 0; k < si; k++) {
					const o = series[k].values[i] ?? 0;
					if (o !== 0 && o >= 0 === v >= 0) base += o;
				}
			}
			const top = y(base + v);
			const bottom = y(base);
			const total = type === 'bars' ? barW * series.length : barW;
			const x = xCenter(i) - total / 2 + (type === 'bars' ? barW * si : 0);
			rects.push({ x, y: Math.min(top, bottom), w: barW, h: Math.max(Math.abs(bottom - top), 1), i, cls: v < 0 && s.negCls ? s.negCls : s.cls });
		});
		return rects;
	}

	function linePath(s: ChartSeries): string {
		let d = '';
		let pen = false;
		s.values.forEach((v, i) => {
			if (v === null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${xCenter(i).toFixed(1)},${y(v).toFixed(1)}`;
			pen = true;
		});
		return d;
	}

	function areaPath(s: ChartSeries): string {
		const pts = s.values.map((v, i) => (v === null ? null : [xCenter(i), y(v)] as const)).filter((p): p is readonly [number, number] => p !== null);
		if (pts.length < 2) return '';
		return `M${pts[0][0].toFixed(1)},${zeroY.toFixed(1)}${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}L${pts.at(-1)![0].toFixed(1)},${zeroY.toFixed(1)}Z`;
	}

	function indexAt(event: PointerEvent) {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const i = Math.floor((event.clientX - box.left - M.left) / band);
		return i >= 0 && i < categories.length ? i : null;
	}

	function key(event: KeyboardEvent) {
		const last = categories.length - 1;
		if (event.key === 'ArrowRight') active = Math.min(last, (active ?? -1) + 1);
		else if (event.key === 'ArrowLeft') active = Math.max(0, (active ?? 1) - 1);
		else if (event.key === 'Home') active = 0;
		else if (event.key === 'End') active = last;
		else if (event.key === 'Escape') active = null;
		else return;
		event.preventDefault();
	}

	const tipLeft = $derived(active === null ? 0 : Math.min(Math.max(xCenter(active), 80), width - 80));
	const fmtAxis = (v: number) => (axisFormat ?? format)(v);
</script>

<figure class="m-0 flex flex-col gap-2" data-testid={testid}>
	<figcaption class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<span>
			<span class="text-[15px] font-semibold">{title}</span>
			{#if description}<span class="block text-[13px] text-muted-foreground">{description}</span>{/if}
		</span>
		{#if legend && series.length > 1}
			<ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-hidden="true">
				{#each series as s (s.key)}
					<li class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-sm bg-current {s.cls}"></span>{s.label}</li>
				{/each}
			</ul>
		{/if}
	</figcaption>

	<div class="relative" bind:clientWidth={width}>
		{#if !hasData}
			<p class="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" style="height: {height}px" data-testid="{testid}-empty">{t('stats.nodata_chart')}</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<svg
				{width}
				{height}
				role="img"
				tabindex="0"
				aria-label={t('stats.chart_aria', { title })}
				class="block touch-pan-y rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				onpointermove={(e) => (active = indexAt(e))}
				onpointerleave={() => (active = null)}
				onkeydown={key}
				onblur={() => (active = null)}
				data-testid="{testid}-svg"
			>
				{#each tickValues as tick (tick)}
					<line x1={M.left} x2={width - M.right} y1={y(tick)} y2={y(tick)} class="stroke-border" stroke-width="1" stroke-dasharray={tick === 0 ? undefined : '3 3'} />
					<text x={M.left - 6} y={y(tick)} dy="0.32em" text-anchor="end" class="fill-muted-foreground text-[10px] tabular-nums">{fmtAxis(tick)}</text>
				{/each}
				{#each categories as c, i (i)}
					{#if shown.has(i)}<text x={xCenter(i)} y={height - 8} text-anchor="middle" class="fill-muted-foreground text-[10px]">{c}</text>{/if}
				{/each}
				{#if active !== null}<rect x={M.left + band * active} y={M.top} width={band} height={plotH} class="fill-muted/60" />{/if}

				{#if type === 'line'}
					{#each series as s, si (s.key)}
						{#if si === 0}<path d={areaPath(s)} fill="currentColor" fill-opacity="0.08" class={s.cls} />{/if}
						<path d={linePath(s)} fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class={s.cls} />
						{#if categories.length <= 40}
							{#each s.values as v, i (i)}
								{#if v !== null}<circle cx={xCenter(i)} cy={y(v)} r={active === i ? 4 : 2.5} fill="currentColor" class="{s.cls} stroke-card" stroke-width="1.5" />{/if}
							{/each}
						{:else if active !== null && s.values[active] !== null}
							<circle cx={xCenter(active)} cy={y(s.values[active]!)} r="4" fill="currentColor" class={s.cls} />
						{/if}
					{/each}
				{:else}
					{#each series as s, si (s.key)}
						{#each barRects(s, si) as r (r.i)}
							<rect x={r.x} y={r.y} width={r.w} height={r.h} rx={Math.min(2, r.w / 2)} fill="currentColor" class={r.cls} fill-opacity={active === null || active === r.i ? 1 : 0.55} />
						{/each}
					{/each}
				{/if}
			</svg>
			{#if active !== null}
				<div class="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md" style="left: {tipLeft}px" role="status" data-testid="{testid}-tip">
					<p class="font-medium">{categories[active]}</p>
					{#each series as s (s.key)}
						{#if s.values[active] !== null}
							<p class="flex items-center gap-1.5 tabular-nums"><span class="inline-block size-2 rounded-sm bg-current {s.cls}"></span>{s.label}: {format(s.values[active]!)}</p>
						{/if}
					{/each}
				</div>
			{/if}
		{/if}
	</div>

	{#if hasData}
		<div>
			<button type="button" class="text-xs text-muted-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-expanded={tableOpen} aria-controls="{uid}-table" onclick={() => (tableOpen = !tableOpen)} data-testid="{testid}-toggle">
				{tableOpen ? t('stats.table_hide') : t('stats.table_toggle')}
			</button>
			{#if tableOpen}
				<div class="mt-2 max-h-64 overflow-auto rounded-lg border" id="{uid}-table">
					<table class="w-full text-left text-xs tabular-nums" data-testid="{testid}-table">
						<caption class="sr-only">{title}</caption>
						<thead class="sticky top-0 bg-card">
							<tr>
								<th scope="col" class="px-2 py-1.5 font-medium">{t('stats.col.period')}</th>
								{#each series as s (s.key)}<th scope="col" class="px-2 py-1.5 font-medium">{s.label}</th>{/each}
							</tr>
						</thead>
						<tbody>
							{#each categories as c, i (i)}
								<tr class="border-t">
									<th scope="row" class="px-2 py-1 font-normal">{c}</th>
									{#each series as s (s.key)}<td class="px-2 py-1">{s.values[i] === null ? '–' : format(s.values[i]!)}</td>{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</figure>
