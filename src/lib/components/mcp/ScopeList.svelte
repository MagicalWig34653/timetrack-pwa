<script lang="ts">
	import type { McpScope } from '#lib/api/types.js';
	import { scopeText, t } from '#lib/i18n/index.js';
	import { isWriteScope } from '#lib/mcp/scopes.js';

	let { scopes }: { scopes: readonly McpScope[] } = $props();
</script>

<ul class="flex flex-wrap gap-1.5" aria-label={t('scope.group')}>
	{#each scopes as scope (scope)}
		<li
			title={scopeText(scope).description}
			data-write={isWriteScope(scope) ? 'true' : undefined}
			class="rounded-full border px-2 py-0.5 text-xs {isWriteScope(scope) ? 'border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200' : 'text-muted-foreground'}"
		>
			{scopeText(scope).label}
		</li>
	{/each}
</ul>
