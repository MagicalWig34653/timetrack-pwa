<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	let {
		prevHref,
		nextHref,
		todayHref,
		date,
		min,
		onpick,
		label
	}: {
		prevHref: string;
		nextHref: string;
		todayHref: string;
		date: string;
		min?: string;
		onpick: (date: string) => void;
		label: string;
	} = $props();
</script>

<nav class="mb-4 flex flex-wrap items-center gap-2" aria-label={label}>
	<Button variant="outline" size="icon" href={prevHref} aria-label={t('datenav.previous')}><ChevronLeft /></Button>
	<Button variant="outline" size="icon" href={nextHref} aria-label={t('datenav.next')}><ChevronRight /></Button>
	<Button variant="outline" size="sm" href={todayHref}>{t('datenav.today')}</Button>
	<label class="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
		<span class="sr-only sm:not-sr-only">{t('datenav.jump')}</span>
		<input
			type="date"
			value={date}
			{min}
			onchange={(e) => e.currentTarget.value && onpick(e.currentTarget.value)}
			class="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30"
		/>
	</label>
</nav>
