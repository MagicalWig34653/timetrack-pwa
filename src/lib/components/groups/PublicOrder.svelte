<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { ApiError } from '#lib/api/errors.js';
	import type { AggregatedItem, CatalogItem, EntryInput, Order, OrderEntry } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import { entryForAggregate, formatCents, parsePrice, priceInputValue } from '#lib/groups/format.js';
	import { saveBlob } from '#lib/groups/download.js';
	import { publicGroups } from '#lib/groups/public-api.js';
	import { loadMemory, updateMemory } from '#lib/groups/secrets.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import OrderLines from './OrderLines.svelte';

	/** Participant view of a public order round: add entries, take over a dish, edit/delete own entries, export. */
	let { token, order, onrefresh }: { token: string; order: Order; onrefresh: () => Promise<void> } = $props();

	// the page remounts per link ({#key token} in the route), so the initial values are the right ones
	// svelte-ignore state_referenced_locally
	let memory = $state(loadMemory(token));
	// svelte-ignore state_referenced_locally
	let name = $state(memory.name ?? '');
	let item = $state('');
	let quantity = $state('1');
	let note = $state('');
	let price = $state('');
	let editingId = $state<string | null>(null);
	let takingKey = $state<string | null>(null);
	let takeQuantity = $state('1');
	let takeNote = $state('');
	let errors = $state<{ name?: string; item?: string; quantity?: string; price?: string; note?: string }>({});
	let formError = $state('');
	let notice = $state('');
	let busy = $state(false);
	let refreshing = $state(false);
	let formAnchor: HTMLElement | undefined = $state();

	const lineKey = (line: AggregatedItem) => `${line.item}|${line.note ?? ''}|${line.priceCents ?? ''}`;
	/** own entries that still exist */
	const ownIds = $derived(Object.keys(memory.entries).filter((id) => order.entries.some((entry) => entry.id === id)));
	const suggestions = $derived(order.suggestions.slice(0, 40));
	const nameInvalid = $derived(!name.trim());

	function remember(change: (m: typeof memory) => void) {
		memory = { ...updateMemory(token, change) };
	}

	function resetForm() {
		item = '';
		quantity = '1';
		note = '';
		price = '';
		editingId = null;
		errors = {};
	}

	function parseForm(): EntryInput | null {
		errors = {};
		const input: EntryInput = { name: name.trim(), item: item.trim() };
		if (!input.name) errors.name = t('groups.error_name_required');
		if (!input.item) errors.item = t('groups.error_item_required');
		const qty = Number(quantity);
		if (!Number.isInteger(qty) || qty < 1 || qty > 99) errors.quantity = t('groups.error_quantity');
		else input.quantity = qty;
		const cents = parsePrice(price);
		if (cents === undefined) errors.price = t('groups.error_price');
		else if (cents !== null) input.priceCents = cents;
		if (note.trim()) input.note = note.trim();
		return errors.name || errors.item || errors.quantity || errors.price ? null : input;
	}

	function fail(error: unknown, entryId?: string) {
		if (error instanceof ApiError && error.code === 'edit_secret_invalid' && entryId) {
			remember((m) => delete m.entries[entryId]);
			resetForm();
			formError = t('groups.error_secret_lost_entry');
		} else if (error instanceof ApiError && error.status === 404 && entryId) {
			remember((m) => delete m.entries[entryId]);
			resetForm();
			formError = t('groups.error_entry_gone');
		} else formError = errorMessage(error);
		if (error instanceof ApiError && (error.code === 'group_closed' || error.code === 'group_full')) void onrefresh();
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (busy) return;
		formError = '';
		notice = '';
		const input = parseForm();
		if (!input) return;
		busy = true;
		try {
			if (editingId) {
				const id = editingId;
				await publicGroups.updateEntry(token, id, memory.entries[id], input);
				remember((m) => (m.name = input.name));
				notice = t('groups.entry_updated');
			} else {
				const created = await publicGroups.addEntry(token, input);
				remember((m) => {
					m.name = input.name;
					m.entries[created.entry.id] = created.editSecret;
				});
				notice = t('groups.entry_added', { item: input.item });
			}
			resetForm();
			await onrefresh();
		} catch (error) {
			fail(error, editingId ?? undefined);
		} finally {
			busy = false;
		}
	}

	function edit(entry: OrderEntry) {
		editingId = entry.id;
		name = entry.name;
		item = entry.item;
		quantity = String(entry.quantity);
		note = entry.note ?? '';
		price = priceInputValue(entry.priceCents);
		errors = {};
		formError = '';
		notice = '';
		formAnchor?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
	}

	async function remove(entry: OrderEntry) {
		if (busy) return;
		busy = true;
		formError = '';
		try {
			await publicGroups.deleteEntry(token, entry.id, memory.entries[entry.id]);
			remember((m) => delete m.entries[entry.id]);
			if (editingId === entry.id) resetForm();
			notice = t('groups.entry_removed', { item: entry.item });
			await onrefresh();
		} catch (error) {
			fail(error, entry.id);
		} finally {
			busy = false;
		}
	}

	function startTake(line: AggregatedItem) {
		takingKey = lineKey(line);
		takeQuantity = '1';
		takeNote = '';
		formError = '';
		notice = '';
	}

	async function take(line: AggregatedItem) {
		if (busy) return;
		const source = entryForAggregate(order, line);
		const qty = Number(takeQuantity);
		if (!name.trim()) return void (errors = { name: t('groups.error_name_required') });
		if (!source || !Number.isInteger(qty) || qty < 1 || qty > 99) return void (formError = t('groups.error_quantity'));
		busy = true;
		formError = '';
		errors = {};
		try {
			const created = await publicGroups.takeEntry(token, source.id, { name: name.trim(), quantity: qty, ...(takeNote.trim() ? { note: takeNote.trim() } : {}) });
			remember((m) => {
				m.name = name.trim();
				m.entries[created.entry.id] = created.editSecret;
			});
			takingKey = null;
			notice = t('groups.entry_taken', { item: line.item });
			await onrefresh();
		} catch (error) {
			fail(error);
		} finally {
			busy = false;
		}
	}

	function useSuggestion(suggestion: CatalogItem) {
		item = suggestion.name;
		price = priceInputValue(suggestion.priceCents);
	}

	async function exportAs(format: 'csv' | 'txt') {
		formError = '';
		try {
			const file = await publicGroups.exportOrder(token, format);
			saveBlob(file.blob, file.filename ?? `bestellung.${format}`);
		} catch (error) {
			formError = errorMessage(error);
		}
	}

	async function refresh() {
		refreshing = true;
		try {
			await onrefresh();
		} finally {
			refreshing = false;
		}
	}
