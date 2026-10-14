<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { Absence, AbsenceKind, AbsenceStatus } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import AbsenceForm from '#lib/components/planning/AbsenceForm.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { ABSENCE_CLASSES, ABSENCE_KINDS, ABSENCE_STATUSES, absenceKindLabel, absenceStatusLabel, documentStatusLabel } from '#lib/planning/labels.js';
	import { formatDateNumeric, todayLocal } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { formatHalfDays } from '#lib/vacation/halfdays.js';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let year = $state(Number(todayLocal(zoneStore.value).slice(0, 4)));
	let absences = $state<Absence[]>([]);
	let statusFilter = $state<'all' | AbsenceStatus>('all');
	let kindFilter = $state<'all' | AbsenceKind>('all');
	let editing = $state<Absence | 'new' | null>(null);
	let notice = $state('');
	let error = $state('');
	let today = $state(todayLocal(zoneStore.value));

	async function refresh() {
		try {
			today = todayLocal(await zoneStore.ensure());
			absences = await api.listAbsences(`${year}-01-01`, `${year}-12-31`);
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	const visible = $derived(
		absences.filter((a) => (statusFilter === 'all' || a.status === statusFilter) && (kindFilter === 'all' || a.kind === kindFilter))
	);

	function shiftYear(delta: number) {
		year += delta;
		editing = null;
		void refresh();
	}

	async function saved() {
		editing = null;
		notice = t('absence.saved');
		error = '';
		await refresh();
	}

	async function remove(absence: Absence) {
		error = '';
		notice = '';
		try {
			await api.deleteAbsence(absence.id);
			notice = t('absence.deleted');
			await refresh();
		} catch (e) {
			error = errorMessage(e);
		}
	}

	/** 412: continue with the current server version of just this absence (GET absences/{id}). */
	async function reopenFresh(fresh: Absence | null) {
		notice = '';
		if (!fresh) {
			editing = null;
			await refresh();
			return;
		}
		absences = absences.map((a) => (a.id === fresh.id ? fresh : a));
		editing = fresh;
	}

	const countsNot = (a: Absence) => a.status === 'rejected' || a.status === 'cancelled';
</script>

<PageHeader title={t('absences.title')} description={t('absences.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-end gap-3">
			<nav class="flex items-center gap-2" aria-label={t('vacation.year_nav')}>
				<Button variant="outline" size="icon" aria-label={t('vacation.previous_year')} onclick={() => shiftYear(-1)}><ChevronLeft /></Button>
				<span class="min-w-16 text-center font-medium tabular-nums" data-testid="absences-year">{year}</span>
				<Button variant="outline" size="icon" aria-label={t('vacation.next_year')} onclick={() => shiftYear(1)}><ChevronRight /></Button>
			</nav>
			<div class="flex flex-col gap-1.5">
				<Label for="filter-status">{t('absences.filter_status')}</Label>
				<Select id="filter-status" bind:value={statusFilter} class="w-44">
					<option value="all">{t('absences.filter_all')}</option>
					{#each ABSENCE_STATUSES as option (option)}<option value={option}>{absenceStatusLabel(option)}</option>{/each}
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="filter-kind">{t('absences.filter_kind')}</Label>
				<Select id="filter-kind" bind:value={kindFilter} class="w-44">
					<option value="all">{t('absences.filter_all')}</option>
					{#each ABSENCE_KINDS as option (option)}<option value={option}>{absenceKindLabel(option)}</option>{/each}
				</Select>
			</div>
			<Button class="sm:ml-auto" onclick={() => (editing = 'new')}>{t('absence.create_title')}</Button>
		</div>

		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}

		{#if editing === 'new'}
			<AbsenceForm date={today} onsaved={saved} oncancel={() => (editing = null)} />
		{/if}

		{#if visible.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="absences-empty">{t('absences.empty')}</p>
		{:else}
			<ul class="flex flex-col gap-3" data-testid="absence-list">
				{#each visible as absence (absence.id)}
					<li>
						<Card data-testid="absence-row">
							<CardContent class="flex flex-col gap-3">
								{#if editing !== null && editing !== 'new' && editing.id === absence.id}
									{#key absence.version}<AbsenceForm {absence} date={absence.startDate} onsaved={saved} oncancel={() => (editing = null)} onstale={reopenFresh} />{/key}
								{:else}
									<div class="flex flex-wrap items-center gap-2">
										<span class="rounded px-2 py-0.5 text-sm font-medium {ABSENCE_CLASSES[absence.kind]}">{absenceKindLabel(absence.kind)}</span>
										<Badge variant={countsNot(absence) ? 'outline' : 'secondary'} data-testid="absence-status">{absenceStatusLabel(absence.status)}</Badge>
										<span class="tabular-nums">
											{formatDateNumeric(absence.startDate)}{#if absence.endDate !== absence.startDate}–{formatDateNumeric(absence.endDate)}{/if}
										</span>
									</div>
									<p class="text-sm text-muted-foreground" data-testid="absence-counted">
										{#if countsNot(absence)}
											{t('absence.counts_not')}
										{:else if absence.kind === 'vacation'}
											{t('absence.counted', { days: formatHalfDays(absence.countedHalfDays) })}
										{:else}
											{t('absence.no_vacation_use')}
										{/if}
										{#if absence.halfDayStart} · {t('absence.half_start')}{/if}
										{#if absence.halfDayEnd} · {t('absence.half_end')}{/if}
									</p>
									{#if absence.kind !== 'vacation' && absence.documentStatus && absence.documentStatus !== 'not_needed'}
										<p class="text-sm text-muted-foreground">
											{t('absence.document_line', { status: documentStatusLabel(absence.documentStatus) })}
											{#if absence.documentSubmittedOn} · {t('absence.document_submitted_line', { date: formatDateNumeric(absence.documentSubmittedOn) })}{/if}
											{#if absence.documentReferenceStart && absence.documentReferenceEnd} · {t('absence.document_ref_line', { from: formatDateNumeric(absence.documentReferenceStart), to: formatDateNumeric(absence.documentReferenceEnd) })}{/if}
										</p>
									{/if}
									{#if absence.note}<p class="text-sm">{absence.note}</p>{/if}
									<div class="flex flex-wrap gap-2">
										<Button variant="outline" size="sm" onclick={() => (editing = absence)}>{t('absence.edit')}</Button>
										<Button variant="outline" size="sm" onclick={() => remove(absence)}>{t('absence.delete')}</Button>
									</div>
								{/if}
							</CardContent>
						</Card>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="text-xs text-muted-foreground">{t('absences.footnote')}</p>
	</div>
{/if}
