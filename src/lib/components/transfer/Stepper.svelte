<script lang="ts">
	import { t } from '#lib/i18n/index.js';

	let { steps, current, label }: { steps: { id: string; label: string }[]; current: string; label: string } = $props();
	const index = $derived(steps.findIndex((s) => s.id === current));
</script>

<nav aria-label={label}>
	<p class="mb-2 text-sm text-muted-foreground sm:hidden" data-testid="stepper-compact">
		{t('import.step_of', { current: index + 1, total: steps.length, name: steps[index]?.label ?? '' })}
	</p>
	<ol class="hidden gap-2 sm:flex" data-testid="stepper">
		{#each steps as step, i (step.id)}
			<li class="flex flex-1 items-center gap-2 text-sm" aria-current={step.id === current ? 'step' : undefined}>
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium {i < index
						? 'border-primary bg-primary text-primary-foreground'
						: i === index
							? 'border-primary text-primary'
							: 'text-muted-foreground'}"
					aria-hidden="true">{i + 1}</span
				>
				<span class={i === index ? 'font-medium' : 'text-muted-foreground'}>{step.label}</span>
			</li>
		{/each}
	</ol>
</nav>
