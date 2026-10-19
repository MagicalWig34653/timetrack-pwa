import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { emptyMapping, newBinding } from './mapping';
import { PDF_MAX_BYTES, PdfError, hasPdfMagic, validatePdfBytes } from './pdf-limits';
import { fillPdf, inspectPdf, readFieldValues, requestFileName } from './pdf';
import { makeFlatPdf, makeFormPdf, SYNTHETIC_TEXT_FIELDS } from './test-pdf';
import type { FormMapping, RequestData } from './types';

const request: RequestData = {
	from: '2026-07-06',
	to: '2026-07-17',
	today: '2026-06-01',
	substitute: 'Erika Muster',
	entitlementYearHalfDays: 60,
	entitlementTotalHalfDays: 70,
	carryOverHalfDays: 8,
	adjustmentHalfDays: 0,
	restBeforeHalfDays: 45,
	restAfterHalfDays: 25,
	workingDays: 10,
	freeRanges: [{ from: '2026-07-11', to: '2026-07-12' }]
};

function mapping(extra: Partial<FormMapping> = {}): FormMapping {
	return {
		...emptyMapping(),
		person: { lastName: 'Muster', firstName: 'Max', personnelNo: '4711', department: 'Technik', place: 'Magdeburg' },
		fields: {
			last_name: { source: 'lastName' },
			first_name: { source: 'firstName' },
			personnel_no: { source: 'personnelNo' },
			department: { source: 'department' },
			date_from: { source: 'dateFrom' },
			date_to: { source: 'dateTo' },
			substitute: { source: 'substitute' },
			working_days: { source: 'workingDays' },
			rest_days: { source: 'restAfter' },
			entitlement_total: { source: 'entitlementTotal' },
			free_from_1: { source: 'freeRangeFrom', index: 1 },
			free_to_1: { source: 'freeRangeTo', index: 1 },
			free_from_2: { source: 'freeRangeFrom', index: 2 },
			company_box: { source: 'fixedCheckbox', checked: true },
			location: { source: 'fixedText', text: 'Magdeburg' }
		},
		...extra
	};
}

/** Inflated text of every Flate stream in the file (page contents of pdf-lib are compressed). */
function contentStreams(bytes: Uint8Array): string[] {
	const raw = Buffer.from(bytes);
	const out: string[] = [];
	let from = 0;
	for (;;) {
		const start = raw.indexOf('stream', from, 'latin1');
		if (start < 0) break;
		const bodyStart = raw[start + 6] === 0x0d ? start + 8 : start + 7;
		const end = raw.indexOf('endstream', bodyStart, 'latin1');
		if (end < 0) break;
		try {
			out.push(inflateSync(raw.subarray(bodyStart, end)).toString('latin1'));
		} catch {
			// not a Flate stream
		}
		from = end + 9;
	}
	return out;
}

describe('PDF validation', () => {
	it('checks the magic number and the size', async () => {
		const pdf = await makeFormPdf();
		expect(hasPdfMagic(pdf)).toBe(true);
		expect(() => validatePdfBytes(pdf)).not.toThrow();
		expect(() => validatePdfBytes(new TextEncoder().encode('<html>not a pdf</html>'))).toThrow(PdfError);
		expect(() => validatePdfBytes(new Uint8Array(0))).toThrow(expect.objectContaining({ problem: 'empty' }));
		const big = new Uint8Array(PDF_MAX_BYTES + 1);
		big.set(pdf.subarray(0, 8));
		expect(() => validatePdfBytes(big)).toThrow(expect.objectContaining({ problem: 'too_large' }));
	});
	it('rejects text with a .pdf name and truncated PDFs as unreadable', async () => {
		await expect(inspectPdf(new TextEncoder().encode('%PDF-1.7\nbroken'))).rejects.toMatchObject({ problem: 'unreadable' });
		await expect(inspectPdf(new TextEncoder().encode('hello'))).rejects.toMatchObject({ problem: 'not_pdf' });
	});
});

