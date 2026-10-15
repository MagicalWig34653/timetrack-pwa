<script lang="ts">
	import type { Snippet } from 'svelte';
	import Clock from '@lucide/svelte/icons/clock';
	import { t } from '#lib/i18n/index.js';

	let { title, description, children }: { title: string; description?: string; children: Snippet } = $props();
</script>

<svelte:head><title>{title} – Timetrack</title></svelte:head>
<div class="min-h-screen bg-[var(--sidebar)]">
	<main class="mx-auto flex min-h-screen w-full max-w-[26rem] flex-col justify-center gap-6 px-4 py-10">
		<div class="flex items-center justify-center gap-3">
			<span class="inline-flex size-[34px] items-center justify-center rounded-lg border bg-background text-ui-accent-ink" data-testid="brand-mark">
				<Clock class="size-[18px]" aria-hidden="true" />
			</span>
			<span class="text-[17px] font-semibold tracking-tight">{t('app.name')}</span>
		</div>
		<div class="flex flex-col gap-5 rounded-[10px] border bg-card p-[22px] text-card-foreground shadow-[var(--shadow-card)] sm:p-7">
			<div>
				<h1 class="text-[21px] leading-tight font-semibold">{title}</h1>
				{#if description}<p class="mt-1.5 text-sm text-muted-foreground">{description}</p>{/if}
			</div>
			{@render children()}
		</div>
	</main>
</div>
