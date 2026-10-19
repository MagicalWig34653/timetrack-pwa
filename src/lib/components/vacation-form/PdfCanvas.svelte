<script module lang="ts">
	export interface Marker {
		id: string;
		x: number;
		y: number;
		label: string;
	}
</script>

<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { openPreview, type PdfPreview } from '#lib/vacation-form/preview.js';

	/**
	 * One rendered PDF page (pdf.js, loaded on first use). With `onplace` a click reports the PDF coordinates
	 * (points, origin bottom-left) so a text position can be set on a flat PDF; `markers` show the positions already set.
	 */
	let {
		bytes,
		page = 0,
		pageHeight = 842,
		markers = [],
		onplace,
		onpages,
		alt
	}: {
		bytes: Uint8Array;
		page?: number;
		pageHeight?: number;
		markers?: Marker[];
		onplace?: (x: number, y: number) => void;
		onpages?: (count: number) => void;
		alt: string;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let box: HTMLDivElement | undefined = $state();
	let boxWidth = $state(0);
	let doc = $state<PdfPreview | null>(null);
	let scale = $state(1);
	let failed = $state(false);
	let rendering = $state(false);
	const width = $derived(Math.max(240, Math.min(boxWidth || 600, 640)));

	$effect(() => {
		const source = bytes;
		let cancelled = false;
		let opened: PdfPreview | null = null;
		failed = false;
		openPreview(source).then(
			(preview) => {
				if (cancelled) return void preview.destroy();
				opened = preview;
				doc = preview;
				onpages?.(preview.pageCount);
			},
			() => {
				if (!cancelled) failed = true;
			}
		);
		return () => {
			cancelled = true;
			doc = null;
			void opened?.destroy();
		};
	});

	$effect(() => {
		const current = doc;
		const target = canvas;
		const index = Math.min(page, (current?.pageCount ?? 1) - 1);
		const cssWidth = width;
		if (!current || !target) return;
		let cancelled = false;
		rendering = true;
		current.render(index, target, cssWidth).then(
			(result) => {
				if (cancelled) return;
				scale = result.scale;
				rendering = false;
			},
			() => {
				if (!cancelled) {
					failed = true;
					rendering = false;
				}
			}
		);
		return () => {
			cancelled = true;
		};
	});

	function click(event: MouseEvent) {
		if (!onplace || !canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = (event.clientX - rect.left) / scale;
		const y = pageHeight - (event.clientY - rect.top) / scale;
		onplace(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
	}
</script>

<div bind:this={box} bind:clientWidth={boxWidth} class="w-full" data-testid="pdf-canvas">
	{#if failed}
		<p class="text-sm text-destructive" data-testid="pdf-canvas-error">{t('vform.preview_error')}</p>
	{:else}
		<div class="relative mx-auto w-fit max-w-full overflow-hidden rounded-md border bg-white shadow-sm" aria-busy={rendering}>
			<!-- the sheet stays white in dark mode: it is a paper preview -->
			<canvas
				bind:this={canvas}
				role={onplace ? 'button' : 'img'}
				aria-label={alt}
				tabindex={onplace ? 0 : undefined}
				class="block max-w-full {onplace ? 'cursor-crosshair' : ''}"
				data-testid="pdf-canvas-element"
				onclick={click}
				onkeydown={(event) => onplace && event.key === 'Enter' && onplace(60, pageHeight - 60)}
			></canvas>
			{#each markers as marker (marker.id)}
				<span
					class="pointer-events-none absolute -translate-y-full rounded-sm bg-primary/90 px-1 text-[10px] leading-4 whitespace-nowrap text-primary-foreground"
					style="left: {marker.x * scale}px; top: {(pageHeight - marker.y) * scale}px"
					data-testid="pdf-marker"
				>
					{marker.label}
				</span>
			{/each}
		</div>
	{/if}
</div>
