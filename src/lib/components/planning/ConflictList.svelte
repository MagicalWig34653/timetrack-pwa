<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import type { Conflict } from '#lib/planning/conflicts.js';
	import { absenceKindLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric } from '#lib/time/dates.js';

	let { conflicts, limit = 4 }: { conflicts: Conflict[]; limit?: number } = $props();

	/** One line per kind: "Feiertag (Name): 13.03." instead of a line per day. */
	const groups = $derived.by(() => {
		const map = new Map<string, { conflict: Conflict; dates: string[] }>();
		for (const c of conflicts) {
			const key = `${c.kind}:${c.detail ?? ''}`;
			const group = map.get(key) ?? { conflict: c, dates: [] };
			group.dates.push(c.date);
			map.set(key, group);
		}
		return [...map.values()];
	});

	function text(c: Conflict, dates: string[]): string {
		const list = dates.length > limit ? `${dates.slice(0, limit).map(formatDateNumeric).join(', ')} …` : dates.map(formatDateNumeric).join(', ');
		const detail = c.kind === 'absence_overlap' ? absenceKindLabel(c.detail as never) : (c.detail ?? '');
		return t(`conflict.${c.kind}`, { dates: list, count: dates.length, detail });
	}
</script>

<ul class="flex flex-col gap-1" aria-live="polite" data-testid="conflicts">
	{#each groups as { conflict, dates } (conflict.kind + (conflict.detail ?? ''))}
		<li class="rounded-md px-2 py-1 text-xs {conflict.severity === 'block' ? 'bg-destructive/10 text-destructive' : conflict.severity === 'warn' ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200' : 'bg-muted text-muted-foreground'}" data-severity={conflict.severity} data-conflict={conflict.kind}>
			{text(conflict, dates)}
		</li>
	{/each}
</ul>
