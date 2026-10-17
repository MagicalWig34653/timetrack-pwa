<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	/** Loading placeholder with the geometry of the real page; motion is skipped for reduced-motion users. */
	let { rows = 'cards' }: { rows?: 'cards' | 'rows' } = $props();
</script>

<div class="flex flex-col gap-4" role="status" aria-busy="true" aria-label={t('weekview.loading')} data-testid="week-skeleton">
	<div class="grid gap-4 sm:grid-cols-2 wide:grid-cols-4">
		{#each [0, 1, 2, 3] as item (item)}<div class="h-[108px] rounded-[10px] border bg-card motion-safe:animate-pulse"></div>{/each}
	</div>
	{#if rows === 'cards'}
		<div class="grid gap-3 lg:grid-cols-7">
			{#each [0, 1, 2, 3, 4, 5, 6] as item (item)}<div class="h-20 rounded-[10px] border bg-card motion-safe:animate-pulse lg:h-48"></div>{/each}
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each [0, 1, 2, 3, 4, 5, 6] as item (item)}<div class="h-16 rounded-[10px] border bg-card motion-safe:animate-pulse"></div>{/each}
		</div>
	{/if}
</div>
