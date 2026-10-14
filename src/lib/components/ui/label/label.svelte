<script lang="ts">
	import type { HTMLLabelAttributes } from "svelte/elements";
	import { cn } from "#lib/utils.js";

	let { class: className, children, ...restProps }: HTMLLabelAttributes = $props();
</script>

<label
	data-slot="label"
	class={cn("flex items-center gap-2 text-sm leading-none font-medium select-none", className)}
	{...restProps}
>
	{@render children?.()}
</label>
