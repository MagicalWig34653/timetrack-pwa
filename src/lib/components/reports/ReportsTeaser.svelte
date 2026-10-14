<script lang="ts">
	import { api } from '#lib/api/client.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { t } from '#lib/i18n/index.js';
	import { isoWeekOf } from '#lib/reports/weeks.js';
	import { todayLocal } from '#lib/time/dates.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	let count = $state<number | null>(null);
	let current = $state({ year: 0, week: 0 });

	/** Loads on its own: while the server does not know the Berichtsheft (404/501) or fails, the card stays hidden. */
	onMount(() => {
		void (async () => {
			try {
				const zone = await zoneStore.ensure();
				const week = isoWeekOf(todayLocal(zone));
				const view = await api.getReportWeek(week.year, week.week);
				current = week;
				count = view.entries.length;
			} catch {
				count = null;
			}
		})();
	});
</script>

{#if count !== null}
	<Card data-testid="reports-teaser">
		<CardHeader>
			<CardTitle>{t('reports.teaser.title')}</CardTitle>
			<CardDescription>{t('reports.teaser.week', { week: current.week, year: current.year })}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-wrap items-center justify-between gap-3">
			<span class="text-sm" data-testid="reports-teaser-count">
				{count === 0 ? t('reports.teaser.entries_zero') : count === 1 ? t('reports.teaser.entries_one') : t('reports.teaser.entries_many', { count })}
			</span>
			<Button variant="outline" size="sm" href="/reports?year={current.year}&week={current.week}">{t('reports.teaser.open')}</Button>
		</CardContent>
	</Card>
{/if}
