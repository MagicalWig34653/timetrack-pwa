<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';

	/** Two views of one week. They are separate routes (overview = core, planner = planning module) that share the week. */
	let { current, week }: { current: 'overview' | 'plan'; week: string } = $props();
	const tab = 'inline-flex h-8 items-center rounded-md px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
</script>

<nav class="mb-5 inline-flex rounded-lg bg-muted p-0.5 print:hidden" aria-label={t('weekview.tabs_label')} data-testid="week-tabs">
	<a href="/week?week={week}" class={tab} aria-current={current === 'overview' ? 'page' : undefined} data-testid="tab-overview">{t('weekview.tab_overview')}</a>
	{#if moduleStore.enabled('planning')}
		<a href="/plan?week={week}" class={tab} aria-current={current === 'plan' ? 'page' : undefined} data-testid="tab-plan">{t('weekview.tab_plan')}</a>
	{/if}
</nav>
