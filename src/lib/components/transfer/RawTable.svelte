<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { columnLetter } from '#lib/transfer/import-flow.js';

	let {
		rows,
		headerRow,
		onheader
	}: {
		rows: (string | null)[][];
		/** 1-based row number of the header row; 0 = none */
		headerRow: number;
		onheader: (row: number) => void;
	} = $props();

	const columns = $derived(rows.reduce((max, r) => Math.max(max, r.length), 0));
</script>

{#if rows.length === 0}
	<p class="text-sm text-muted-foreground">{t('import.raw_empty')}</p>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="max-h-96 overflow-auto rounded-lg border" tabindex="0" role="region" aria-label={t('import.raw_caption')} data-testid="raw-table">
		<table class="w-full text-sm">
			<caption class="sr-only">{t('import.raw_caption')}</caption>
			<thead class="sticky top-0 bg-muted text-left">
				<tr>
					<th scope="col" class="px-2 py-1.5 font-medium">{t('import.raw_header_col')}</th>
					<th scope="col" class="px-2 py-1.5 font-medium">{t('import.raw_row')}</th>
					{#each Array.from({ length: columns }, (_, i) => i) as c (c)}
						<th scope="col" class="px-2 py-1.5 font-medium">{columnLetter(c)}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row, i (i)}
					<tr class="border-t {headerRow === i + 1 ? 'bg-primary/10 font-medium' : ''}" data-header={headerRow === i + 1 ? 'true' : undefined}>
						<td class="px-2 py-1">
							<input
								type="radio"
								name="header-row"
								class="size-4 accent-primary"
								checked={headerRow === i + 1}
								aria-label={t('import.raw_header_row', { row: i + 1 })}
								onchange={() => onheader(i + 1)}
							/>
						</td>
						<th scope="row" class="px-2 py-1 text-left font-normal text-muted-foreground tabular-nums">{i + 1}</th>
						{#each Array.from({ length: columns }, (_, c) => c) as c (c)}
							<td class="max-w-48 truncate px-2 py-1 whitespace-nowrap">{row[c] ?? ''}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
