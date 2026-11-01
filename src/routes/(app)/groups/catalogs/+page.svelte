<script lang="ts">
	import { onMount } from 'svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { api } from '#lib/api/client.js';
	import type { Catalog, CatalogItem, ItemSuggestion } from '#lib/api/types.js';
	import ConfirmDialog from '#lib/components/app/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { formatCents, parsePrice, priceInputValue } from '#lib/groups/format.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';

	interface Row {
		name: string;
		price: string;
	}

	let load = $state<LoadState>({ status: 'loading' });
	let catalogs = $state<Catalog[]>([]);
	let suggestions = $state<ItemSuggestion[]>([]);
	/** null = list only, 'new' = empty form, otherwise the id of the catalog being edited */
	let editing = $state<string | 'new' | null>(null);
	let name = $state('');
	let rows = $state<Row[]>([]);
	let errors = $state<{ name?: string; rows?: string }>({});
	let formError = $state('');
	let notice = $state('');
	let busy = $state(false);
	let confirmDelete = $state<Catalog | null>(null);
	let confirmError = $state('');

	onMount(refresh);

	async function refresh() {
		try {
			[catalogs, suggestions] = await Promise.all([api.listCatalogs(), api.listOrderItemSuggestions().catch(() => [])]);
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}

	function startNew() {
		editing = 'new';
		name = '';
		rows = [{ name: '', price: '' }];
		errors = {};
		formError = '';
		notice = '';
	}

	function startEdit(catalog: Catalog) {
		editing = catalog.id;
		name = catalog.name;
		rows = catalog.items.map((item) => ({ name: item.name, price: priceInputValue(item.priceCents) }));
		if (rows.length === 0) rows = [{ name: '', price: '' }];
		errors = {};
		formError = '';
		notice = '';
	}

	function addSuggestion(suggestion: ItemSuggestion) {
		if (rows.some((row) => row.name.trim().toLowerCase() === suggestion.item.trim().toLowerCase())) return;
		const empty = rows.findIndex((row) => !row.name.trim() && !row.price.trim());
		const row = { name: suggestion.item, price: priceInputValue(suggestion.priceCents) };
		if (empty >= 0) rows[empty] = row;
		else rows.push(row);
	}

	async function save(event: Event) {
		event.preventDefault();
		if (busy || !editing) return;
		errors = {};
		formError = '';
		const items: CatalogItem[] = [];
		for (const row of rows) {
			if (!row.name.trim() && !row.price.trim()) continue;
			const cents = parsePrice(row.price);
			if (!row.name.trim() || cents === undefined) {
				errors.rows = t('groups.error_catalog_rows');
				break;
			}
			items.push({ name: row.name.trim(), priceCents: cents });
		}
		if (!name.trim()) errors.name = t('groups.error_catalog_name');
		if (items.length > 200) errors.rows = t('groups.error_catalog_max');
		if (errors.name || errors.rows) return;
		busy = true;
		try {
			const input = { name: name.trim(), items };
			if (editing === 'new') await api.createCatalog(input);
			else await api.replaceCatalog(editing, input);
			editing = null;
			notice = t('groups.catalog_saved');
			await refresh();
		} catch (error) {
			formError = errorMessage(error);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!confirmDelete) return;
		busy = true;
		confirmError = '';
		try {
			await api.deleteCatalog(confirmDelete.id);
			confirmDelete = null;
			if (editing && !catalogs.some((c) => c.id === editing)) editing = null;
			notice = t('groups.catalog_deleted');
			await refresh();
		} catch (error) {
			confirmError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={t('groups.catalogs_title')} description={t('groups.catalogs_description')}>
	{#snippet primary()}
		{#if load.status === 'ready' && editing === null}<Button onclick={startNew} data-testid="new-catalog"><Plus />{t('groups.catalog_new')}</Button>{/if}
	{/snippet}
</PageHeader>

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex max-w-3xl flex-col gap-5">
		{#if notice}<Alert variant="success" data-testid="notice">{notice}</Alert>{/if}

		{#if editing !== null}
			<form class="flex flex-col gap-4 rounded-[10px] border bg-card p-4 sm:p-5" onsubmit={save} novalidate data-testid="catalog-form">
				<h2 class="text-[17px] font-semibold">{editing === 'new' ? t('groups.catalog_new') : t('groups.catalog_edit')}</h2>
				<Field id="catalog-name" label={t('groups.catalog_name')} bind:value={name} maxlength={80} required error={errors.name} placeholder={t('groups.catalog_name_placeholder')} />
				<fieldset class="flex flex-col gap-2">
					<legend class="mb-1 text-sm font-medium">{t('groups.catalog_dishes')}</legend>
					{#each rows as row, index (index)}
						<div class="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2" data-testid="catalog-row">
							<Input aria-label={t('groups.catalog_dish_n', { n: index + 1 })} bind:value={row.name} maxlength={200} placeholder={t('groups.catalog_dish_placeholder')} />
							<Input aria-label={t('groups.catalog_price_n', { n: index + 1 })} bind:value={row.price} inputmode="decimal" placeholder="0,00" />
							<Button type="button" variant="ghost" size="icon" aria-label={t('groups.catalog_remove_dish', { n: index + 1 })} onclick={() => rows.splice(index, 1)}><X /></Button>
						</div>
					{/each}
					{#if errors.rows}<p class="text-sm text-destructive" role="alert">{errors.rows}</p>{/if}
					<div><Button type="button" variant="outline" size="sm" onclick={() => rows.push({ name: '', price: '' })} data-testid="add-dish"><Plus />{t('groups.catalog_add_dish')}</Button></div>
				</fieldset>
				{#if suggestions.length > 0}
					<div class="flex flex-col gap-1.5" data-testid="catalog-suggestions">
						<Label>{t('groups.catalog_from_history')}</Label>
						<div class="flex flex-wrap gap-1.5">
							{#each suggestions as suggestion (suggestion.item)}
								<button type="button" class="inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-[13px] hover:bg-muted" onclick={() => addSuggestion(suggestion)}>
									{suggestion.item}<span class="text-muted-foreground">{t('groups.suggestion_count', { count: suggestion.count })}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
				{#if formError}<Alert variant="destructive" data-testid="form-error">{formError}</Alert>{/if}
				<div class="flex gap-2">
					<Button type="submit" disabled={busy}>{t('common.save')}</Button>
					<Button type="button" variant="outline" onclick={() => (editing = null)}>{t('common.cancel')}</Button>
				</div>
			</form>
		{/if}

		{#if catalogs.length === 0 && editing === null}
			<EmptyState title={t('groups.catalogs_empty')} description={t('groups.catalogs_empty_text')} icon={BookOpen} testid="catalogs-empty" />
		{:else if catalogs.length > 0}
			<ul class="divide-y rounded-[10px] border bg-card" data-testid="catalog-list">
				{#each catalogs as catalog (catalog.id)}
					<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
						<div class="min-w-0">
							<p class="font-medium break-words">{catalog.name}</p>
							<p class="text-xs text-muted-foreground">
								{t('groups.catalog_items', { count: catalog.itemCount })}{#if catalog.items.length > 0} · {catalog.items.slice(0, 4).map((i) => (i.priceCents !== null && i.priceCents !== undefined ? `${i.name} ${formatCents(i.priceCents)}` : i.name)).join(', ')}{catalog.items.length > 4 ? ' …' : ''}{/if}
							</p>
						</div>
						<div class="flex gap-1">
							<Button size="sm" variant="outline" aria-label={t('groups.catalog_edit_aria', { name: catalog.name })} onclick={() => startEdit(catalog)}>{t('groups.edit')}</Button>
							<Button size="sm" variant="ghost" aria-label={t('groups.catalog_delete_aria', { name: catalog.name })} onclick={() => { confirmError = ''; confirmDelete = catalog; }}>{t('groups.delete')}</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
		<div><a href="/groups" class="text-sm text-ui-accent-ink hover:underline">{t('groups.back_to_list')}</a></div>
	</div>
{/if}

<ConfirmDialog open={confirmDelete !== null} title={t('groups.catalog_delete_title')} confirmLabel={t('groups.delete_confirm')} tone="danger" {busy} error={confirmError} onconfirm={remove} oncancel={() => (confirmDelete = null)}>
	<p>{t('groups.catalog_delete_text', { name: confirmDelete?.name ?? '' })}</p>
</ConfirmDialog>
