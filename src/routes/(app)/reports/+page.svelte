<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import type { LearningField, ReportEntry, ReportStatus, ReportWeek } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Toast from '#lib/components/app/Toast.svelte';
	import EntryForm from '#lib/components/reports/EntryForm.svelte';
	import SourcesPanel from '#lib/components/reports/SourcesPanel.svelte';
	import TextPreviewDialog from '#lib/components/reports/TextPreviewDialog.svelte';
	import WeekNavigator from '#lib/components/reports/WeekNavigator.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { copyText } from '#lib/browser.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { isoWeekOf, isValidIsoWeek, weekDates, type IsoWeek } from '#lib/reports/weeks.js';
	import { dayBounds, formatDateLong, formatDateNumeric, todayLocal } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import ClipboardIcon from '@lucide/svelte/icons/clipboard-copy';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let today = $state<IsoWeek>(isoWeekOf(todayLocal()));
	let shown = $state<IsoWeek>(isoWeekOf(todayLocal()));
	let week = $state<ReportWeek | null>(null);
	let fields = $state<LearningField[]>([]);
	let adding = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let actionError = $state('');
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let copying = $state(false);
	let dialogOpen = $state(false);
	let dialogText = $state('');
	let dialogFallback = $state(false);
	let statusBusy = $state(false);
	let requestId = 0;

	const dates = $derived(weekDates(shown.year, shown.week));
	const todayDate = $derived(todayLocal(zoneStore.value));
	const entriesByDay = $derived(
		new Map(dates.map((d) => [d, (week?.entries ?? []).filter((e) => e.date === d)]))
	);
	const lastField = $derived([...(week?.entries ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)?.learningField ?? '');

	function say(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 4000);
	}

	async function loadWeek(target: IsoWeek, quiet = false) {
		const id = ++requestId;
		if (!quiet) load = { status: 'loading' };
		try {
			const [view, list] = await Promise.all([api.getReportWeek(target.year, target.week), api.listLearningFields().catch(() => fields)]);
			if (id !== requestId) return;
			week = view;
			fields = list;
			load = { status: 'ready' };
		} catch (error) {
			if (id === requestId) load = toLoadState(error);
		}
	}

	function select(target: IsoWeek) {
		shown = target;
		adding = editingId = deletingId = null;
		actionError = '';
		void goto(`/reports?year=${target.year}&week=${target.week}`, { replace: true, shallow: true });
		void loadWeek(target);
	}

	onMount(() => {
		void (async () => {
			const zone = await zoneStore.ensure().catch(() => undefined);
			today = isoWeekOf(todayLocal(zone ?? zoneStore.value));
			const year = Number(page.url.searchParams.get('year'));
			const wk = Number(page.url.searchParams.get('week'));
			shown = isValidIsoWeek(year, wk) ? { year, week: wk } : today;
			await loadWeek(shown);
		})();
		return () => clearTimeout(toastTimer);
	});

	function saved() {
		adding = editingId = null;
		say(t('reports.entry.saved'));
		void loadWeek(shown, true);
	}

	async function reloadEntry(id: string): Promise<ReportEntry | null> {
		const view = await api.getReportWeek(shown.year, shown.week);
		week = view;
		// the entry may also have moved to another week; then it is gone from this view
		return view.entries.find((e) => e.id === id) ?? null;
	}

	async function removeEntry(entry: ReportEntry) {
		actionError = '';
		try {
			await api.deleteReportEntry(entry.id);
			deletingId = null;
			say(t('reports.entry.deleted'));
			await loadWeek(shown, true);
		} catch (e) {
			actionError = errorMessage(e);
		}
	}

	async function setStatus(status: ReportStatus) {
		if (!week || week.status === status || statusBusy) return;
		statusBusy = true;
		actionError = '';
		try {
			week = await api.putReportWeekStatus(shown.year, shown.week, status);
		} catch (e) {
			actionError = errorMessage(e);
		} finally {
			statusBusy = false;
		}
	}

	async function copyWeek() {
		if (copying) return;
		copying = true;
		actionError = '';
		try {
			const text = await api.getReportWeekText(shown.year, shown.week);
			dialogText = text;
			if (await copyText(text)) say(t('reports.copy.done'));
			else {
				dialogFallback = true;
				dialogOpen = true;
			}
		} catch (e) {
			actionError = errorMessage(e);
		} finally {
			copying = false;
		}
	}

	async function preview() {
		actionError = '';
		try {
			dialogText = await api.getReportWeekText(shown.year, shown.week);
			dialogFallback = false;
			dialogOpen = true;
		} catch (e) {
			actionError = errorMessage(e);
		}
	}

	const statusLabel = (s: ReportStatus) => t(s === 'done' ? 'reports.status.done' : 'reports.status.draft');
