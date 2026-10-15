<script lang="ts">
	import type { HTMLSelectAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLSelectAttributes, HTMLSelectElement> = $props();
</script>

<select
	bind:this={ref}
	bind:value
	data-slot="select"
	class={cn(
		"h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30 dark:[&>option]:bg-card",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</select>
