<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "#lib/utils.js";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLElement> = $props();
</script>

<div
	data-slot="card"
	class={cn("flex flex-col gap-4 rounded-xl border bg-card py-6 text-card-foreground shadow-xs", className)}
	{...restProps}
>
	{@render children?.()}
</div>
