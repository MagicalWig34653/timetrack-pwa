<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { CancelledSegment, Segment, SegmentKind } from '#lib/api/types.js';
	import ConfirmDialog from '#lib/components/app/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { addDays, formatDateShort, localDateOf, localTimeOf, todayLocal } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { kindLabel, SEGMENT_KINDS } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { filterCancelled, isMissingEndpoint, PURGE_WORD, toggleAll, toggleId } from '#lib/time/trash.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const timeZone = $derived(zoneStore.value);
	const today = $derived(todayLocal(timeZone));

	let from = $state('');
	let to = $state('');
	let kind = $state<SegmentKind | 'all'>('all');
	let load = $state<LoadState>({ status: 'loading' });
	let loaded = $state<CancelledSegment[]>([]);
	let selected = $state<Set<string>>(new Set());
	let notice = $state('');
	let error = $state('');
	let busy = $state(false);
	/** null = unknown until tried; false = the server answered "no such endpoint" */
	let purgeSupported = $state<boolean | null>(null);
	let restoreSupported = $state<boolean | null>(null);

	// confirmation dialog
	type Pending = { type: 'one'; segment: Segment } | { type: 'selected' } | { type: 'all' };
	let pending = $state<Pending | null>(null);
	let allCount = $state<number | null>(null);
	let allDetail = $state(0);
	let dialogError = $state('');

	$effect(() => {
		if (from === '') {
			from = addDays(today, -365);
			to = today;
		}
	});

	const reasonOf = $derived(new Map(loaded.map((c) => [c.segment.id, c.cancelReason])));
	const visible = $derived(filterCancelled(loaded.map((c) => c.segment), { from, to, kind }, timeZone));
	const allSelected = $derived(visible.length > 0 && visible.every((s) => selected.has(s.id)));
	const selectedVisible = $derived(visible.filter((s) => selected.has(s.id)));

	async function reload() {
		if (!from || !to || to < from) return;
		const [start, end] = [from, to];
		load = { status: 'loading' };
		try {
			await zoneStore.ensure();
			const result = await api.listCancelledSegments();
			if (start !== from || end !== to) return;
			loaded = result;
			selected = new Set([...selected].filter((id) => result.some((c) => c.segment.id === id)));
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}

	$effect(() => {
		void from;
		void to;
		void reload();
	});

	// Feature detection: a dry run changes nothing; older servers answer 400/404/405/501 (the path then hits the single-segment route).
	$effect(() => {
		void api
			.purgeCancelled({ all: true, dryRun: true })
			.then(() => (purgeSupported = true))
			.catch((e) => (purgeSupported = !(isMissingEndpoint(e) || (e as { status?: number }).status === 400)));
	});

	const rangeText = (s: Segment) => `${localTimeOf(s.startedAt, timeZone)}–${s.endedAt ? localTimeOf(s.endedAt, timeZone) : '…'}`;
	const lengthOf = (s: Segment) => (s.endedAt ? Math.max(0, Math.floor((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)) : 0);

	async function restore(segment: Segment) {
		if (busy) return;
		busy = true;
		error = notice = '';
		try {
			await api.restoreSegment(segment.id);
			notice = t('trash.restored');
			restoreSupported = true;
			await reload();
		} catch (e) {
			if (isMissingEndpoint(e)) {
				restoreSupported = false;
				error = t('trash.no_restore');
			} else if ((e as { code?: string }).code === 'segment_overlap') error = t('trash.restore_overlap');
			else error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function ask(next: Pending) {
		dialogError = '';
		pending = next;
		if (next.type === 'all') {
			allCount = null;
			try {
				const preview = await api.purgeCancelled({ all: true, dryRun: true });
				allCount = preview.segments;
				allDetail = preview.revisions;
			} catch (e) {
				dialogError = errorMessage(e);
			}
		}
	}

	async function confirm() {
		const current = pending;
		if (!current || busy) return;
		busy = true;
		dialogError = '';
		try {
			let count = 1;
			if (current.type === 'one') await api.purgeSegment(current.segment.id);
			else if (current.type === 'selected') count = (await api.purgeCancelled({ ids: selectedVisible.map((s) => s.id) })).segments;
			else count = (await api.purgeCancelled({ all: true })).segments;
			notice = count === 1 ? t('trash.deleted_one') : t('trash.deleted_many', { count });
			error = '';
			pending = null;
			selected = new Set();
			await reload();
		} catch (e) {
			if (isMissingEndpoint(e)) {
				purgeSupported = false;
				pending = null;
				error = t('trash.no_purge');
			} else dialogError = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	const dialogTitle = $derived(
		!pending ? '' : pending.type === 'one' ? t('trash.confirm_one_title') : pending.type === 'selected' ? t('trash.confirm_selected_title', { count: selectedVisible.length }) : t('trash.confirm_all_title')
	);
	const needsWord = $derived(pending?.type === 'all');
	const canConfirm = $derived(pending?.type !== 'all' || (allCount !== null && allCount > 0));
</script>

<PageHeader title={t('trash.title')} description={t('trash.description')} />

<div class="mb-4 flex flex-wrap items-end gap-3" role="group" aria-label={t('trash.filter_label')} data-testid="trash-filter">
	<label class="flex flex-col gap-1 text-sm text-muted-foreground">
		{t('trash.from')}
		<input type="date" bind:value={from} max={to} class="h-9 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30" data-testid="trash-from" />
	</label>
	<label class="flex flex-col gap-1 text-sm text-muted-foreground">
		{t('trash.to')}
		<input type="date" bind:value={to} min={from} class="h-9 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30" data-testid="trash-to" />
	</label>
	<label class="flex flex-col gap-1 text-sm text-muted-foreground">
		{t('trash.kind')}
		<select bind:value={kind} class="h-9 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30" data-testid="trash-kind">
			<option value="all">{t('trash.kind_all')}</option>
			{#each SEGMENT_KINDS as k (k)}<option value={k}>{kindLabel(k)}</option>{/each}
		</select>
	</label>
	{#if load.status === 'ready'}
		<span class="ml-auto text-[13px] text-muted-foreground tabular-nums" aria-live="polite" data-testid="trash-count">
			{visible.length === 1 ? t('trash.count_one') : t('trash.count', { count: visible.length })}
		</span>
	{/if}
</div>

{#if purgeSupported === false}
	<Alert variant="warning" class="mb-4" data-testid="trash-no-purge">{t('trash.no_purge')}</Alert>
{/if}
{#if error}<Alert variant="destructive" class="mb-4" data-testid="trash-error">{error}</Alert>{/if}
{#if notice}<Alert variant="success" class="mb-4" data-testid="trash-notice">{notice}</Alert>{/if}

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Alert variant="warning">{t('stats.unavailable')}</Alert>
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="mb-3 flex flex-wrap items-center gap-2" data-testid="trash-actions">
		{#if visible.length > 0}
			<label class="flex items-center gap-2 text-sm">
				<Checkbox checked={allSelected} onchange={() => (selected = toggleAll(selected, visible))} aria-label={t('trash.select_all')} data-testid="trash-select-all" />
				{t('trash.select_all')}
			</label>
		{/if}
		{#if selectedVisible.length > 0}<span class="text-sm text-muted-foreground" data-testid="trash-selected">{t('trash.selected', { count: selectedVisible.length })}</span>{/if}
		<div class="ml-auto flex flex-wrap gap-2">
			{#if purgeSupported !== false}
				<Button variant="outline" size="sm" disabled={selectedVisible.length === 0 || busy} onclick={() => ask({ type: 'selected' })} data-testid="trash-delete-selected"><Trash2 />{t('trash.delete_selected')}</Button>
				<Button variant="destructive" size="sm" disabled={busy} onclick={() => ask({ type: 'all' })} data-testid="trash-delete-all">{t('trash.delete_all')}</Button>
			{/if}
		</div>
	</div>

	{#if visible.length === 0}
		<EmptyState title={t('trash.empty_title')} description={t('trash.empty_text')} icon={Trash2} testid="trash-empty" />
	{:else}
		<ul class="divide-y rounded-[10px] border bg-card" data-testid="trash-list">
			{#each visible as segment (segment.id)}
				{@const date = localDateOf(segment.startedAt, timeZone)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" data-testid="trash-row">
					<Checkbox checked={selected.has(segment.id)} onchange={() => (selected = toggleId(selected, segment.id))} aria-label={t('trash.select_row', { date: formatDateShort(date) })} data-testid="trash-select" />
					<a class="min-w-24 font-medium underline-offset-4 hover:underline" href="/time/{date}">{formatDateShort(date)}</a>
					<span class="tabular-nums">{rangeText(segment)}</span>
					<span class="text-sm text-muted-foreground tabular-nums">{formatDuration(lengthOf(segment))}</span>
					<Badge variant="outline">{kindLabel(segment.kind)}</Badge>
					{#if reasonOf.get(segment.id)}<span class="min-w-0 truncate text-sm text-muted-foreground" title={t('trash.reason')}>{t('trash.reason_text', { reason: reasonOf.get(segment.id) ?? '' })}</span>{/if}
					{#if segment.note}<span class="min-w-0 truncate text-sm text-muted-foreground">{segment.note}</span>{/if}
					<span class="ml-auto flex gap-2">
						{#if restoreSupported !== false}
							<Button variant="outline" size="sm" disabled={busy} onclick={() => restore(segment)} data-testid="trash-restore"><ArchiveRestore />{t('trash.restore')}</Button>
						{/if}
						{#if purgeSupported !== false}
							<Button variant="outline" size="sm" disabled={busy} onclick={() => ask({ type: 'one', segment })} data-testid="trash-delete"><Trash2 />{t('trash.delete')}</Button>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="mt-4 text-xs text-muted-foreground">{t('trash.absences_hint')} <a class="underline underline-offset-4" href="/absences">{t('nav.absences')}</a></p>
{/if}

<ConfirmDialog
	open={pending !== null}
	title={dialogTitle}
	confirmLabel={t('trash.delete_confirm')}
	tone="danger"
	typedHandle={needsWord ? PURGE_WORD : undefined}
	typedLabel={needsWord ? t('trash.type_word', { word: PURGE_WORD }) : undefined}
	{busy}
	error={dialogError}
	onconfirm={() => canConfirm && confirm()}
	oncancel={() => (pending = null)}
>
	{#if pending?.type === 'one'}
		<p>{t('trash.confirm_one_text', { date: formatDateShort(localDateOf(pending.segment.startedAt, timeZone)), range: rangeText(pending.segment) })}</p>
	{:else if pending?.type === 'selected'}
		<p>{t('trash.confirm_selected_text')}</p>
	{:else if pending?.type === 'all'}
		<p data-testid="trash-all-count">{allCount === null ? t('trash.confirm_all_counting') : allCount === 0 ? t('trash.confirm_all_none') : t('trash.confirm_all_text', { count: allCount, revisions: allDetail })}</p>
	{/if}
</ConfirmDialog>
