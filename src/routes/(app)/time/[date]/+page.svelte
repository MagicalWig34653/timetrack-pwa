<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import type { DayEvaluation, DayMarkKind, Place, Segment } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import DayNav from '#lib/components/time/DayNav.svelte';
	import DaySummary from '#lib/components/time/DaySummary.svelte';
	import DayTimeline from '#lib/components/time/DayTimeline.svelte';
	import SegmentForm from '#lib/components/time/SegmentForm.svelte';
	import SegmentList from '#lib/components/time/SegmentList.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { addDays, dayBounds, formatDateLong, isValidDate, todayLocal } from '#lib/time/dates.js';
	import { formatDuration, parseDuration } from '#lib/time/format.js';
	import { DAY_MARKS, markLabel } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	const date = $derived(page.params.date ?? '');
	const valid = $derived(isValidDate(date));
	const timeZone = $derived(zoneStore.value);

	let load = $state<LoadState>({ status: 'loading' });
	let now = $state(Date.now());
	let day = $state<DayEvaluation | null>(null);
	let segments = $state<Segment[]>([]);
	let places = $state<Place[]>([]);

	let adding = $state(false);
	let editingId = $state<string | null>(null);
	let voidingId = $state<string | null>(null);
	let voidReason = $state('');
	let voidError = $state('');
	let voidPending = $state(false);
	let notice = $state('');

	// day preferences
	let mark = $state<DayMarkKind>('none');
	let creditText = $state('');
	let skipFixedBreaks = $state(false);
	let note = $state('');
	let noteTouched = $state(false);
	let prefsError = $state('');
	let creditError = $state('');
	let prefsPending = $state(false);

	const revisionCount = $derived(segments.reduce((sum, s) => sum + (s.revisions ?? 0), 0));
	const activeSegments = $derived(segments.filter((s) => !s.voided));

	async function refresh() {
		if (!valid) return;
		try {
			const zone = await zoneStore.ensure();
			const { start, end } = dayBounds(date, zone);
			const [evaluation, list, placeList] = await Promise.all([
				api.getDay(date),
				api.listSegments(start.toISOString(), end.toISOString(), true),
				api.listPlaces()
			]);
			day = evaluation;
			segments = list;
			places = placeList;
			mark = evaluation.mark ?? 'none';
			skipFixedBreaks = !!evaluation.skipFixedBreaks;
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}

	// Reload whenever the route parameter changes.
	$effect(() => {
		void date;
		adding = false;
		editingId = null;
		voidingId = null;
		notice = '';
		creditText = '';
		note = '';
		noteTouched = false;
		void refresh();
	});

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});

	async function saved(message: string) {
		adding = false;
		editingId = null;
		notice = message;
		await refresh();
	}

	async function cancelForm() {
		adding = false;
		editingId = null;
		await refresh();
	}

	async function confirmVoid(event: Event) {
		event.preventDefault();
		if (voidPending || !voidingId) return;
		if (!voidReason.trim()) {
			voidError = t('segment_form.reason_required');
			return;
		}
		voidPending = true;
		voidError = '';
		try {
			await api.voidSegment(voidingId, voidReason.trim());
			voidingId = null;
			voidReason = '';
			notice = t('day_detail.voided');
			await refresh();
		} catch (e) {
			voidError = errorMessage(e);
		} finally {
			voidPending = false;
		}
	}

	async function savePreferences(event: Event) {
		event.preventDefault();
		if (prefsPending) return;
		prefsError = '';
		creditError = '';
		let creditSeconds: number | null = null;
		if (mark !== 'none' && creditText.trim()) {
			creditSeconds = parseDuration(creditText);
			if (creditSeconds === null || creditSeconds < 0) {
				creditError = t('day_prefs.credit_invalid');
				return;
			}
		}
		prefsPending = true;
		try {
			day = await api.setDayPreferences(date, {
				mark,
				creditSeconds: mark === 'none' ? null : creditSeconds,
				skipFixedBreaks,
				...(noteTouched ? { note: note.trim() || null } : {})
			});
			notice = t('day_prefs.saved');
			noteTouched = false;
		} catch (e) {
			prefsError = errorMessage(e);
		} finally {
			prefsPending = false;
		}
	}
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

	{#if load.status === 'loading'}
		<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
	{:else if load.status === 'unavailable'}
		<Unavailable />
	{:else if load.status === 'error'}
		<Alert variant="destructive">{load.message}</Alert>
	{:else}
		<div class="flex flex-col gap-4">
			{#if notice}<Alert variant="success">{notice}</Alert>{/if}

			<Card>
				<CardHeader>
					<CardTitle>{t('day_detail.evaluation')}</CardTitle>
					<CardDescription>{t('day_detail.evaluation_hint')}</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-5">
					{#if day}<DaySummary evaluation={day} />{/if}
					<DayTimeline {date} {timeZone} {segments} evaluation={day} {now} />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t('day_detail.segments')}</CardTitle>
					<CardDescription>
						{t('day_detail.revisions', { count: revisionCount })}
					</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					<SegmentList {segments} {places} {timeZone} {now}>
						{#snippet actions(segment: Segment)}
							{#if editingId === segment.id}
								<SegmentForm {segment} {date} {places} {timeZone} onsaved={() => saved(t('day_detail.corrected'))} oncancel={cancelForm} />
							{:else if voidingId === segment.id}
								<form class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" onsubmit={confirmVoid} novalidate aria-label={t('day_detail.void_title')}>
									<p class="text-sm font-medium">{t('day_detail.void_title')}</p>
									{#if voidError}<Alert variant="destructive">{voidError}</Alert>{/if}
									<Field id="void-reason" label={t('segment_form.reason')} hint={t('day_detail.void_hint')} bind:value={voidReason} maxlength={200} disabled={voidPending} required />
									<div class="flex gap-2">
										<Button type="submit" variant="destructive" size="sm" disabled={voidPending}>{t('day_detail.void_confirm')}</Button>
										<Button type="button" variant="outline" size="sm" onclick={() => { voidingId = null; voidError = ''; }}>{t('common.cancel')}</Button>
									</div>
								</form>
							{:else}
								<div class="flex gap-2">
									<Button variant="outline" size="sm" onclick={() => { editingId = segment.id; voidingId = null; adding = false; }}>{t('day_detail.correct')}</Button>
									<Button variant="ghost" size="sm" onclick={() => { voidingId = segment.id; voidReason = ''; editingId = null; adding = false; }}>{t('day_detail.void')}</Button>
								</div>
							{/if}
						{/snippet}
					</SegmentList>

					{#if adding}
						<SegmentForm {date} {places} {timeZone} onsaved={() => saved(t('day_detail.created'))} oncancel={cancelForm} />
					{:else}
						<div><Button variant="outline" onclick={() => { adding = true; editingId = null; voidingId = null; }}>{t('day_detail.add')}</Button></div>
					{/if}
					{#if activeSegments.length === 0 && !adding}
						<p class="text-xs text-muted-foreground">{t('day_detail.no_invention')}</p>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t('day_prefs.title')}</CardTitle>
					<CardDescription>{t('day_prefs.description')}</CardDescription>
				</CardHeader>
				<CardContent>
					<form class="flex flex-col gap-4" onsubmit={savePreferences} novalidate aria-label={t('day_prefs.title')}>
						{#if prefsError}<Alert variant="destructive">{prefsError}</Alert>{/if}
						<div class="grid gap-3 sm:grid-cols-2">
							<div class="flex flex-col gap-1.5">
								<Label for="day-mark">{t('day_prefs.mark')}</Label>
								<Select id="day-mark" bind:value={mark} disabled={prefsPending}>
									{#each DAY_MARKS as option (option)}<option value={option}>{markLabel(option)}</option>{/each}
								</Select>
							</div>
							{#if mark !== 'none'}
								<Field id="day-credit" label={t('day_prefs.credit')} hint={t('day_prefs.credit_hint')} placeholder="7:42" inputmode="numeric" bind:value={creditText} error={creditError} disabled={prefsPending} />
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<Checkbox id="day-skip-breaks" bind:checked={skipFixedBreaks} disabled={prefsPending} />
							<Label for="day-skip-breaks">{t('day_prefs.skip_breaks')}</Label>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="day-note">{t('day_prefs.note')}</Label>
							<Textarea id="day-note" bind:value={note} maxlength={200} oninput={() => (noteTouched = true)} disabled={prefsPending} />
							<p class="text-xs text-muted-foreground">{t('day_prefs.note_hint')}</p>
						</div>
						<div><Button type="submit" disabled={prefsPending}>{t('common.save')}</Button></div>
					</form>
				</CardContent>
			</Card>
		</div>
	{/if}
{/if}
