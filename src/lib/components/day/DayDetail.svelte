<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { Absence, CalendarDay, DayEvaluation, Place, PlanDay } from '#lib/api/types.js';
	import DayPanel from '#lib/components/planning/DayPanel.svelte';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { dayInfo } from '#lib/planning/calendar.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDateLong } from '#lib/time/dates.js';
	import { untrack } from 'svelte';
	import DayTimeSections from './DayTimeSections.svelte';

	/**
	 * The one day detail of the app (P9): planning (holidays, absences, plan, custom days) on top, time tracking
	 * (evaluation, segments, day settings) below. Used by the calendar inspector and by the deep link /time/<date>,
	 * so both show the same actions, texts and forms.
	 */
	let {
		date,
		places = null,
		heading = true,
		refresh = 0,
		onchanged,
		onclose
	}: { date: string; places?: Place[] | null; heading?: boolean; /** bumped by the host after it wrote something that affects this day */ refresh?: number; onchanged?: () => void; onclose?: () => void } = $props();

	let holidays = $state<CalendarDay[]>([]);
	let absences = $state<Absence[]>([]);
	let plan = $state<PlanDay[]>([]);
	let evaluation = $state<DayEvaluation | null>(null);
	let ownPlaces = $state<Place[]>([]);
	let planningReady = $state(false);
	let planningOff = $state(false);
	let token = $state(0);
	/** bumped by planning changes: an absence changes the day's target, so the time half reloads */
	let planVersion = $state(0);

	$effect(() => {
		const day = date;
		void token;
		void refresh;
		planningOff = !moduleStore.enabled('planning');
		void (async () => {
			try {
				const [h, a, p, pl] = await Promise.all([
					api.listHolidays(Number(day.slice(0, 4))),
					api.listAbsences(day, day),
					api.listPlanDays(day, day),
					places ? Promise.resolve(places) : api.listPlaces().catch(() => [] as Place[])
				]);
				if (day !== date) return;
				holidays = h;
				absences = a;
				plan = p;
				ownPlaces = pl.filter((x) => !x.archived);
				planningReady = true;
			} catch {
				// Planning data is optional here: the time-tracking half stays usable without it.
				if (day === date) planningReady = false;
			}
		})();
	});

	const info = $derived(dayInfo(date, { holidays, absences, plan, days: evaluation ? [evaluation] : [] }));

	function planningChanged() {
		untrack(() => {
			token += 1;
			planVersion += 1;
		});
		onchanged?.();
	}
</script>

<div class="flex flex-col gap-4" data-testid="day-detail" data-date={date}>
	{#if !planningOff && planningReady}
		<DayPanel {info} places={places ?? ownPlaces} {heading} {onclose} onchanged={planningChanged} />
	{:else if heading}
		<h2 class="text-lg font-medium">{formatDateLong(date)}</h2>
	{/if}
	<DayTimeSections {date} reload={planVersion + refresh} onchanged={() => onchanged?.()} />
</div>