describe('inspectPdf', () => {
	it('lists fields with type and page', async () => {
		const info = await inspectPdf(await makeFormPdf());
		expect(info.pageCount).toBe(1);
		expect(info.pages[0]).toEqual({ width: 595, height: 842 });
		const byName = new Map(info.fields.map((f) => [f.name, f]));
		for (const name of SYNTHETIC_TEXT_FIELDS) expect(byName.get(name)).toMatchObject({ type: 'text', page: 1 });
		expect(byName.get('company_box')).toMatchObject({ type: 'checkbox', page: 1 });
		expect(byName.get('location')).toMatchObject({ type: 'dropdown', page: 1, options: ['Berlin', 'Hamburg', 'Magdeburg'] });
	});
	it('finds the page of fields on later pages', async () => {
		const doc = await PDFDocument.create();
		doc.addPage();
		const second = doc.addPage();
		doc.getForm().createTextField('on_page_two').addToPage(second, { x: 10, y: 10, width: 100, height: 20 });
		const info = await inspectPdf(await doc.save());
		expect(info.pageCount).toBe(2);
		expect(info.fields).toMatchObject([{ name: 'on_page_two', page: 2 }]);
	});
	it('reports no fields for a flat PDF', async () => {
		const info = await inspectPdf(await makeFlatPdf());
		expect(info.fields).toEqual([]);
		expect(info.pageCount).toBe(1);
	});
});

describe('fillPdf', () => {
	it('fills text, checkbox and dropdown and keeps the result fillable', async () => {
		const template = await makeFormPdf();
		const before = [...template];
		const { bytes, skipped } = await fillPdf(template, mapping(), request);
		expect(skipped).toEqual([]);
		expect([...template]).toEqual(before); // the template is untouched
		const values = await readFieldValues(bytes);
		expect(values).toMatchObject({
			last_name: 'Muster',
			first_name: 'Max',
			personnel_no: '4711',
			department: 'Technik',
			date_from: '06.07.2026',
			date_to: '17.07.2026',
			substitute: 'Erika Muster',
			working_days: '10',
			rest_days: '12,5',
			entitlement_total: '35',
			free_from_1: '11.07.2026',
			free_to_1: '12.07.2026',
			company_box: true,
			location: 'Magdeburg'
		});
		expect(values.free_from_2).toBeNull(); // no second range: stays empty
		expect((await inspectPdf(bytes)).fields.length).toBeGreaterThan(10);
	});
	it('leaves unmapped fields empty and honours date formats', async () => {
		const template = await makeFormPdf();
		const { bytes } = await fillPdf(template, mapping({ dateFormat: 'iso', fields: { date_from: { source: 'dateFrom' } } }), request);
		const values = await readFieldValues(bytes);
		expect(values.date_from).toBe('2026-07-06');
		expect(values.last_name).toBeNull();
		expect(values.company_box).toBe(false);
	});
	it('skips a dropdown value the field does not offer', async () => {
		const { bytes, skipped } = await fillPdf(await makeFormPdf(), mapping({ fields: { location: { source: 'fixedText', text: 'Atlantis' } } }), request);
		expect(skipped).toEqual(['location']);
		expect((await readFieldValues(bytes)).location).toBeNull();
	});
	it('flattens on request: no fields remain but the page still carries the text', async () => {
		const { bytes } = await fillPdf(await makeFormPdf(), mapping(), request, { flatten: true });
		expect((await inspectPdf(bytes)).fields).toEqual([]);
	});
	it('writes overlay text on flat PDFs', async () => {
		const flat = await makeFlatPdf();
		const m = mapping({ fields: {}, overlays: [{ id: 'a', page: 0, x: 60, y: 705, fontSize: 12, binding: newBinding('lastName') }] });
		const { bytes, skipped } = await fillPdf(flat, m, request);
		expect(skipped).toEqual([]);
		expect(bytes.length).toBeGreaterThan(flat.length);
		expect(contentStreams(bytes).some((stream) => stream.includes('<4D7573746572> Tj'))).toBe(true); // "Muster" in the page content
	});
	it('names the file after the period', () => {
		expect(requestFileName('2026-07-06', '2026-07-17')).toBe('Urlaubsantrag_2026-07-06_2026-07-17.pdf');
	});
});
