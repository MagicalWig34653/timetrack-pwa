<script lang="ts" generics="T extends string">
	import { t } from '#lib/i18n/index.js';

	/** One choice of a radio group: title, one plain sentence and a concrete example. */
	let {
		name,
		value,
		group = $bindable(),
		label,
		text,
		example,
		testid
	}: { name: string; value: T; group: T; label: string; text: string; example: string; testid?: string } = $props();
</script>

<label class="flex items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-ui-accent has-[:checked]:bg-ui-accent-soft/40">
	<input type="radio" class="mt-0.5 size-4 shrink-0 accent-primary" {name} {value} bind:group data-testid={testid} />
	<span class="min-w-0">
		<span class="block font-medium">{label}</span>
		<span class="mt-0.5 block text-[13px] text-muted-foreground">{text}</span>
		<span class="mt-1 block text-[13px] text-muted-foreground">{t('worktime.example', { text: example })}</span>
	</span>
</label>
