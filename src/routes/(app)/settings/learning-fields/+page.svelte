<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { LearningField } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { onMount } from 'svelte';

	interface FieldForm {
		number: string;
		name: string;
		sortOrder: string;
	}
	const blank = (): FieldForm => ({ number: '', name: '', sortOrder: '0' });

	let load = $state<LoadState>({ status: 'loading' });
	let fields = $state<LearningField[]>([]);
	let editing = $state<LearningField | 'new' | null>(null);
	let form = $state<FieldForm>(blank());
	let errors = $state<Partial<Record<keyof FieldForm, string>>>({});
	let formError = $state('');
	let notice = $state('');
	let pending = $state(false);
	let deleting = $state<string | null>(null);

	async function refresh() {
		try {
			fields = await api.listLearningFields();
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	function open(target: LearningField | 'new') {
		editing = target;
		deleting = null;
		notice = formError = '';
		errors = {};
		form =
			target === 'new'
				? { ...blank(), sortOrder: String(Math.max(-1, ...fields.map((f) => f.sortOrder ?? 0)) + 1) }
				: { number: target.number == null ? '' : String(target.number), name: target.name, sortOrder: String(target.sortOrder ?? 0) };
	}

	function validate(): { number: number | null; name: string; sortOrder: number } | null {
		const next: typeof errors = {};
		const name = form.name.trim();
		if (name === '' || name.length > 120) next.name = t('learning.name_required');
		const numberText = form.number.trim();
		const number = numberText === '' ? null : Number(numberText);
		if (number !== null && (!/^\d+$/.test(numberText) || !Number.isSafeInteger(number))) next.number = t('learning.number_invalid');
		const sortText = form.sortOrder.trim() === '' ? '0' : form.sortOrder.trim();
		const sortOrder = Number(sortText);
		if (!/^-?\d+$/.test(sortText) || !Number.isSafeInteger(sortOrder)) next.sortOrder = t('learning.sort_invalid');
		errors = next;
		return Object.keys(next).length > 0 ? null : { number, name, sortOrder };
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		formError = notice = '';
		const input = validate();
		if (!input || pending || !editing) return;
		pending = true;
		try {
			if (editing === 'new') await api.createLearningField(input);
			else await api.updateLearningField(editing.id, input);
			editing = null;
			notice = t('learning.saved');
			await refresh();
		} catch (error) {
			formError = errorMessage(error);
		} finally {
			pending = false;
		}
	}

	async function remove(field: LearningField) {
		formError = notice = '';
		try {
			await api.deleteLearningField(field.id);
			deleting = null;
			notice = t('learning.deleted');
			await refresh();
		} catch (error) {
			formError = errorMessage(error);
		}
	}

	const labelOf = (f: LearningField) => (f.number != null ? `${f.number} · ${f.name}` : f.name);
</script>

<PageHeader title={t('learning.title')} description={t('learning.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Alert variant="warning" data-testid="learning-unavailable">{t('learning.unavailable')}</Alert>
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<Alert data-testid="learning-note">{t('learning.note_old')}</Alert>
		{#if notice}<Alert variant="success" data-testid="learning-notice">{notice}</Alert>{/if}
		{#if formError && !editing}<Alert variant="destructive" data-testid="learning-error">{formError}</Alert>{/if}

		<Card>
			<CardHeader>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>{t('learning.list')}</CardTitle>
					<Button size="sm" onclick={() => open('new')} data-testid="learning-add">{t('learning.add')}</Button>
				</div>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				<ul class="flex flex-col gap-2" aria-label={t('learning.list')} data-testid="learning-list">
					{#each fields as field (field.id)}
						<li class="rounded-md border bg-background p-3 text-sm" data-testid="learning-field">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="min-w-0 break-words font-medium">{labelOf(field)}</span>
								{#if deleting !== field.id}
									<span class="flex gap-2">
										<Button type="button" size="sm" variant="outline" aria-label={t('learning.edit_label', { name: field.name })} onclick={() => open(field)}>{t('learning.edit')}</Button>
										<Button type="button" size="sm" variant="ghost" aria-label={t('learning.delete_label', { name: field.name })} onclick={() => ((deleting = field.id), (editing = null))}>{t('learning.delete')}</Button>
									</span>
								{/if}
							</div>
							{#if deleting === field.id}
								<Alert variant="warning" class="mt-3" data-testid="learning-delete-confirm">
									<p>{t('learning.delete_confirm', { name: field.name })}</p>
									<div class="mt-2 flex flex-wrap gap-2">
										<Button type="button" size="sm" variant="destructive" onclick={() => remove(field)} data-testid="learning-delete-yes">{t('learning.delete_yes')}</Button>
										<Button type="button" size="sm" variant="outline" onclick={() => (deleting = null)}>{t('common.cancel')}</Button>
									</div>
								</Alert>
							{/if}
						</li>
					{:else}
						<li class="text-sm text-muted-foreground">{t('learning.empty')}</li>
					{/each}
				</ul>

				{#if editing}
					<form class="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4" aria-label={editing === 'new' ? t('learning.add') : t('learning.edit_title')} novalidate onsubmit={save} data-testid="learning-form">
						<h3 class="text-sm font-semibold">{editing === 'new' ? t('learning.add') : t('learning.edit_title')}</h3>
						{#if formError}<Alert variant="destructive" data-testid="learning-form-error">{formError}</Alert>{/if}
						<div class="grid gap-3 sm:grid-cols-[8rem_1fr_8rem]">
							<Field id="lf-number" label={t('learning.number')} bind:value={form.number} inputmode="numeric" error={errors.number} data-testid="learning-number" />
							<Field id="lf-name" label={t('learning.name')} bind:value={form.name} maxlength={120} error={errors.name} data-testid="learning-name" />
							<Field id="lf-sort" label={t('learning.sort_order')} bind:value={form.sortOrder} inputmode="numeric" hint={t('learning.sort_hint')} error={errors.sortOrder} data-testid="learning-sort" />
						</div>
						<div class="flex flex-wrap gap-2">
							<Button type="submit" disabled={pending} data-testid="learning-save">{t('learning.save')}</Button>
							<Button type="button" variant="outline" onclick={() => (editing = null)}>{t('common.cancel')}</Button>
						</div>
					</form>
				{/if}
			</CardContent>
		</Card>
	</div>
{/if}
