<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { DATE_FORMATS, formatFormDate, type DateFormatId } from '#lib/vacation-form/format.js';
	import { newBinding } from '#lib/vacation-form/mapping.js';
	import { MAX_FREE_RANGES, sourceDef, sourcesFor, type SourceGroup } from '#lib/vacation-form/sources.js';
	import type { Binding, SourceId, TargetKind } from '#lib/vacation-form/types.js';

	/** Source dropdown for one PDF target plus the options its source needs (text, tick, range number, date format). */
	let {
		id,
		kind,
		binding,
		label,
		onchange
	}: { id: string; kind: TargetKind; binding: Binding | null; label: string; onchange: (binding: Binding | null) => void } = $props();

	const GROUPS: SourceGroup[] = ['person', 'balance', 'request', 'fixed'];
	const available = $derived(sourcesFor(kind));
	const def = $derived(binding ? sourceDef(binding.source) : null);
	const isDate = $derived(!!binding && /^(dateFrom|dateTo|dateRange|today|freeRange|freeRangeFrom|freeRangeTo)$/.test(binding.source));

	function pick(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		onchange(value === '' ? null : newBinding(value as SourceId));
	}
	function patch(change: Partial<Binding>) {
		if (binding) onchange({ ...binding, ...change });
	}
</script>

<div class="flex flex-col gap-2">
	<Label for={id} class="sr-only">{label}</Label>
	<Select {id} value={binding?.source ?? ''} onchange={pick} data-testid="binding-{id}">
		<option value="">{t('vform.field_none')}</option>
		{#each GROUPS as group (group)}
			{@const items = available.filter((source) => source.group === group)}
			{#if items.length > 0}
				<optgroup label={t(`vform.source_group.${group}` as MessageKey)}>
					{#each items as source (source.id)}
						<option value={source.id}>{t(source.label)}</option>
					{/each}
				</optgroup>
			{/if}
		{/each}
	</Select>
	{#if binding && def}
		<div class="flex flex-wrap items-end gap-3">
			{#if def.option === 'text'}
				<div class="flex min-w-40 flex-1 flex-col gap-1">
					<Label for="{id}-text" class="text-xs">{t('vform.option_text')}</Label>
					<Input id="{id}-text" value={binding.text ?? ''} maxlength={500} oninput={(e) => patch({ text: e.currentTarget.value })} />
				</div>
			{:else if def.option === 'checked'}
				<div class="flex items-center gap-2">
					<Checkbox id="{id}-checked" checked={binding.checked === true} onchange={(e) => patch({ checked: e.currentTarget.checked })} />
					<Label for="{id}-checked" class="text-sm">{t('vform.option_checked')}</Label>
				</div>
			{:else if def.option === 'index'}
				<div class="flex w-28 flex-col gap-1">
					<Label for="{id}-index" class="text-xs">{t('vform.option_index')}</Label>
					<Input id="{id}-index" type="number" min="1" max={MAX_FREE_RANGES} step="1" value={binding.index ?? 1} oninput={(e) => patch({ index: Number(e.currentTarget.value) || 1 })} />
				</div>
			{:else if def.option === 'scope'}
				<div class="flex min-w-48 flex-col gap-1">
					<Label for="{id}-scope" class="text-xs">{t('vform.option_scope')}</Label>
					<Select id="{id}-scope" value={binding.scope ?? 'all'} onchange={(e) => patch({ scope: e.currentTarget.value === 'decided' ? 'decided' : 'all' })}>
						<option value="all">{t('vform.option_scope_all')}</option>
						<option value="decided">{t('vform.option_scope_decided')}</option>
					</Select>
				</div>
			{/if}
			{#if isDate}
				<div class="flex min-w-36 flex-col gap-1">
					<Label for="{id}-format" class="text-xs">{t('vform.option_date_format')}</Label>
					<Select id="{id}-format" value={binding.dateFormat ?? ''} onchange={(e) => patch({ dateFormat: (e.currentTarget.value || undefined) as DateFormatId | undefined })}>
						<option value="">{t('vform.option_date_format_default')}</option>
						{#each DATE_FORMATS as format (format)}
							<option value={format}>{formatFormDate('2026-07-06', format)}</option>
						{/each}
					</Select>
				</div>
			{/if}
		</div>
	{/if}
</div>
