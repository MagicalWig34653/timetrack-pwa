// Size and magic-number checks that do not need pdf-lib, so they can be used without loading it.
export const PDF_MAX_BYTES = 5 * 1024 * 1024;

export type PdfProblem = 'not_pdf' | 'too_large' | 'empty' | 'encrypted' | 'unreadable';

export class PdfError extends Error {
	constructor(public readonly problem: PdfProblem) {
		super(problem);
		this.name = 'PdfError';
	}
}

/** `%PDF-` within the first 1024 bytes (Acrobat accepts leading junk up to that offset). */
export function hasPdfMagic(bytes: Uint8Array): boolean {
	const head = bytes.subarray(0, 1024);
	const needle = [0x25, 0x50, 0x44, 0x46, 0x2d];
	for (let i = 0; i + needle.length <= head.length; i++) {
		if (needle.every((byte, offset) => head[i + offset] === byte)) return true;
	}
	return false;
}

/** Size and magic-number check for an uploaded file; throws PdfError. */
export function validatePdfBytes(bytes: Uint8Array): void {
	if (bytes.length === 0) throw new PdfError('empty');
	if (bytes.length > PDF_MAX_BYTES) throw new PdfError('too_large');
	if (!hasPdfMagic(bytes)) throw new PdfError('not_pdf');
}

/** File name for the generated request: Urlaubsantrag_2026-07-06_2026-07-17.pdf */
export function requestFileName(from: string, to: string): string {
	return `Urlaubsantrag_${from}_${to}.pdf`;
}
