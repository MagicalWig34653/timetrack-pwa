<script lang="ts">
	import type { McpScope } from '#lib/api/types.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { scopeText, t } from '#lib/i18n/index.js';
	import { isWriteScope, toggleScope } from '#lib/mcp/scopes.js';

	let {
		scopes,
		selected = $bindable([]),
		legend,
		hint,
		disabled = false,
		idPrefix = 'scope'
	}: { scopes: readonly McpScope[]; selected?: McpScope[]; legend: string; hint?: string; disabled?: boolean; idPrefix?: string } = $props();
</script>

<fieldset class="flex flex-col gap-2" {disabled}>
	<legend class="text-sm font-medium">{legend}</legend>
	{#if hint}<p class="text-xs text-muted-foreground">{hint}</p>{/if}
	<ul class="flex flex-col gap-2">
		{#each scopes as scope (scope)}
			{@const text = scopeText(scope)}
			{@const write = isWriteScope(scope)}
			<li>
				<label
					for="{idPrefix}-{scope}"
					data-write={write ? 'true' : undefined}
					class="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm {write ? 'border-amber-500/50 bg-amber-500/10' : 'bg-card'}"
				>
					<Checkbox
						id="{idPrefix}-{scope}"
						class="mt-0.5"
						checked={selected.includes(scope)}
						onchange={(e) => (selected = toggleScope(selected, scope, e.currentTarget.checked))}
					/>
					<span class="flex min-w-0 flex-col gap-0.5">
						<span class="flex flex-wrap items-center gap-2 font-medium">
							{text.label}
							{#if write}
								<span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">{t('scope.write_badge')}</span>
							{/if}
						</span>
						<span class="text-muted-foreground">{text.description}</span>
					</span>
				</label>
			</li>
		{/each}
	</ul>
</fieldset>
