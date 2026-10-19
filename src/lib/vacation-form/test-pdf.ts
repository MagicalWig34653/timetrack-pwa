import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Synthetic, neutral fillable PDFs for tests (unit and e2e). Never derived from a real employer form: the field names
 * are generic and the page carries no branding.
 */
export const SYNTHETIC_TEXT_FIELDS = ['last_name', 'first_name', 'personnel_no', 'department', 'date_from', 'date_to', 'substitute', 'working_days', 'rest_days', 'entitlement_total', 'free_from_1', 'free_to_1', 'free_from_2', 'free_to_2'] as const;

export async function makeFormPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = doc.addPage([595, 842]);
	page.drawText('Sample vacation request', { x: 50, y: 790, size: 16, font });
	const form = doc.getForm();
	SYNTHETIC_TEXT_FIELDS.forEach((name, index) => {
		const y = 750 - index * 32;
		page.drawText(name, { x: 50, y: y + 4, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
		const field = form.createTextField(name);
		field.addToPage(page, { x: 200, y, width: 220, height: 20 });
	});
	const box = form.createCheckBox('company_box');
	box.addToPage(page, { x: 200, y: 750 - SYNTHETIC_TEXT_FIELDS.length * 32, width: 16, height: 16 });
	const dropdown = form.createDropdown('location');
	dropdown.addOptions(['Berlin', 'Hamburg', 'Magdeburg']);
	dropdown.addToPage(page, { x: 200, y: 750 - (SYNTHETIC_TEXT_FIELDS.length + 1) * 32, width: 160, height: 20 });
	return doc.save();
}

/** A PDF without any AcroForm fields (scan-like). */
export async function makeFlatPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const page = doc.addPage([595, 842]);
	page.drawText('Flat sample request', { x: 50, y: 790, size: 16, font });
	page.drawRectangle({ x: 50, y: 700, width: 300, height: 24, borderColor: rgb(0, 0, 0), borderWidth: 1 });
	return doc.save();
}
