<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import type { Absence } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import AbsenceForm from '#lib/components/planning/AbsenceForm.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import AbsenceAttachments from '#lib/components/transfer/AbsenceAttachments.svelte';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { ABSENCE_CLASSES, ABSENCE_KINDS, ABSENCE_STATUSES, absenceKindLabel, absenceStatusLabel, documentStatusLabel } from '#lib/planning/labels.js';
	import {
		ABSENCE_SORTS,
		applyFilters,
		ATTACHMENT_FILTERS,
		DEFAULT_ABSENCE_FILTERS,
		filtersFromQuery,
		filtersToQuery,
		hasActiveFilters,
		loadFilters,
		queryHasFilters,
		saveFilters,
		yearFromQuery,
		type AbsenceFilters,
		type AttachmentCounts
	} from '#lib/planning/absence-list.js';
	import { formatDateNumeric, todayLocal } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { formatHalfDays } from '#lib/vacation/halfdays.js';
	import VacationRequestDialog, { type RequestTarget } from '#lib/components/vacation-form/VacationRequestDialog.svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	const currentYear = Number(todayLocal(zoneStore.value).slice(0, 4));
	// URL parameters win over the remembered filters (shared or bookmarked links); without any, the remembered ones apply.
	let year = $state(yearFromQuery(page.url.searchParams, currentYear));
	let absences = $state<Absence[]>([]);
	let filters = $state<AbsenceFilters>(queryHasFilters(page.url.searchParams) ? filtersFromQuery(page.url.searchParams) : loadFilters());
	/** Attachment counts per absence; filled in the background (the list endpoint does not carry them). */
	let counts = $state<AttachmentCounts>({});
	let openAttachments = $state<Set<string>>(new Set());
	let lastWritten = '';
	let editing = $state<Absence | 'new' | null>(null);
	let requesting = $state<RequestTarget | null>(null);
	let notice = $state('');
	let error = $state('');
	let today = $state(todayLocal(zoneStore.value));

	async function refresh() {
		try {
			today = todayLocal(await zoneStore.ensure());
			absences = await api.listAbsences(`${year}-01-01`, `${year}-12-31`);
			load = { status: 'ready' };
			void loadCounts(absences);
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(() => {
		lastWritten = page.url.search;
		void refresh();
	});

	/** At most four requests at a time; a server without attachments (404/501) leaves the counts unknown. */
	async function loadCounts(list: Absence[]) {
		const queue = [...list];
		const next: AttachmentCounts = {};
		const worker = async () => {
			for (let a = queue.shift(); a; a = queue.shift()) {
				try {
					next[a.id] = (await api.listAbsenceAttachments(a.id)).length;
				} catch {
					/* unknown */
				}
			}
		};
		await Promise.all([worker(), worker(), worker(), worker()]);
		if (list === absences) counts = next;
	}

	const visible = $derived(applyFilters(absences, filters, counts));
	const active = $derived(hasActiveFilters(filters));
	const attachmentsKnown = $derived(absences.every((a) => counts[a.id] !== undefined));
	const facet = (patch: Partial<AbsenceFilters>) => applyFilters(absences, { ...filters, ...patch }, counts).length;

	// Remember the filters and mirror them in the URL (replace, no history entries).
	$effect(() => {
		const snapshot = $state.snapshot(filters);
		saveFilters(snapshot);
		const search = filtersToQuery(snapshot, year, currentYear).toString();
		const target = search ? `?${search}` : '';
		if (load.status !== 'ready' || target === page.url.search) return;
		lastWritten = target;
		void goto(`${page.url.pathname}${target}`, { replace: true });
	});

	// Follow external URL changes (e.g. the sidebar link to the plain page, or browser navigation).
	$effect(() => {
		const search = page.url.search;
		if (search === lastWritten) return;
		lastWritten = search;
		const params = page.url.searchParams;
		filters = queryHasFilters(params) ? filtersFromQuery(params) : loadFilters();
		const nextYear = yearFromQuery(params, currentYear);
		if (nextYear !== year) {
			year = nextYear;
			void refresh();
		}
	});

	function resetFilters() {
		filters = { ...DEFAULT_ABSENCE_FILTERS, sort: filters.sort };
	}

	function toggleAttachments(id: string) {
		const next = new Set(openAttachments);
		if (!next.delete(id)) next.add(id);
		openAttachments = next;
	}

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
			<Button class="sm:ml-auto" onclick={() => (editing = 'new')}>{t('absence.create_title')}</Button>
		</div>

		<section class="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('absences.filters')} data-testid="absence-filters">
			<div class="flex flex-col gap-1.5 lg:col-span-2">
				<Label for="filter-q">{t('absences.filter_q')}</Label>
				<Input id="filter-q" type="search" bind:value={filters.q} placeholder={t('absences.filter_q_placeholder')} autocomplete="off" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="filter-status">{t('absences.filter_status')}</Label>
				<Select id="filter-status" bind:value={filters.status}>
					<option value="all">{t('absences.filter_all')} ({facet({ status: 'all' })})</option>
					{#each ABSENCE_STATUSES as option (option)}<option value={option}>{absenceStatusLabel(option)} ({facet({ status: option })})</option>{/each}
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="filter-kind">{t('absences.filter_kind')}</Label>
				<Select id="filter-kind" bind:value={filters.kind}>
					<option value="all">{t('absences.filter_all')} ({facet({ kind: 'all' })})</option>
					{#each ABSENCE_KINDS as option (option)}<option value={option}>{absenceKindLabel(option)} ({facet({ kind: option })})</option>{/each}
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="filter-from">{t('absences.filter_from')}</Label>
				<Input id="filter-from" type="date" bind:value={filters.from} min="{year}-01-01" max="{year}-12-31" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="filter-to">{t('absences.filter_to')}</Label>
				<Input id="filter-to" type="date" bind:value={filters.to} min="{year}-01-01" max="{year}-12-31" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="filter-attachment">{t('absences.filter_attachment')}</Label>
				<Select id="filter-attachment" bind:value={filters.attachment} disabled={!attachmentsKnown && filters.attachment === 'any'}>
					{#each ATTACHMENT_FILTERS as option (option)}<option value={option}>{t(`absences.attachment.${option}`)}</option>{/each}
				</Select>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="sort">{t('absences.sort')}</Label>
				<Select id="sort" bind:value={filters.sort}>
					{#each ABSENCE_SORTS as option (option)}<option value={option}>{t(`absences.sort.${option}`)}</option>{/each}
				</Select>
			</div>
			<div class="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
				<p class="text-sm text-muted-foreground tabular-nums" aria-live="polite" data-testid="absences-count">
					{t('absences.count', { shown: visible.length, total: absences.length })}
				</p>
				{#if active}<Button type="button" variant="outline" size="sm" onclick={resetFilters} data-testid="absences-reset">{t('absences.reset')}</Button>{/if}
			</div>
		</section>

		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}

		{#if editing === 'new'}
			<AbsenceForm date={today} onsaved={saved} oncancel={() => (editing = null)} />
		{/if}

		{#if visible.length === 0}
			<div class="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4" data-testid="absences-empty">
				<p class="text-sm text-muted-foreground">{absences.length === 0 ? t('absences.empty_year', { year }) : t('absences.empty')}</p>
				{#if absences.length > 0 && active}<Button type="button" variant="outline" size="sm" onclick={resetFilters}>{t('absences.reset')}</Button>{/if}
			</div>
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
										{#if absence.kind === 'vacation' && absence.status !== 'cancelled' && absence.status !== 'rejected'}
											<Button variant="outline" size="sm" onclick={() => (requesting = absence)} data-testid="absence-request-form">{t('vform.action')}</Button>
										{/if}
										<Button
											variant="outline"
											size="sm"
											aria-expanded={openAttachments.has(absence.id)}
											aria-controls="attachments-{absence.id}"
											onclick={() => toggleAttachments(absence.id)}
											data-testid="absence-attachments-toggle"
										>
											{counts[absence.id] === undefined ? t('absences.attachments') : t('absences.attachments_count', { count: counts[absence.id] ?? 0 })}
										</Button>
									</div>
									{#if openAttachments.has(absence.id)}
										<div id="attachments-{absence.id}">
											<AbsenceAttachments absenceId={absence.id} onchange={(n) => (counts = { ...counts, [absence.id]: n })} />
										</div>
									{/if}
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

<VacationRequestDialog target={requesting} onclose={() => (requesting = null)} />
