<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: WithElementRef<Omit<HTMLInputAttributes, "type" | "checked">> & { checked?: boolean } = $props();
</script>

<input
	bind:this={ref}
	bind:checked
	type="checkbox"
	data-slot="checkbox"
	class={cn(
		"size-4 shrink-0 rounded-[4px] border border-input accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	{...restProps}
/>
