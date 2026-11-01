<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { ApiError } from '#lib/api/errors.js';
	import { api } from '#lib/api/client.js';
	import type { Catalog, Order, OrderEntry, OrderPatch } from '#lib/api/types.js';
	import ConfirmDialog from '#lib/components/app/ConfirmDialog.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import OrderLines from '#lib/components/groups/OrderLines.svelte';
	import ShareLinkCard from '#lib/components/groups/ShareLinkCard.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { formatDateTime } from '#lib/browser.js';
	import { saveBlob } from '#lib/groups/download.js';
	import { deadlineFromInput, deadlineInputValue, groupUrl } from '#lib/groups/format.js';
	import { freshLinks } from '#lib/groups/fresh-links.svelte.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';

	const id = page.params.id ?? '';
	let order = $state<Order | null>(null);
	let catalogs = $state<Catalog[]>([]);
	let loadError = $state('');
	let notFound = $state(false);
	let busy = $state(false);
	let notice = $state('');
	let actionError = $state('');
	let editing = $state(false);
	let zone = $state('Europe/Berlin');
	let form = $state({ title: '', note: '', deadline: '', catalogId: '' });
	let formErrors = $state<{ title?: string; deadline?: string }>({});
	let confirm = $state<{ kind: 'delete' } | { kind: 'entry'; entry: OrderEntry } | null>(null);
	let confirmError = $state('');

	const freshPath = $derived(freshLinks.get(id));
	const linkPath = $derived(freshPath ?? order?.path);

	onMount(async () => {
		zone = await zoneStore.ensure();
		try {
			catalogs = await api.listCatalogs();
		} catch {
			catalogs = [];
		}
		await reload();
	});

	async function reload() {
		try {
			order = await api.getOrder(id);
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) notFound = true;
			else loadError = errorMessage(error);
		}
	}

	async function run(action: () => Promise<Order | void>, success?: string) {
		if (busy) return;
		busy = true;
		actionError = '';
		notice = '';
		try {
			const result = await action();
			if (result) order = result;
			if (success) notice = success;
		} catch (error) {
			actionError = errorMessage(error);
		} finally {
			busy = false;
		}
	}

	const close = () => run(() => api.closeOrder(id), t('groups.notice_closed'));
	const reopen = () => run(() => api.reopenOrder(id), t('groups.notice_reopened'));

	async function rotate() {
		if (busy) return;
		busy = true;
		actionError = '';
		try {
			const result = await api.rotateOrderToken(id);
			if (result.path) freshLinks.set(id, result.path);
			order = result;
			notice = t('groups.notice_rotated');
		} catch (error) {
			actionError = errorMessage(error);
		} finally {
			busy = false;
		}
	}

	function startEdit() {
		if (!order) return;
		form = { title: order.title, note: order.note ?? '', deadline: deadlineInputValue(order.deadline, zone), catalogId: order.catalogId ?? '' };
		formErrors = {};
		editing = true;
	}

	async function saveEdit(event: Event) {
		event.preventDefault();
		if (!order || busy) return;
		formErrors = {};
		if (!form.title.trim()) formErrors.title = t('groups.error_title_required');
		const deadlineIso = form.deadline ? deadlineFromInput(form.deadline, zone) : null;
		const unchanged = deadlineIso !== null && order.deadline && Math.abs(Date.parse(deadlineIso) - Date.parse(order.deadline)) < 60_000;
		if (form.deadline && !deadlineIso) formErrors.deadline = t('groups.error_deadline');
		else if (deadlineIso && !unchanged && Date.parse(deadlineIso) <= Date.now()) formErrors.deadline = t('groups.error_deadline_past');
		if (formErrors.title || formErrors.deadline) return;
		const patch: OrderPatch = { title: form.title.trim(), note: form.note.trim() || null, catalogId: form.catalogId || null, ...(unchanged ? {} : { deadline: deadlineIso }) };
		await run(() => api.patchOrder(id, patch), t('groups.notice_saved'));
		if (!actionError) editing = false;
	}

	async function exportAs(format: 'csv' | 'txt') {
		actionError = '';
		try {
			const file = await api.exportOrder(id, format);
			saveBlob(file.blob, file.filename ?? `bestellung.${format}`);
		} catch (error) {
			actionError = errorMessage(error);
		}
	}

	async function confirmed() {
		if (!confirm) return;
		busy = true;
		confirmError = '';
		try {
			if (confirm.kind === 'delete') {
				await api.deleteOrder(id);
				freshLinks.clear(id);
				await goto('/groups');
				return;
			}
			await api.removeOrderEntry(id, confirm.entry.id);
			confirm = null;
			notice = t('groups.notice_entry_removed');
			await reload();
		} catch (error) {
			confirmError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={order?.title ?? t('groups.order_detail')} description={order?.note ?? undefined}>
	{#snippet secondary()}
		{#if order}
			{#if order.closed}
				<Button variant="outline" disabled={busy} onclick={reopen} data-testid="reopen">{t('groups.reopen')}</Button>
			{:else}
				<Button variant="outline" disabled={busy} onclick={close} data-testid="close">{t('groups.close')}</Button>
			{/if}
		{/if}
	{/snippet}
</PageHeader>

{#if notFound}
	<Alert variant="warning" data-testid="not-found">{t('groups.owner_not_found')} <a href="/groups" class="underline">{t('groups.back_to_list')}</a></Alert>
{:else if loadError}
	<Alert variant="destructive">{loadError}</Alert>
{:else if !order}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else}
	<div class="flex flex-col gap-5">
		{#if notice}<Alert variant="success" data-testid="notice">{notice}</Alert>{/if}
		{#if actionError}<Alert variant="destructive" data-testid="action-error">{actionError}</Alert>{/if}

		<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
			<StatusChip tone={order.closed ? 'neutral' : 'success'}>{order.closed ? t('groups.status_closed') : t('groups.status_open')}</StatusChip>
			<span>{t('groups.entry_count', { count: order.entryCount })}</span>
			{#if order.deadline}<span>· {order.closed ? t('groups.deadline_ended', { time: formatDateTime(order.deadline) }) : t('groups.deadline_until', { time: formatDateTime(order.deadline) })}</span>{/if}
		</div>

		<ShareLinkCard url={linkPath ? groupUrl(linkPath) : undefined} fresh={!!freshPath} title={order.title} {busy} onrotate={rotate} ondismiss={() => freshLinks.clear(id)} />
		{#if linkPath}
			<div class="-mt-3"><a href={linkPath} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-ui-accent-ink hover:underline" data-testid="open-public"><ExternalLink class="size-4" />{t('groups.open_public')}</a></div>
		{/if}

		<OrderLines {order}>
			{#snippet entryAction(entry)}
				<Button size="sm" variant="ghost" disabled={busy} aria-label={t('groups.entry_remove_aria', { name: entry.name, item: entry.item })} onclick={() => { confirmError = ''; confirm = { kind: 'entry', entry }; }}><Trash2 /></Button>
			{/snippet}
		</OrderLines>

		{#if order.entries.length > 0}
			<div class="flex flex-wrap items-center gap-2" data-testid="export-buttons">
				<span class="text-sm text-muted-foreground">{t('groups.export_label')}</span>
				<Button size="sm" variant="outline" onclick={() => exportAs('csv')}><Download />{t('groups.export_csv')}</Button>
				<Button size="sm" variant="outline" onclick={() => exportAs('txt')}><Download />{t('groups.export_txt')}</Button>
			</div>
		{/if}

		<section class="flex flex-col gap-3 rounded-[10px] border bg-card p-4" aria-labelledby="edit-title">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 id="edit-title" class="text-[17px] font-semibold">{t('groups.settings_title')}</h2>
				{#if !editing}<Button size="sm" variant="outline" onclick={startEdit} data-testid="edit-settings">{t('groups.edit')}</Button>{/if}
			</div>
			{#if editing}
				<form class="flex flex-col gap-4" onsubmit={saveEdit} novalidate data-testid="edit-form">
					<Field id="edit-title-input" label={t('groups.field_title')} bind:value={form.title} maxlength={120} required error={formErrors.title} />
					<div class="flex flex-col gap-1.5">
						<Label for="edit-note">{t('groups.field_order_note')}</Label>
						<Textarea id="edit-note" bind:value={form.note} maxlength={2000} rows={3} />
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<Label for="edit-deadline">{t('groups.field_deadline')}</Label>
							<Input id="edit-deadline" type="datetime-local" bind:value={form.deadline} aria-invalid={formErrors.deadline ? true : undefined} />
							{#if formErrors.deadline}<p class="text-xs text-destructive">{formErrors.deadline}</p>{/if}
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="edit-catalog">{t('groups.field_catalog')}</Label>
							<Select id="edit-catalog" bind:value={form.catalogId}>
								<option value="">{t('groups.catalog_none')}</option>
								{#each catalogs as catalog (catalog.id)}<option value={catalog.id}>{catalog.name}</option>{/each}
							</Select>
						</div>
					</div>
					<div class="flex gap-2">
						<Button type="submit" disabled={busy}>{t('common.save')}</Button>
						<Button type="button" variant="outline" onclick={() => (editing = false)}>{t('common.cancel')}</Button>
					</div>
				</form>
			{:else}
				<p class="text-sm text-muted-foreground">{order.catalogId ? t('groups.catalog_attached', { name: catalogs.find((c) => c.id === order?.catalogId)?.name ?? '…' }) : t('groups.catalog_none_text')}</p>
			{/if}
		</section>

		<div><Button variant="destructive" disabled={busy} onclick={() => { confirmError = ''; confirm = { kind: 'delete' }; }} data-testid="delete">{t('groups.delete_order')}</Button></div>
	</div>
{/if}

<ConfirmDialog
	open={confirm !== null}
	title={confirm?.kind === 'entry' ? t('groups.entry_remove_title') : t('groups.delete_order_title')}
	confirmLabel={confirm?.kind === 'entry' ? t('groups.entry_remove') : t('groups.delete_confirm')}
	tone="danger"
	{busy}
	error={confirmError}
	onconfirm={confirmed}
	oncancel={() => (confirm = null)}
>
	{#if confirm?.kind === 'entry'}
		<p>{t('groups.entry_remove_text', { name: confirm.entry.name, item: confirm.entry.item })}</p>
	{:else}
		<p>{t('groups.delete_order_text')}</p>
	{/if}
</ConfirmDialog>