</script>

<PageHeader title={t('reports.title')} description={t('reports.description')} />

{#if load.status === 'unavailable'}
	<Alert variant="warning" data-testid="reports-unavailable">{t('reports.unavailable')}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<WeekNavigator current={shown} {today} onselect={select} />

		{#if load.status === 'loading'}
			<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
		{:else if load.status === 'error'}
			<Alert variant="destructive">{load.message}</Alert>
		{:else if week}
			{#if actionError}<Alert variant="destructive" data-testid="reports-error">{actionError}</Alert>{/if}

			<Card>
				<CardHeader>
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div>
							<CardTitle>{t('reports.total')}</CardTitle>
							<CardDescription>
								<span class="text-2xl font-semibold tabular-nums text-foreground" data-testid="week-total">{formatDuration(week.totalSeconds)} h</span>
							</CardDescription>
						</div>
						<Badge variant={week.status === 'done' ? 'default' : 'secondary'} data-testid="week-status-badge">{statusLabel(week.status)}</Badge>
					</div>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					<div>
						<h3 class="mb-1 text-sm font-medium">{t('reports.by_field')}</h3>
						{#if week.byLearningField.length === 0}
							<p class="text-sm text-muted-foreground">{t('reports.by_field_empty')}</p>
						{:else}
							<ul class="flex flex-col gap-1 text-sm" data-testid="by-field">
								{#each week.byLearningField as row (row.learningField)}
									<li class="flex justify-between gap-3" data-testid="by-field-row">
										<span class="min-w-0 break-words">{row.learningField}</span>
										<span class="tabular-nums">{formatDuration(row.seconds)} h</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					{#if week.trackedWorkSeconds !== undefined}
						<div class="rounded-md border bg-muted/40 p-3 text-sm" data-testid="tracked-hint">
							<p class="font-medium">{t('reports.tracked', { duration: formatDuration(week.trackedWorkSeconds) })}</p>
							<p class="text-xs text-muted-foreground">{t('reports.tracked_note')}</p>
						</div>
					{/if}

					<div role="group" aria-label={t('reports.status.label')} class="flex flex-col gap-1">
						<div class="flex flex-wrap gap-2">
							{#each ['draft', 'done'] as const as status (status)}
								<Button type="button" size="sm" variant={week.status === status ? 'default' : 'outline'} aria-pressed={week.status === status} disabled={statusBusy} onclick={() => setStatus(status)} data-testid="status-{status}">
									{statusLabel(status)}
								</Button>
							{/each}
						</div>
						<p class="text-xs text-muted-foreground">{t('reports.status.hint')}</p>
					</div>

					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<Button size="lg" class="w-full sm:w-auto" disabled={copying || week.entries.length === 0} onclick={copyWeek} data-testid="copy-text">
							<ClipboardIcon />{copying ? t('reports.copy.busy') : t('reports.copy.button')}
						</Button>
						<Button variant="outline" size="lg" class="w-full sm:w-auto" disabled={week.entries.length === 0} onclick={preview} data-testid="copy-preview">{t('reports.copy.preview')}</Button>
					</div>
					{#if week.entries.length === 0}<p class="text-xs text-muted-foreground">{t('reports.copy.empty')}</p>{/if}
				</CardContent>
			</Card>

			<div class="flex flex-col gap-3">
				{#each dates as date (date)}
					{@const entries = entriesByDay.get(date) ?? []}
					{@const dayTotal = entries.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0)}
					<section class="rounded-lg border bg-card p-4" aria-labelledby="day-{date}" data-testid="day" data-date={date} aria-current={date === todayDate ? 'date' : undefined}>
						<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
							<h3 id="day-{date}" class="text-sm font-semibold">{formatDateLong(date)}</h3>
							{#if entries.length > 0}<span class="text-xs tabular-nums text-muted-foreground">{t('reports.day.total', { duration: formatDuration(dayTotal) })}</span>{/if}
						</div>

						{#if entries.length === 0 && adding !== date}
							<p class="mb-2 text-sm text-muted-foreground">{t('reports.day.empty')}</p>
						{/if}
						<ul class="flex flex-col gap-2">
							{#each entries as entry (entry.id)}
								<li class="rounded-md border bg-background p-3 text-sm" data-testid="entry">
									{#if editingId === entry.id}
										<EntryForm {entry} {date} {dates} {fields} onsaved={saved} oncancel={() => (editingId = null)} onreload={() => reloadEntry(entry.id)} />
									{:else}
										<div class="flex flex-wrap items-baseline justify-between gap-2">
											<span class="min-w-0 break-words font-medium" data-testid="entry-learning-field">
												{entry.learningField}
												{#if entry.draft}<Badge variant="secondary" class="ml-1">{t('reports.entry.draft_badge')}</Badge>{/if}
											</span>
											<span class="tabular-nums" data-testid="entry-duration-shown">{formatDuration(entry.durationSeconds ?? 0)} h</span>
										</div>
										{#if entry.notes}
											<p class="mt-1 break-words whitespace-pre-wrap text-muted-foreground" data-testid="entry-notes-shown">{entry.notes}</p>
										{/if}
										{#if deletingId === entry.id}
											<Alert variant="warning" class="mt-3" data-testid="entry-delete-confirm">
												<p>{t('reports.entry.delete_confirm', { name: entry.learningField, date: formatDateNumeric(entry.date) })}</p>
												<div class="mt-2 flex flex-wrap gap-2">
													<Button type="button" size="sm" variant="destructive" onclick={() => removeEntry(entry)} data-testid="entry-delete-yes">{t('reports.entry.delete_yes')}</Button>
													<Button type="button" size="sm" variant="outline" onclick={() => (deletingId = null)}>{t('common.cancel')}</Button>
												</div>
											</Alert>
										{:else}
											<div class="mt-2 flex flex-wrap gap-2">
												<Button type="button" size="sm" variant="outline" aria-label={t('reports.entry.edit_label', { name: entry.learningField })} onclick={() => ((editingId = entry.id), (adding = null), (deletingId = null))}>{t('reports.entry.edit')}</Button>
												<Button type="button" size="sm" variant="ghost" aria-label={t('reports.entry.delete_label', { name: entry.learningField })} onclick={() => (deletingId = entry.id)}>{t('reports.entry.delete')}</Button>
											</div>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>

						{#if adding === date}
							<div class="mt-3">
								<EntryForm {date} {dates} {fields} defaultField={lastField} onsaved={saved} oncancel={() => (adding = null)} onreload={async () => null} />
							</div>
						{:else}
							<div class="mt-3">
								<Button type="button" variant="outline" size="sm" aria-label={t('reports.day.add_label', { date: formatDateLong(date) })} onclick={() => ((adding = date), (editingId = null))} data-testid="add-entry">{t('reports.day.add')}</Button>
							</div>
						{/if}
					</section>
				{/each}
			</div>

			<SourcesPanel year={shown.year} week={shown.week} onchange={(count) => week && (week.sourceCount = count)} />
		{/if}
	</div>
{/if}

<TextPreviewDialog bind:open={dialogOpen} text={dialogText} fallback={dialogFallback} oncopied={() => say(t('reports.copy.done'))} />
<Toast message={toast} />
