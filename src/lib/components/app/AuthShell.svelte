<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from '#lib/i18n/index.js';

	let { title, description, children }: { title: string; description?: string; children: Snippet } = $props();
</script>

<svelte:head><title>{title} – Timetrack</title></svelte:head>
<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
	<p class="text-center text-sm font-semibold tracking-wide text-muted-foreground">{t('app.name')}</p>
	<div class="flex flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-xs">
		<div>
			<h1 class="text-xl font-semibold tracking-tight">{title}</h1>
			{#if description}<p class="mt-1 text-sm text-muted-foreground">{description}</p>{/if}
		</div>
		{@render children()}
	</div>
</main>
