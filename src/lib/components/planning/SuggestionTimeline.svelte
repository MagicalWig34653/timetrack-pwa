<script lang="ts">
	import type { VacationSuggestion } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDateShort } from '#lib/time/dates.js';
	import { timelineCells, type TimelineKind } from '#lib/vacation/planner.js';

	let { suggestion }: { suggestion: VacationSuggestion } = $props();

	const cells = $derived(timelineCells(suggestion));
	// Fill and outline carry the meaning together with the letter/number, so colour is never the only signal.
	const KIND_CLASS: Record<TimelineKind, string> = {
		vacation: 'border-primary bg-primary text-primary-foreground',
		holiday: 'border-amber-500/70 bg-amber-500/20 text-amber-900 dark:text-amber-100',
		weekend: 'border-transparent bg-muted text-muted-foreground',
		booked: 'border-emerald-600/70 border-dashed bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
		free: 'border-transparent bg-muted text-muted-foreground'
	};
</script>

<div data-testid="suggestion-timeline" class="flex flex-col gap-2">
	<ul
		class="flex flex-wrap gap-1"
		aria-label={t('planner.timeline_label', { start: formatDateShort(suggestion.start), end: formatDateShort(suggestion.end) })}
	>
		{#each cells as cell (cell.date)}
			<li
				data-kind={cell.kind}
				data-date={cell.date}
				data-conflict={cell.conflict ?? undefined}
				title={cell.label}
				aria-label={cell.label}
				class="relative flex h-11 w-8 flex-col items-center justify-center rounded-md border text-[0.65rem] leading-tight {KIND_CLASS[cell.kind]}"
			>
				<span aria-hidden="true" class="opacity-80">{cell.weekday}</span>
				<span aria-hidden="true" class="text-xs font-semibold tabular-nums">{cell.day}</span>
				{#if cell.conflict}
					<span aria-hidden="true" class="absolute -top-1 -right-1 size-2.5 rounded-full border border-background bg-destructive"></span>
				{/if}
			</li>
		{/each}
	</ul>
</div>
