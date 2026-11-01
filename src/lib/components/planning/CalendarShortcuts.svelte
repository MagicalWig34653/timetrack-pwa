<script lang="ts">
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';

	let { returnFocus = null, onclose }: { returnFocus?: HTMLElement | null; onclose: () => void } = $props();

	const rows: [string, MessageKey][] = [
		['← → ↑ ↓', 'cal.sc.arrows'],
		['Shift + ← → ↑ ↓', 'cal.sc.extend'],
		['Pos1 / Ende', 'cal.sc.week_edges'],
		['Bild ↑ / Bild ↓', 'cal.sc.page'],
		['Enter / Leertaste', 'cal.sc.pick'],
		['Alt + ← →', 'cal.sc.move'],
		['Alt + Shift + ← →', 'cal.sc.resize'],
		['Entf', 'cal.sc.delete'],
		['Esc', 'cal.sc.escape'],
		['Strg/Cmd + Z', 'cal.sc.undo'],
		['Strg/Cmd + Shift + Z', 'cal.sc.redo'],
		['T', 'cal.sc.today'],
		['M / J', 'cal.sc.view'],
		['W', 'cal.sc.open_week'],
		['Kontexttaste / Shift + F10', 'cal.sc.menu'],
		['?', 'cal.sc.help']
	];
</script>

<FloatingPanel titleId="cal-sc-title" {returnFocus} {onclose} width={480} data-testid="calendar-shortcuts">
	<div class="flex flex-col gap-4 p-5">
		<h2 id="cal-sc-title" class="text-lg leading-tight font-semibold">{t('cal.sc.title')}</h2>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
			{#each rows as [keys, text] (keys)}
				<dt><kbd class="rounded border bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap">{keys}</kbd></dt>
				<dd>{t(text)}</dd>
			{/each}
		</dl>
		<p class="text-xs text-muted-foreground">{t('cal.sc.pointer')}</p>
		<div class="flex justify-end"><Button type="button" variant="outline" onclick={onclose}>{t('common.close')}</Button></div>
	</div>
</FloatingPanel>
