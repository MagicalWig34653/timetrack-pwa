import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField, StandardFonts, rgb, type PDFField } from 'pdf-lib';
import { resolveBinding } from './sources';
import type { FormMapping, RequestData, TargetKind } from './types';

import { PdfError, validatePdfBytes } from './pdf-limits';

async function loadDocument(bytes: Uint8Array): Promise<PDFDocument> {
	try {
		return await PDFDocument.load(bytes, { updateMetadata: false });
	} catch (error) {
		if (error instanceof Error && /encrypt/i.test(error.message)) throw new PdfError('encrypted');
		throw new PdfError('unreadable');
	}
}

export type DetectedFieldType = 'text' | 'checkbox' | 'dropdown' | 'other';

export interface DetectedField {
	name: string;
	type: DetectedFieldType;
	/** 1-based page number of the first widget, or 0 when it cannot be found */
	page: number;
	/** dropdown options */
	options?: string[];
	readOnly: boolean;
}

export interface PdfInfo {
	pageCount: number;
	/** page sizes in PDF points (width, height), index = page */
	pages: { width: number; height: number }[];
	fields: DetectedField[];
}

export const targetKindOf = (type: DetectedFieldType): TargetKind | null => (type === 'other' ? null : type);

function typeOf(field: PDFField): DetectedFieldType {
	if (field instanceof PDFTextField) return 'text';
	if (field instanceof PDFCheckBox) return 'checkbox';
	if (field instanceof PDFDropdown) return 'dropdown';
	return 'other';
}

/** Page index (0-based) of each widget annotation, keyed by the annotation's object reference string. */
function widgetPages(doc: PDFDocument): Map<string, number> {
	const result = new Map<string, number>();
	doc.getPages().forEach((page, index) => {
		const annots = page.node.Annots();
		if (!annots) return;
		for (let i = 0; i < annots.size(); i++) {
			const ref = annots.get(i);
			result.set(String(ref), index);
		}
	});
	return result;
}

/** Lists page sizes and all fillable fields. Signature, button and radio/list fields show up as `other` (not mappable). */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
	validatePdfBytes(bytes);
	const doc = await loadDocument(bytes);
	const pages = doc.getPages().map((page) => ({ width: page.getWidth(), height: page.getHeight() }));
	const pageOf = widgetPages(doc);
	const fields: DetectedField[] = [];
	for (const field of doc.getForm().getFields()) {
		let page = 0;
		for (const widget of field.acroField.getWidgets()) {
			const ref = doc.context.getObjectRef(widget.dict);
			const index = ref ? pageOf.get(String(ref)) : undefined;
			if (index !== undefined) {
				page = index + 1;
				break;
			}
		}
		const type = typeOf(field);
		fields.push({
			name: field.getName(),
			type,
			page,
			options: field instanceof PDFDropdown ? field.getOptions() : undefined,
			readOnly: field.isReadOnly()
		});
	}
	return { pageCount: pages.length, pages, fields };
}

export interface FillOptions {
	/** overrides mapping.flatten */
	flatten?: boolean;
}

export interface FillResult {
	bytes: Uint8Array;
	/** names of fields whose value could not be written (unsupported characters, dropdown value not offered, ...) */
	skipped: string[];
}

/** Fills a copy of the template with the mapped values; the template bytes are never modified. */
export async function fillPdf(template: Uint8Array, mapping: FormMapping, request: RequestData, options: FillOptions = {}): Promise<FillResult> {
	validatePdfBytes(template);
	const doc = await loadDocument(template);
	const form = doc.getForm();
	const skipped: string[] = [];
	const font = await doc.embedFont(StandardFonts.Helvetica);

	for (const field of form.getFields()) {
		const name = field.getName();
		const binding = mapping.fields[name];
		if (!binding || field.isReadOnly()) continue;
		const value = resolveBinding(binding, mapping, request);
		try {
			if (field instanceof PDFTextField) {
				if (typeof value === 'string') field.setText(value);
				else field.setText(undefined);
			} else if (field instanceof PDFCheckBox) {
				if (value === true) field.check();
				else field.uncheck();
			} else if (field instanceof PDFDropdown) {
				if (typeof value === 'string') {
					if (field.getOptions().includes(value)) field.select(value);
					else skipped.push(name);
				}
			}
		} catch {
			skipped.push(name);
		}
	}

	const pages = doc.getPages();
	for (const overlay of mapping.overlays) {
		const page = pages[overlay.page];
		const value = resolveBinding(overlay.binding, mapping, request);
		if (!page || typeof value !== 'string') continue;
		try {
			page.drawText(value, { x: overlay.x, y: overlay.y, size: overlay.fontSize, font, color: rgb(0, 0, 0) });
		} catch {
			skipped.push(`overlay:${overlay.id}`);
		}
	}

	if (options.flatten ?? mapping.flatten) form.flatten();
	else form.updateFieldAppearances(font);
	return { bytes: await doc.save(), skipped };
}

/** Reads back the current text/checkbox/dropdown values of a PDF (used by tests and the preview check). */
export async function readFieldValues(bytes: Uint8Array): Promise<Record<string, string | boolean | null>> {
	const doc = await loadDocument(bytes);
	const values: Record<string, string | boolean | null> = {};
	for (const field of doc.getForm().getFields()) {
		if (field instanceof PDFTextField) values[field.getName()] = field.getText() ?? null;
		else if (field instanceof PDFCheckBox) values[field.getName()] = field.isChecked();
		else if (field instanceof PDFDropdown) values[field.getName()] = field.getSelected()[0] ?? null;
	}
	return values;
}

export { requestFileName } from './pdf-limits';
