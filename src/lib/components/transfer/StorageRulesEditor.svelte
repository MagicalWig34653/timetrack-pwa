<script lang="ts">
	import type { StorageBackend } from '#lib/api/types.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { SIZE_UNITS } from '#lib/transfer/bytes.js';
	import { newRowKey, validateRules, type StorageForm } from '#lib/transfer/storage-rules.js';

	let { form = $bindable(), showIssues = false }: { form: StorageForm; showIssues?: boolean } = $props();

	const backends: StorageBackend[] = ['db', 's3', 'local'];
	const issues = $derived(validateRules(form));

	function add() {
		const last = form.rules.at(-1);
		form.rules.push({ key: newRowKey(), amount: last ? String(Number(last.amount) * 2 || 1) : '1', unit: last?.unit ?? 'MiB', backend: 'db' });
	}
</script>

<ol class="flex flex-col gap-3" data-testid="storage-rules">
	{#each form.rules as row, i (row.key)}
		<li class="flex flex-col gap-1">
			<div class="flex flex-wrap items-end gap-2" data-testid="storage-rule">
				<span class="w-full text-sm font-medium sm:w-auto sm:pb-2">{t('storage.rule_up_to')}</span>
				<Input
					class="w-24"
					inputmode="decimal"
					aria-label={t('storage.rule_amount', { n: i + 1 })}
					aria-invalid={showIssues && issues.rows[i] ? true : undefined}
					bind:value={row.amount}
				/>
				<Select class="w-24" aria-label={t('storage.rule_unit', { n: i + 1 })} bind:value={row.unit}>
					{#each SIZE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
				</Select>
				<span class="pb-2 text-sm" aria-hidden="true">→</span>
				<Select class="w-44" aria-label={t('storage.rule_backend', { n: i + 1 })} bind:value={row.backend}>
					{#each backends as backend (backend)}<option value={backend}>{t(`storage.backend.${backend}` as MessageKey)}</option>{/each}
				</Select>
				<Button type="button" variant="ghost" size="sm" aria-label={t('storage.rule_remove', { n: i + 1 })} onclick={() => form.rules.splice(i, 1)}>{t('common.remove')}</Button>
			</div>
			{#if showIssues && issues.rows[i]}<p class="text-xs text-destructive" data-testid="rule-issue">{t(`storage.issue.${issues.rows[i]}` as MessageKey)}</p>{/if}
		</li>
	{/each}
	<li class="flex flex-wrap items-end gap-2" data-testid="storage-rule-rest">
		<span class="w-full text-sm font-medium sm:w-auto sm:pb-2">{t('storage.rule_rest')}</span>
		<span class="pb-2 text-sm" aria-hidden="true">→</span>
		<Select class="w-44" aria-label={t('storage.rule_rest_backend')} bind:value={form.lastBackend}>
			{#each backends as backend (backend)}<option value={backend}>{t(`storage.backend.${backend}` as MessageKey)}</option>{/each}
		</Select>
	</li>
</ol>
<div class="mt-3"><Button type="button" variant="outline" size="sm" onclick={add}>{t('storage.rule_add')}</Button></div>
