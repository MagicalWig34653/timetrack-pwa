import { describe, expect, it } from 'vitest';
import { MAPPING_MAX_BYTES, MappingTooLargeError, emptyMapping, newBinding, parseMapping, parseMappingJson, serializeMapping, suggestSource } from './mapping';
import type { FormMapping } from './types';

describe('mapping serialisation', () => {
	const sample: FormMapping = {
		version: 1,
		revision: 2,
		person: { lastName: 'Muster', firstName: 'Max', personnelNo: '4711', department: 'Technik', place: 'Magdeburg' },
		dateFormat: 'd.M.yy',
		flatten: true,
		fields: {
			last_name: { source: 'lastName' },
			free_from_2: { source: 'freeRangeFrom', index: 2, dateFormat: 'iso' },
			company: { source: 'fixedCheckbox', checked: true },
			note: { source: 'fixedText', text: 'GmbH' }
		},
		overlays: [{ id: 'o1', page: 0, x: 120.5, y: 640, fontSize: 12, binding: { source: 'dateFrom' } }]
	};

	it('round-trips through JSON', () => {
		expect(parseMappingJson(serializeMapping(sample))).toEqual(sample);
	});
	it('falls back to an empty mapping for garbage', () => {
		expect(parseMapping(null)).toEqual(emptyMapping());
		expect(parseMapping([1, 2])).toEqual(emptyMapping());
		expect(parseMappingJson('{not json')).toEqual(emptyMapping());
	});
	it('drops unknown sources and malformed entries and clamps numbers', () => {
		const parsed = parseMapping({
			version: 7,
			dateFormat: 'xx',
			person: { lastName: 5, firstName: 'A' },
			fields: { a: { source: 'nope' }, b: 'x', c: { source: 'freeRange', index: 99 }, d: { source: 'lastName', text: 'ignored' } },
			overlays: [{ id: 'x', page: -3, x: 'a', y: 1, fontSize: 500, binding: { source: 'today' } }, { id: 1, binding: { source: 'today' } }, { id: 'y', binding: { source: 'nope' } }]
		});
		expect(parsed.dateFormat).toBe('dd.MM.yyyy');
		expect(parsed.person.lastName).toBe('');
		expect(parsed.person.firstName).toBe('A');
		expect(Object.keys(parsed.fields).sort()).toEqual(['c', 'd']);
		expect(parsed.fields.c.index).toBe(8);
		expect(parsed.fields.d).toEqual({ source: 'lastName' });
		expect(parsed.overlays).toHaveLength(1);
		expect(parsed.overlays[0]).toMatchObject({ page: 0, x: 0, y: 1, fontSize: 48 });
	});
	it('refuses a mapping above 64 KB', () => {
		const big = emptyMapping();
		for (let i = 0; i < 2500; i++) big.fields[`field_with_a_fairly_long_name_${i}`] = { source: 'fixedText', text: 'x'.repeat(30) };
		expect(() => serializeMapping(big)).toThrow(MappingTooLargeError);
		expect(MAPPING_MAX_BYTES).toBe(65536);
	});
	it('creates bindings with the options their source needs', () => {
		expect(newBinding('lastName')).toEqual({ source: 'lastName' });
		expect(newBinding('fixedText')).toEqual({ source: 'fixedText', text: '' });
		expect(newBinding('fixedCheckbox')).toEqual({ source: 'fixedCheckbox', checked: true });
		expect(newBinding('freeRangeTo')).toEqual({ source: 'freeRangeTo', index: 1 });
	});
});

describe('suggestSource', () => {
	it('recognises typical German and English-less field names', () => {
		expect(suggestSource('Nachname', 'text')).toBe('lastName');
		expect(suggestSource('Vorname', 'text')).toBe('firstName');
		expect(suggestSource('Personalnummer', 'text')).toBe('personnelNo');
		expect(suggestSource('urlaub_anspruch_gesamt', 'text')).toBe('entitlementTotal');
		expect(suggestSource('urlaub_anspruch_verbleibend', 'text')).toBe('restBefore');
		expect(suggestSource('urlaub_anspruch_abgegolten', 'text')).toBe('compensated');
		expect(suggestSource('urlaub_anspruch_zusatz', 'text')).toBe('additional');
		expect(suggestSource('urlaub_anspruch_zusatz_vorjahr', 'text')).toBe('carryOver');
		expect(suggestSource('Resttage', 'text')).toBe('restAfter');
		expect(suggestSource('urlaub_anspruch', 'text')).toBe('entitlementYear');
		expect(suggestSource('arbeitstage', 'text')).toBe('workingDays');
		expect(suggestSource('Vertreter', 'text')).toBe('substitute');
		expect(suggestSource('Urlaub von', 'text')).toBe('dateFrom');
		expect(suggestSource('Urlaub bis', 'text')).toBe('dateTo');
		expect(suggestSource('Ort', 'text')).toBe('place');
		expect(suggestSource('last_name', 'text')).toBe('lastName');
		expect(suggestSource('first_name', 'text')).toBe('firstName');
	});
	it('does not guess for checkboxes or unknown names', () => {
		expect(suggestSource('Check Box1', 'checkbox')).toBeNull();
		expect(suggestSource('Feld 17', 'text')).toBeNull();
		expect(suggestSource('Fortbildung', 'text')).toBeNull();
	});
});

describe('legacy mapping migration', () => {
	const legacy = { version: 1, fields: { urlaub_anspruch_abgegolten: { source: 'paidOut' }, urlaub_anspruch_verbleibend: { source: 'restAfter' }, Resttage: { source: 'restAfter' }, other: { source: 'paidOut' } } };
	it('moves the old suggestions on "abgegolten" and "verbleiben" to the corrected sources once', () => {
		const mapping = parseMapping(legacy);
		expect(mapping.fields.urlaub_anspruch_abgegolten).toEqual({ source: 'compensated', scope: 'all' });
		expect(mapping.fields.urlaub_anspruch_verbleibend).toEqual({ source: 'restBefore' });
		expect(mapping.fields.Resttage).toEqual({ source: 'restAfter' });
		expect(mapping.fields.other).toEqual({ source: 'paidOut' });
	});
	it('leaves a current revision alone, so a deliberate choice survives', () => {
		const mapping = parseMapping({ ...legacy, revision: 2 });
		expect(mapping.fields.urlaub_anspruch_abgegolten).toEqual({ source: 'paidOut' });
		expect(parseMapping(JSON.parse(serializeMapping(emptyMapping()))).revision).toBe(2);
	});
	it('reads and clamps the compensated scope', () => {
		const mapping = parseMapping({ version: 1, revision: 2, fields: { a: { source: 'compensated', scope: 'decided' }, b: { source: 'compensated', scope: 'x' } } });
		expect(mapping.fields.a.scope).toBe('decided');
		expect(mapping.fields.b.scope).toBe('all');
	});
});
