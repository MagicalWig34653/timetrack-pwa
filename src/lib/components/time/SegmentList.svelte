<script lang="ts">
	import { contextmenu, type MenuEntry } from '#lib/a11y/context-menu.svelte.js';
	import type { Place, Segment } from '#lib/api/types.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { t } from '#lib/i18n/index.js';
	import { localTimeOf } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { isCorrected, kindLabel, sourceLabel } from '#lib/time/labels.js';
	import type { Snippet } from 'svelte';

	let {
		segments,
		places,
		timeZone,
		now,
		actions,
		menuFor
	}: {
		segments: Segment[];
		places: Place[];
		timeZone: string;
		now: number;
		actions?: Snippet<[Segment]>;
		/** right-click / long-press menu of a row (P9); without it the system menu stays */
		menuFor?: (segment: Segment) => MenuEntry[] | null;
	} = $props();

	const sorted = $derived([...segments].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)));
	const placeName = (id?: string | null) => (id ? (places.find((p) => p.id === id)?.name ?? t('place.archived_or_unknown')) : null);

	type Row = { type: 'segment'; segment: Segment } | { type: 'gap'; start: string; end: string; seconds: number };
	const rows = $derived.by(() => {
		const out: Row[] = [];
		let previous: Segment | undefined;
		for (const segment of sorted) {
			if (!segment.voided) {
				if (previous?.endedAt && Date.parse(segment.startedAt) > Date.parse(previous.endedAt)) {
					out.push({
						type: 'gap',
						start: previous.endedAt,
						end: segment.startedAt,
						seconds: (Date.parse(segment.startedAt) - Date.parse(previous.endedAt)) / 1000
					});
				}
				previous = segment;
			}
			out.push({ type: 'segment', segment });
		}
		return out;
	});
	const range = (a: string, b: string | null) => `${localTimeOf(a, timeZone)}–${b ? localTimeOf(b, timeZone) : t('timeline.running')}`;
	const seconds = (s: Segment) => Math.max(0, ((s.endedAt ? Date.parse(s.endedAt) : now) - Date.parse(s.startedAt)) / 1000);
</script>

{#if rows.length === 0}
	<p class="text-sm text-muted-foreground">{t('segments.empty')}</p>
{:else}
	<ul class="flex flex-col gap-2" data-testid="segment-list">
		{#each rows as row (row.type === 'segment' ? row.segment.id : `gap-${row.start}`)}
			{#if row.type === 'gap'}
				<li class="flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground" data-testid="gap-row">
					<span class="tabular-nums">{range(row.start, row.end)}</span>
					<span>{t('segments.pause', { duration: formatDuration(row.seconds) })}</span>
				</li>
			{:else}
				{@const s = row.segment}
				<li class="rounded-lg border bg-card px-3 py-2 {s.voided ? 'opacity-60' : ''}" data-testid="segment-row" use:contextmenu={() => menuFor?.(s) ?? null}>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="font-medium tabular-nums {s.voided ? 'line-through' : ''}">{range(s.startedAt, s.endedAt)}</span>
						<span class="tabular-nums text-sm text-muted-foreground">{formatDuration(seconds(s))}</span>
						<Badge variant="outline">{kindLabel(s.kind)}</Badge>
						{#if placeName(s.placeId)}<span class="text-sm text-muted-foreground">{placeName(s.placeId)}</span>{/if}
						{#if !s.endedAt && !s.voided}<Badge variant="secondary">{t('timer.running')}</Badge>{/if}
						{#if s.voided}<Badge variant="destructive">{t('segments.voided')}</Badge>{/if}
						{#if s.needsReview}<Badge variant="outline">{t('segments.needs_review')}</Badge>{/if}
					</div>
					<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<span>{sourceLabel(s.source)}</span>
						{#if isCorrected(s)}
							<span>{t('segments.raw', { range: range(s.rawStartedAt, s.rawEndedAt) })}</span>
						{/if}
						{#if (s.revisions ?? 0) > 0}<span>{t('segments.revisions', { count: s.revisions ?? 0 })}</span>{/if}
						{#if s.note}<span>{s.note}</span>{/if}
					</div>
					{#if actions && !s.voided}<div class="mt-2">{@render actions(s)}</div>{/if}
				</li>
			{/if}
		{/each}
	</ul>
{/if}
