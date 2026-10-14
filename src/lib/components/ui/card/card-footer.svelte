<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "#lib/utils.js";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLElement> = $props();
</script>

<div data-slot="card-footer" class={cn("flex items-center gap-2 px-6", className)} {...restProps}>
	{@render children?.()}
</div>
