<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import DayDetail from '#lib/components/day/DayDetail.svelte';
	import DayNav from '#lib/components/time/DayNav.svelte';
	import { t } from '#lib/i18n/index.js';
	import { addDays, formatDateLong, isValidDate, todayLocal } from '#lib/time/dates.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';

	// Deep link target only (home, time list, calendar "open day"): all content and actions come from the shared DayDetail,
	// the same component as in the calendar inspector (P9).
	const date = $derived(page.params.date ?? '');
	const valid = $derived(isValidDate(date));
	const timeZone = $derived(zoneStore.value);
</script>

{#if !valid}
	<PageHeader title={t('day_detail.title')} />
	<Alert variant="destructive">{t('day_detail.invalid_date')}</Alert>
{:else}
	<PageHeader title={formatDateLong(date)} description={t('day_detail.description')} />
	<DayNav
		label={t('datenav.day_label')}
		prevHref="/time/{addDays(date, -1)}"
		nextHref="/time/{addDays(date, 1)}"
		todayHref="/time/{todayLocal(timeZone)}"
		{date}
		onpick={(picked) => goto(`/time/${picked}`)}
	/>
	{#key date}
		<DayDetail {date} heading={false} />
	{/key}
{/if}
