<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "#lib/utils.js";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLElement> = $props();
</script>

<div
	data-slot="card"
	class={cn("ui-card flex flex-col gap-4 rounded-[10px] border bg-card py-6 text-card-foreground shadow-[var(--shadow-card)]", className)}
	{...restProps}
>
	{@render children?.()}
</div>
