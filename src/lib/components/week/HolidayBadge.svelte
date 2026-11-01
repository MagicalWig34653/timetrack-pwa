<script lang="ts">
	import Flag from '@lucide/svelte/icons/flag';
	import { holidayHint } from '#lib/planning/company-days.js';
	import { MARK_CLASSES } from '#lib/week/overview.js';

	/**
	 * Name chip of a holiday. A half company day (contract 0.32.0) keeps the mark "work", so it never relies on the mark or the
	 * colour alone: flag icon with a "½" and a dashed outline, the tooltip says that the target is halved.
	 */
	let { name, treatment = null, class: className = '', testid = 'holiday-badge' }: { name: string; treatment?: 'half' | 'full' | null; class?: string; testid?: string } = $props();
	const half = $derived(treatment === 'half');
</script>

<span
	class="inline-flex h-5 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium {MARK_CLASSES.holiday} {half ? 'half-day' : ''} {className}"
	title={holidayHint(name, treatment)}
	data-testid={testid}
	data-treatment={treatment ?? undefined}
>
	<Flag class="size-3 shrink-0" aria-hidden="true" /><span class="truncate">{name}</span>{#if half}<span aria-hidden="true" class="font-normal">½</span><span class="sr-only">{holidayHint(name, treatment)}</span>{/if}
</span>

<style>
	.half-day {
		border: 1px dashed currentColor;
	}
</style>
