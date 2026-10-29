import { describe, expect, it } from 'vitest';
import { emptyMapping, newBinding } from './mapping';
import { inspectPdf, type DetectedField } from './pdf';
import { carryMapping, reviewNeedsAttention } from './replace';
import { DEFAULT_FORM_LAYOUT, SYNTHETIC_TEXT_FIELDS, makeFormPdf } from './test-pdf';
import type { FormMapping } from './types';

const field = (name: string, type: DetectedField['type'] = 'text'): DetectedField => ({ name, type, page: 1, readOnly: false });

const assigned = (): FormMapping => ({
	...emptyMapping(),
	person: { lastName: 'Muster', firstName: 'Max', personnelNo: '1', department: 'T', place: 'O' },
	dateFormat: 'iso',
	flatten: true,
	fields: {
		last_name: newBinding('lastName'),
		rest_days: newBinding('restAfter'),
		company_box: { source: 'fixedCheckbox', checked: true },
		gone: newBinding('today')
	}
});
const oldFields = [field('last_name'), field('rest_days'), field('first_name'), field('company_box', 'checkbox'), field('gone')];

describe('carryMapping', () => {
	it('keeps assignments of fields with the same name and type, reports new and removed ones', () => {
		const next = [field('last_name'), field('rest_days'), field('first_name'), field('company_box', 'checkbox'), field('compensated')];
		const { mapping, review } = carryMapping(assigned(), oldFields, next, 1);
		expect(Object.keys(mapping.fields).sort()).toEqual(['company_box', 'last_name', 'rest_days']);
		expect(mapping.fields.rest_days).toEqual({ source: 'restAfter' });
		expect(review.kept.sort()).toEqual(['company_box', 'last_name', 'rest_days']);
		expect(review.fresh).toEqual(['compensated']); // first_name existed before, it was just never assigned
		expect(review.removed).toEqual(['gone']);
		expect(review.changed).toEqual([]);
		expect(reviewNeedsAttention(review)).toBe(true);
	});
	it('keeps personal values, date format and flatten', () => {
		const { mapping } = carryMapping(assigned(), oldFields, [field('last_name')], 1);
		expect(mapping.person.lastName).toBe('Muster');
		expect(mapping.dateFormat).toBe('iso');
		expect(mapping.flatten).toBe(true);
	});
	it('drops the assignment when the type changed to one the source cannot fill', () => {
		const next = [field('last_name'), field('company_box', 'text')];
		const { mapping, review } = carryMapping(assigned(), oldFields, next, 1);
		expect(review.changed).toEqual(['company_box']);
		expect(mapping.fields.company_box).toBeUndefined();
		expect(review.fresh).toEqual([]);
	});
	it('keeps an assignment when the source still fits the new type (text to dropdown)', () => {
		const { mapping, review } = carryMapping(assigned(), oldFields, [field('last_name', 'dropdown')], 1);
		expect(mapping.fields.last_name).toEqual({ source: 'lastName' });
		expect(review.kept).toEqual(['last_name']);
	});
	it('matches names ignoring case and surrounding blanks, and rekeys to the new name', () => {
		const { mapping, review } = carryMapping(assigned(), oldFields, [field(' Last_Name ')], 1);
		expect(mapping.fields[' Last_Name ']).toEqual({ source: 'lastName' });
		expect(review.fresh).toEqual([]);
	});
	it('does not guess between two fields that differ only in case', () => {
		const { mapping, review } = carryMapping(assigned(), oldFields, [field('LAST_NAME'), field('Last_Name')], 1);
		expect(Object.keys(mapping.fields)).toEqual([]);
		expect(review.removed).toContain('last_name');
	});
	it('ignores signature and other unsupported fields', () => {
		const { review } = carryMapping(assigned(), oldFields, [field('last_name'), field('sign', 'other')], 1);
		expect(review.fresh).toEqual([]);
	});
	it('keeps overlays on pages that still exist and reports the others', () => {
		const old: FormMapping = { ...emptyMapping(), overlays: [0, 1, 2].map((page) => ({ id: `o${page}`, page, x: 1, y: 1, fontSize: 11, binding: newBinding('lastName') })) };
		const { mapping, review } = carryMapping(old, [], [], 2);
		expect(mapping.overlays.map((o) => o.id)).toEqual(['o0', 'o1']);
		expect(review).toMatchObject({ overlaysKept: 2, overlaysDropped: 1 });
	});
	it('reports nothing to review for an identical file', () => {
		const { review } = carryMapping(assigned(), oldFields, oldFields, 1);
		expect(review.fresh).toEqual([]);
		expect(review.removed).toEqual([]);
		expect(review.kept.length).toBe(4);
		expect(reviewNeedsAttention(review)).toBe(false);
	});
	it('works on two synthetic PDF versions read with inspectPdf', async () => {
		const v1 = await inspectPdf(await makeFormPdf());
		const v2 = await inspectPdf(
			await makeFormPdf({ textFields: [...SYNTHETIC_TEXT_FIELDS.filter((n) => n !== 'rest_days'), 'compensated_days'], checkboxes: DEFAULT_FORM_LAYOUT.checkboxes, dropdowns: DEFAULT_FORM_LAYOUT.dropdowns })
		);
		const old: FormMapping = { ...emptyMapping(), fields: { last_name: newBinding('lastName'), rest_days: newBinding('restAfter') } };
		const { mapping, review } = carryMapping(old, v1.fields, v2.fields, v2.pageCount);
		expect(Object.keys(mapping.fields)).toEqual(['last_name']);
		expect(review.fresh).toEqual(['compensated_days']);
		expect(review.removed).toEqual(['rest_days']);
	});
});
