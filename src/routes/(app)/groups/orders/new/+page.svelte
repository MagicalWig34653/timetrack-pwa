<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api } from '#lib/api/client.js';
	import type { Catalog, OrderInput } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { deadlineFromInput } from '#lib/groups/format.js';
	import { freshLinks } from '#lib/groups/fresh-links.svelte.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';

	let title = $state('');
	let note = $state('');
	let deadline = $state('');
	let catalogId = $state('');
	let catalogs = $state<Catalog[]>([]);
	let zone = $state('Europe/Berlin');
	let errors = $state<{ title?: string; deadline?: string }>({});
	let formError = $state('');
	let busy = $state(false);

	onMount(async () => {
		zone = await zoneStore.ensure();
		try {
			catalogs = await api.listCatalogs();
		} catch {
			catalogs = [];
		}
	});

	async function submit(event: Event) {
		event.preventDefault();
		if (busy) return;
		errors = {};
		formError = '';
		if (!title.trim()) errors.title = t('groups.error_title_required');
		const deadlineIso = deadline ? deadlineFromInput(deadline, zone) : null;
		if (deadline && !deadlineIso) errors.deadline = t('groups.error_deadline');
		else if (deadlineIso && Date.parse(deadlineIso) <= Date.now()) errors.deadline = t('groups.error_deadline_past');
		if (errors.title || errors.deadline) return;
		const input: OrderInput = { title: title.trim(), ...(note.trim() ? { note: note.trim() } : {}), ...(deadlineIso ? { deadline: deadlineIso } : {}), ...(catalogId ? { catalogId } : {}) };
		busy = true;
		try {
			const order = await api.createOrder(input);
			if (order.id && order.path) freshLinks.set(order.id, order.path);
			await goto(`/groups/orders/${order.id}`);
		} catch (error) {
			formError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={t('groups.order_new_title')} description={t('groups.order_new_description')} />

<form class="flex max-w-3xl flex-col gap-6" onsubmit={submit} novalidate data-testid="order-form">
	<Field id="order-title" label={t('groups.field_title')} bind:value={title} maxlength={120} required error={errors.title} placeholder={t('groups.order_title_placeholder')} />
	<div class="flex flex-col gap-1.5">
		<Label for="order-note">{t('groups.field_order_note')}</Label>
		<Textarea id="order-note" bind:value={note} maxlength={2000} rows={3} />
	</div>
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="order-deadline">{t('groups.field_deadline')}</Label>
			<Input id="order-deadline" type="datetime-local" bind:value={deadline} aria-invalid={errors.deadline ? true : undefined} />
			<p class="text-xs text-muted-foreground">{t('groups.deadline_hint', { zone })}</p>
			{#if errors.deadline}<p class="text-xs text-destructive">{errors.deadline}</p>{/if}
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="order-catalog">{t('groups.field_catalog')}</Label>
			<Select id="order-catalog" bind:value={catalogId}>
				<option value="">{t('groups.catalog_none')}</option>
				{#each catalogs as catalog (catalog.id)}<option value={catalog.id}>{catalog.name} ({t('groups.catalog_items', { count: catalog.itemCount })})</option>{/each}
			</Select>
			<p class="text-xs text-muted-foreground">{t('groups.catalog_hint')} <a href="/groups/catalogs" class="text-ui-accent-ink underline">{t('groups.catalogs_link')}</a></p>
		</div>
	</div>
	{#if formError}<Alert variant="destructive" data-testid="form-error">{formError}</Alert>{/if}
	<div class="flex flex-wrap gap-2">
		<Button type="submit" disabled={busy}>{t('groups.order_create')}</Button>
		<a href="/groups" class="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted">{t('common.cancel')}</a>
	</div>
</form>
