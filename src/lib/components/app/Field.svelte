<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		id,
		label,
		value = $bindable(''),
		hint,
		error,
		...rest
	}: { id: string; label: string; value?: string; hint?: string; error?: string } & Omit<
		HTMLInputAttributes,
		'id' | 'value'
	> = $props();
</script>

<div class="flex flex-col gap-1.5">
	<Label for={id}>{label}</Label>
	<Input
		{id}
		bind:value
		aria-invalid={error ? true : undefined}
		aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].join(' ').trim() || undefined}
		{...rest}
	/>
	{#if hint}<p id="{id}-hint" class="text-xs text-muted-foreground">{hint}</p>{/if}
	{#if error}<p id="{id}-error" class="text-xs text-destructive">{error}</p>{/if}
</div>
