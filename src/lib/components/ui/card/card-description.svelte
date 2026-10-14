<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "#lib/utils.js";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLElement> = $props();
</script>

<p data-slot="card-description" class={cn("text-sm text-muted-foreground", className)} {...restProps}>
	{@render children?.()}
</p>
