<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	export const alertVariants = tv({
		base: "relative w-full rounded-lg border px-4 py-3 text-sm",
		variants: {
			variant: {
				default: "bg-card text-card-foreground",
				destructive: "border-destructive/40 bg-destructive/10 text-destructive",
				warning: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
				success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
			},
		},
		defaultVariants: { variant: "default" },
	});
	export type AlertVariant = VariantProps<typeof alertVariants>["variant"];
</script>

<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn } from "#lib/utils.js";

	let {
		class: className,
		variant = "default",
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant } = $props();
</script>

<div
	data-slot="alert"
	role={variant === "destructive" ? "alert" : "status"}
	class={cn(alertVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
