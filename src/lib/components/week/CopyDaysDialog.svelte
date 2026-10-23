<script lang="ts">
	import type { PlanWeekDay } from '#lib/api/types.js';
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { weekdayLabel } from '#lib/time/labels.js';

	/** Picks the days that receive a copy of one block ("Auf andere Tage kopieren"). */
	let {
		days,
		sourceDate,
		anchor = null,
		returnFocus = null,
		onsubmit,
		onclose
	}: { days: PlanWeekDay[]; sourceDate: string; anchor?: DOMRect | null; returnFocus?: HTMLElement | null; onsubmit: (dates: string[]) => void; onclose: () => void } = $props();

	let chosen = $state<string[]>([]);
	const candidates = $derived(days.filter((d) => d.date !== sourceDate));
	const toggle = (date: string, on: boolean) => (chosen = on ? [...chosen, date] : chosen.filter((d) => d !== date));
	const workdays = () => (chosen = candidates.filter((d) => d.blockedBy === null && d.targetSeconds > 0).map((d) => d.date));
</script>

<FloatingPanel titleId="cd-title" {anchor} {returnFocus} {onclose} width={360} data-testid="copy-days-dialog">
	<form
		class="flex flex-col gap-4 p-5"
		aria-labelledby="cd-title"
		onsubmit={(e) => {
			e.preventDefault();
			if (chosen.length) onsubmit(chosen);
		}}
	>
		<div>
			<h2 id="cd-title" class="text-lg leading-tight font-semibold">{t('wg.copy_days_title')}</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">{t('wg.copy_days_hint')}</p>
		</div>
		<ul class="grid grid-cols-2 gap-x-3 gap-y-2">
			{#each candidates as day (day.date)}
				<li>
					<label class="flex items-center gap-2 text-sm {day.blockedBy ? 'text-muted-foreground' : ''}">
						<Checkbox checked={chosen.includes(day.date)} disabled={day.blockedBy !== null} onchange={(e) => toggle(day.date, e.currentTarget.checked)} data-testid="copy-day-{day.date}" />
						{weekdayLabel(day.weekday)} {formatDateNumeric(day.date).slice(0, 6)}{day.blockedBy ? ` (${t(`weekview.mark.${day.blockedBy}`)})` : ''}
					</label>
				</li>
			{/each}
		</ul>
		<div class="flex flex-wrap items-center justify-end gap-2">
			<Button type="button" variant="ghost" class="mr-auto" onclick={workdays}>{t('wg.copy_days_workdays')}</Button>
			<Button type="button" variant="ghost" onclick={onclose}>{t('wg.cancel')}</Button>
			<Button type="submit" disabled={chosen.length === 0} data-testid="copy-days-submit">{t('wg.copy_days_submit')}</Button>
		</div>
	</form>
</FloatingPanel>
