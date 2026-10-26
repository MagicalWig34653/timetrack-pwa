<script lang="ts">
	import { timeDisplay } from '#lib/time/display.svelte.js';
	import { t } from '#lib/i18n/index.js';

	/**
	 * A duration that toggles the global display (h:mm <-> decimal hours) on click. Button semantics for keyboard use.
	 * Never place it inside another interactive element; use timeDisplay.duration() as plain text there.
	 */
	let { seconds, delta = false, prefix = '', class: className = '' }: { seconds: number; delta?: boolean; prefix?: string; class?: string } = $props();
	const text = $derived(delta ? timeDisplay.delta(seconds) : timeDisplay.duration(seconds));
</script>

<button
	type="button"
	class="cursor-pointer rounded-sm bg-transparent p-0 text-inherit [font:inherit] tabular-nums decoration-dotted underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {className}"
	title={timeDisplay.mode === 'hm' ? t('time_display.hint_hm') : t('time_display.hint_decimal')}
	onclick={() => timeDisplay.toggle()}
>{prefix}{text}</button>
