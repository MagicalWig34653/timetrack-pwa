<script lang="ts">
	import type { ImportTemplate } from '#lib/api/types.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';

	let {
		templates,
		templatesUnavailable,
		busy,
		onapply,
		onsave,
		ondelete
	}: {
		templates: ImportTemplate[];
		templatesUnavailable: boolean;
		busy: boolean;
		onapply: (template: ImportTemplate) => void;
		onsave: (name: string) => void;
		ondelete: (template: ImportTemplate) => void;
	} = $props();

	let templateId = $state('');
	let templateName = $state('');
	let nameError = $state(false);
	const selected = $derived(templates.find((x) => x.id === templateId));
</script>

<section class="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="templates-heading">
	<h4 id="templates-heading" class="text-sm font-medium">{t('import.templates_title')}</h4>
	{#if templatesUnavailable}
		<p class="text-sm text-muted-foreground">{t('import.templates_unavailable')}</p>
	{:else}
		<p class="text-xs text-muted-foreground">{t('import.templates_text')}</p>
		<div class="flex flex-wrap items-end gap-2">
			<div class="flex min-w-48 flex-1 flex-col gap-1.5">
				<Label for="template-select">{t('import.template_select')}</Label>
				<Select id="template-select" bind:value={templateId}>
					<option value="">{t('import.template_none')}</option>
					{#each templates as template (template.id)}<option value={template.id}>{template.name}</option>{/each}
				</Select>
			</div>
			<Button type="button" variant="outline" disabled={!selected || busy} onclick={() => selected && onapply(selected)}>{t('import.template_apply')}</Button>
			<Button type="button" variant="destructive" disabled={!selected || busy} onclick={() => selected && ondelete(selected)}>{t('import.template_delete')}</Button>
		</div>
		<form
			class="flex flex-wrap items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				const name = templateName.trim();
				nameError = name === '' || name.length > 80;
				if (!nameError) {
					onsave(name);
					templateName = '';
				}
			}}
		>
			<div class="flex min-w-48 flex-1 flex-col gap-1.5">
				<Label for="template-name">{t('import.template_name')}</Label>
				<Input id="template-name" bind:value={templateName} maxlength={80} aria-invalid={nameError ? true : undefined} />
				{#if nameError}<p class="text-xs text-destructive">{t('import.template_name_required')}</p>{/if}
			</div>
			<Button type="submit" variant="outline" disabled={busy}>{t('import.template_save')}</Button>
		</form>
	{/if}
</section>
