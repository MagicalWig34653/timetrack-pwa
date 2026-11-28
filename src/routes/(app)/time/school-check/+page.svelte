<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { DayMarkKind, Place, Segment } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import SchoolDayBooking from '#lib/components/time/SchoolDayBooking.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { addDays, dayBounds, formatDateLong, isoWeekLabel, localDateOf, localTimeOf, startOfWeek, todayLocal } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { schoolCheckItems, type SchoolCheckItem } from '#lib/time/school.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	/**
	 * "Schultage prüfen" (docs/ux/schulzeit.md, section 5): earlier school days that are probably booked the wrong way.
	 * Nothing changes by itself; each row is fixed only after a confirmation, corrections keep their revision.
	 */
	const WEEKS = 8;
	const STORE_KEY = 'timetrack.school-check.dismissed';

	let load = $state<LoadState>({ status: 'loading' });
	let items = $state<SchoolCheckItem[]>([]);
	let places = $state<Place[]>([]);
	let segments = $state<Segment[]>([]);
	let dismissed = $state<string[]>([]);
	let confirming = $state<string | null>(null);
	let pending = $state(false);
	let notice = $state('');
	let error = $state('');
	const timeZone = $derived(zoneStore.value);

	const visible = $derived(items.filter((i) => !dismissed.includes(i.key)));

	function readDismissed(): string[] {
		try {
			const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
			return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
		} catch {
			return [];
		}
	}

	async function refresh() {
		try {
			const zone = await zoneStore.ensure();
			const today = todayLocal(zone);
			const firstMonday = addDays(startOfWeek(today), -7 * (WEEKS - 1));
			const weekLabels = Array.from({ length: WEEKS }, (_, n) => isoWeekLabel(addDays(firstMonday, 7 * n)));
			const [weeks, list, placeList] = await Promise.all([
				Promise.all(weekLabels.map((w) => api.getTimeWeek(w))),
				api.listSegments(dayBounds(firstMonday, zone).start.toISOString(), dayBounds(today, zone).end.toISOString()),
				api.listPlaces()
			]);
			const days = weeks.flatMap((w) => w.days).filter((d) => d.date <= today);
			// only days that are over: today can still be booked as usual
			const past = days.filter((d) => d.date < today);
			// the week view reports an old school-credit day as mark "school" without school time
			const marks: Record<string, DayMarkKind> = {};
			for (const d of past) if (d.mark === 'school' && d.schoolSeconds === 0) marks[d.date] = 'school_credit';
			segments = list;
			places = placeList;
			items = schoolCheckItems(past, marks, list.filter((s) => localDateOf(s.startedAt, zone) < today), placeList, zone);
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}

	async function done(message: string) {
		notice = message;
		confirming = null;
		await refresh();
	}

	async function changeKind(item: SchoolCheckItem) {
		const segment = segments.find((s) => s.id === item.segmentId);
		if (!segment || pending) return;
		pending = true;
		error = '';
		try {
			await api.correctSegment(segment.id, { kind: 'school', reason: t('school.check.change_reason') }, segment.version);
			await done(t('school.check.changed'));
		} catch (e) {
			error = errorMessage(e);
			await refresh();
		} finally {
			pending = false;
		}
	}

	function leaveAll() {
		dismissed = [...new Set([...dismissed, ...items.map((i) => i.key)])];
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(dismissed));
		} catch {
			/* hidden for this visit only */
		}
		notice = t('school.check.left');
	}

	const label = (item: SchoolCheckItem) => {
		if (item.type !== 'work_at_school') return t(`school.check.${item.type}`);
		const segment = segments.find((s) => s.id === item.segmentId);
		const place = places.find((p) => p.id === segment?.placeId);
		const span = segment?.endedAt ? ` · ${localTimeOf(segment.startedAt, timeZone)}–${localTimeOf(segment.endedAt, timeZone)}` : '';
		return t('school.check.work_at_school', { place: place?.name ?? '' }) + span;
	};

	onMount(() => {
		dismissed = readDismissed();
		void refresh();
	});
</script>

<PageHeader title={t('school.check_title')} description={t('school.check_description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		<Card>
			<CardHeader>
				<CardTitle>{t('school.check_title')} ({visible.length})</CardTitle>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if visible.length === 0}
					<p class="text-sm text-muted-foreground" data-testid="school-check-empty">{t('school.check_empty')}</p>
				{:else}
					<ul class="flex flex-col divide-y" data-testid="school-check-list">
						{#each visible as item (item.key)}
							<li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="school-check-item" data-type={item.type} data-date={item.date}>
								<div class="flex flex-col gap-0.5">
									<a class="text-sm font-medium underline-offset-2 hover:underline" href="/time/{item.date}">{formatDateLong(item.date)}</a>
									<span class="text-sm text-muted-foreground">{label(item)}</span>
								</div>
								<div class="flex flex-col gap-2 sm:items-end">
									{#if item.type === 'work_at_school'}
										{#if confirming === item.key}
											<div class="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:max-w-sm">
												<p>{t('school.check.change_confirm')}</p>
												<div class="flex flex-wrap gap-2">
													<Button size="sm" onclick={() => changeKind(item)} disabled={pending} aria-busy={pending}>{t('school.check.change_do')}</Button>
													<Button size="sm" variant="outline" onclick={() => (confirming = null)}>{t('common.cancel')}</Button>
												</div>
											</div>
										{:else}
											<Button size="sm" variant="outline" onclick={() => (confirming = item.key)}>{t('school.check.change_kind')}</Button>
										{/if}
									{:else}
										<SchoolDayBooking date={item.date} {places} {timeZone} size="sm" variant="outline" label={item.type === 'credit_without_times' ? t('school.book_times') : t('school.book')} onsaved={done} />
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					<div><Button variant="ghost" size="sm" onclick={leaveAll}>{t('school.check.leave')}</Button></div>
				{/if}
			</CardContent>
		</Card>
	</div>
{/if}
