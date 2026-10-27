<script lang="ts">
	import '../week/planner-colors.css';
	import type { CellModel } from '#lib/planning/cell-model.js';

	/**
	 * Compact day timeline of a month cell (C2): plan blocks as bars in the planner's colours and patterns (same
	 * data-plan-mode hooks as the week grid), tracked time as a dashed bar below. Purely decorative; the cell's
	 * accessible name carries the information.
	 */
	let { model, tall = false }: { model: CellModel; tall?: boolean } = $props();
</script>

<span class="mt" class:tall aria-hidden="true" data-testid="mini-timeline" data-has-plan={model.plan.length > 0 ? 'true' : undefined} data-has-actual={model.actual ? 'true' : undefined}>
	<span class="lane">
		{#each model.plan as bar, i (i)}
			<span class="bar" data-plan-mode={bar.kind} data-bar={bar.kind} style="left:{bar.left}%;width:{bar.width}%"></span>
		{/each}
	</span>
	<span class="lane">
		{#if model.actual}<span class="bar actual" data-bar="actual" style="left:{model.actual.left}%;width:{model.actual.width}%"></span>{/if}
	</span>
</span>

<style>
	.mt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		margin-top: auto;
	}
	.lane {
		position: relative;
		display: block;
		height: 6px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--foreground) 6%, transparent);
	}
	.tall .lane {
		height: 8px;
	}
	.bar {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 3px;
		background: var(--pm);
	}
	.bar[data-plan-mode='school'] {
		background: repeating-linear-gradient(135deg, var(--pm) 0 2px, color-mix(in srgb, var(--pm) 45%, transparent) 2px 4px);
	}
	.bar[data-plan-mode='travel'] {
		background: radial-gradient(var(--pm) 1px, color-mix(in srgb, var(--pm) 40%, transparent) 1.4px) 0 0 / 4px 4px;
	}
	.bar[data-plan-mode='home'] {
		background: repeating-linear-gradient(0deg, var(--pm) 0 1px, color-mix(in srgb, var(--pm) 45%, transparent) 1px 3px);
	}
	.bar[data-plan-mode='customer'] {
		background: repeating-linear-gradient(45deg, var(--pm) 0 1px, color-mix(in srgb, var(--pm) 50%, transparent) 1px 3px);
	}
	.bar.actual {
		background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--foreground) 55%, transparent) 0 3px, color-mix(in srgb, var(--foreground) 25%, transparent) 3px 6px);
		border: 1px dashed color-mix(in srgb, var(--foreground) 60%, transparent);
	}
</style>
