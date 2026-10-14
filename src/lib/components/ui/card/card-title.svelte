<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "#lib/utils.js";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLElement> = $props();
</script>

<h2 data-slot="card-title" class={cn("text-base leading-none font-semibold", className)} {...restProps}>
	{@render children?.()}
</h2>