</script>

<header class="flex flex-col gap-2">
	<div class="flex flex-wrap items-center gap-2">
		<StatusChip tone={order.closed ? 'neutral' : 'success'}>{order.closed ? t('groups.status_closed') : t('groups.status_open')}</StatusChip>
		<span class="text-sm text-muted-foreground">{t('groups.entry_count', { count: order.entryCount })}</span>
		{#if order.deadline}<span class="text-sm text-muted-foreground">· {order.closed ? t('groups.deadline_ended', { time: formatDateTime(order.deadline) }) : t('groups.deadline_until', { time: formatDateTime(order.deadline) })}</span>{/if}
	</div>
	<h1 class="text-[26px] leading-tight font-[650] tracking-[-0.6px] break-words sm:text-[30px]" data-testid="group-title">{order.title}</h1>
	{#if order.note}<p class="text-[15px] break-words whitespace-pre-line text-muted-foreground" data-testid="group-description">{order.note}</p>{/if}
</header>

{#if notice}<Alert variant="success" data-testid="entry-notice">{notice}</Alert>{/if}
{#if formError}<Alert variant="destructive" data-testid="entry-error">{formError}</Alert>{/if}

{#if order.closed}
	<Alert data-testid="closed-note">{t('groups.closed_note_order')}</Alert>
{:else}
	<section class="flex flex-col gap-3 rounded-[10px] border bg-card p-4 sm:p-5" aria-labelledby="entry-title" bind:this={formAnchor}>
		<h2 id="entry-title" class="text-base font-semibold">{editingId ? t('groups.entry_title_edit') : t('groups.entry_title')}</h2>
		<form class="flex flex-col gap-4" onsubmit={submit} data-testid="entry-form" novalidate>
			<Field id="entry-name" label={t('groups.your_name')} bind:value={name} maxlength={60} autocomplete="nickname" required error={errors.name} />
			<div class="flex flex-col gap-1.5">
				<Field id="entry-item" label={t('groups.item')} bind:value={item} maxlength={200} required autocomplete="off" error={errors.item} />
				{#if suggestions.length > 0}
					<div class="flex flex-wrap gap-1.5" role="group" aria-label={t('groups.suggestions')} data-testid="suggestions">
						{#each suggestions as suggestion (suggestion.name)}
							<button type="button" class="inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-[13px] hover:bg-muted" onclick={() => useSuggestion(suggestion)}>
								{suggestion.name}{#if suggestion.priceCents !== null && suggestion.priceCents !== undefined}<span class="text-muted-foreground">{formatCents(suggestion.priceCents)}</span>{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_minmax(0,9rem)]">
				<Field id="entry-quantity" label={t('groups.quantity')} bind:value={quantity} type="number" inputmode="numeric" min={1} max={99} error={errors.quantity} />
				<div class="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
					<Field id="entry-note" label={t('groups.note_optional')} bind:value={note} maxlength={200} autocomplete="off" />
				</div>
				<div class="col-start-2 row-start-1 sm:col-start-3">
					<Field id="entry-price" label={t('groups.price_optional')} bind:value={price} inputmode="decimal" placeholder="0,00" autocomplete="off" error={errors.price} />
				</div>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button type="submit" disabled={busy}>{editingId ? t('groups.entry_save') : t('groups.entry_add')}</Button>
				{#if editingId}<Button type="button" variant="outline" onclick={resetForm} disabled={busy}>{t('common.cancel')}</Button>{/if}
			</div>
		</form>
		<p class="text-xs text-muted-foreground">{t('groups.edit_hint')}</p>
	</section>
{/if}

<div class="flex items-center justify-end gap-2">
	<Button size="sm" variant="ghost" onclick={refresh} disabled={refreshing} aria-label={t('groups.refresh')}><RefreshCw class={refreshing ? 'animate-spin' : ''} />{t('groups.refresh')}</Button>
</div>

<OrderLines {order}>
	{#snippet lineAction(line)}
		{#if !order.closed}
			{#if takingKey === lineKey(line)}
				<form class="flex flex-wrap items-end gap-2" onsubmit={(e) => { e.preventDefault(); void take(line); }} data-testid="take-form">
					<div class="w-16">
						<Label for="take-qty" class="text-xs">{t('groups.quantity')}</Label>
						<Input id="take-qty" type="number" min="1" max="99" inputmode="numeric" bind:value={takeQuantity} />
					</div>
					<div class="w-36">
						<Label for="take-note" class="text-xs">{t('groups.note_optional')}</Label>
						<Input id="take-note" bind:value={takeNote} maxlength={200} />
					</div>
					<Button size="sm" type="submit" disabled={busy || nameInvalid}>{t('groups.take_confirm')}</Button>
					<Button size="sm" type="button" variant="ghost" onclick={() => (takingKey = null)}>{t('common.cancel')}</Button>
				</form>
			{:else}
				<Button size="sm" variant="outline" aria-label={t('groups.take_aria', { item: line.item })} onclick={() => startTake(line)}>{t('groups.take')}</Button>
			{/if}
		{/if}
	{/snippet}
	{#snippet entryAction(entry)}
		{#if ownIds.includes(entry.id) && !order.closed}
			<Button size="sm" variant="ghost" aria-label={t('groups.entry_edit_aria', { item: entry.item })} onclick={() => edit(entry)}>{t('groups.edit')}</Button>
			<Button size="sm" variant="ghost" disabled={busy} aria-label={t('groups.entry_delete_aria', { item: entry.item })} onclick={() => remove(entry)}>{t('groups.delete')}</Button>
		{/if}
	{/snippet}
</OrderLines>

{#if order.entries.length > 0}
	<div class="flex flex-wrap items-center gap-2" data-testid="export-buttons">
		<span class="text-sm text-muted-foreground">{t('groups.export_label')}</span>
		<Button size="sm" variant="outline" onclick={() => exportAs('csv')}><Download />{t('groups.export_csv')}</Button>
		<Button size="sm" variant="outline" onclick={() => exportAs('txt')}><Download />{t('groups.export_txt')}</Button>
	</div>
{/if}
