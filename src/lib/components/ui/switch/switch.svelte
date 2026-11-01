<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "#lib/utils.js";

	// A native checkbox exposed as a switch (role="switch"): keyboard (Space), label association and
	// form semantics come from the browser; the visible track/thumb are drawn by the sibling span.
	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: WithElementRef<Omit<HTMLInputAttributes, "type" | "checked" | "role">> & { checked?: boolean } = $props();
</script>

<span class={cn("relative inline-flex h-6 w-11 shrink-0", className)}>
	<input
		bind:this={ref}
		bind:checked
		type="checkbox"
		role="switch"
		data-slot="switch"
		class="peer absolute -inset-2 z-10 m-0 size-auto cursor-pointer opacity-0 disabled:cursor-not-allowed"
		{...restProps}
	/>
	<span
		aria-hidden="true"
		class="pointer-events-none inline-flex h-6 w-11 items-center rounded-full border border-transparent bg-input px-0.5 transition-colors after:block after:size-5 after:rounded-full after:bg-background after:shadow-sm after:transition-transform after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:opacity-50 dark:bg-input/80 dark:peer-checked:bg-primary"
	></span>
</span>
