// Lazy PDF rendering with pdfjs-dist (Apache-2.0). Nothing here is loaded before a preview is requested.
import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

export function loadPdfJs() {
	pdfjsPromise ??= (async () => {
		const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
		pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
		return pdfjs;
	})();
	return pdfjsPromise;
}

export interface PdfPreview {
	pageCount: number;
	/** Renders page `index` (0-based) into the canvas at the given CSS width; returns the scale (pixels per PDF point). */
	render(index: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<{ scale: number; width: number; height: number }>;
	destroy(): Promise<void>;
}

/** Opens the bytes (copied, pdf.js takes ownership of its input) for rendering. */
export async function openPreview(bytes: Uint8Array): Promise<PdfPreview> {
	const pdfjs = await loadPdfJs();
	const task = pdfjs.getDocument({ data: bytes.slice() });
	const doc: PDFDocumentProxy = await task.promise;
	return {
		pageCount: doc.numPages,
		async render(index, canvas, cssWidth) {
			const page = await doc.getPage(index + 1);
			const base = page.getViewport({ scale: 1 });
			const scale = cssWidth / base.width;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			const viewport = page.getViewport({ scale: scale * ratio });
			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			canvas.style.width = `${cssWidth}px`;
			canvas.style.height = `${(base.height * scale).toFixed(1)}px`;
			await page.render({ canvas, viewport }).promise;
			return { scale, width: cssWidth, height: base.height * scale };
		},
		destroy: () => task.destroy()
	};
}
