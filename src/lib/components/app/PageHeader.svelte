<script lang="ts">
	let { title, description }: { title: string; description?: string } = $props();
</script>

<svelte:head><title>{title} – Timetrack</title></svelte:head>
<header class="mb-6">
	<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
	{#if description}<p class="mt-1 text-sm text-muted-foreground">{description}</p>{/if}
</header>
