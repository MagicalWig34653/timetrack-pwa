import { describe, expect, it } from 'vitest';
import { checkImportFile, columnLetter, emptyMappingForm, formFromMapping, formIssues, mappingFromForm, suggestColumns } from './import-flow';

describe('import flow helpers', () => {
	it('suggests columns from German headers and prefers an end column over a duration', () => {
		expect(suggestColumns(['Datum', 'Beginn', 'Ende', 'Art', 'Notiz'])).toEqual({ date: 0, start: 1, end: 2, kind: 3, note: 4 });
		expect(suggestColumns(['Tag', 'Von', 'Dauer'])).toEqual({ date: 0, start: 1, duration: 2 });
		expect(suggestColumns(['Datum', 'Beginn', 'Ende', 'Dauer'])).toEqual({ date: 0, start: 1, end: 2 });
	});

	it('validates the form and builds the mapping with null for unused columns', () => {
		const form = emptyMappingForm('Tabelle1');
		expect(formIssues(form)).toEqual(['date_required', 'start_required', 'end_required']);
		Object.assign(form, { date: '0', start: '1', end: '2' });
		expect(formIssues(form)).toEqual([]);
		expect(mappingFromForm(form)).toMatchObject({ sheet: 'Tabelle1', headerRow: 1, columns: { date: 0, start: 1, end: 2, duration: null, kind: null } });
		form.end = '1';
		expect(formIssues(form)).toContain('duplicate_column');
	});

	it('restores a template and falls back to the first sheet when the stored one is missing', () => {
		const form = formFromMapping(
			{ sheet: 'Alt', headerRow: 2, dateFormat: 'excel_serial', timeFormat: 'decimal_hours', columns: { date: 0, start: 1, duration: 2 } },
			['Neu']
		);
		expect(form).toMatchObject({ sheet: 'Neu', headerRow: '2', endMode: 'duration', duration: '2', timeFormat: 'decimal_hours' });
	});

	it('names columns like a spreadsheet and checks files before upload', () => {
		expect([0, 25, 26, 27].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB']);
		expect(checkImportFile({ name: 'a.csv', size: 10 }, 100)).toBe('ok');
		expect(checkImportFile({ name: 'a.XLSX', size: 10 }, 100)).toBe('ok');
		expect(checkImportFile({ name: 'a.csv', size: 101 }, 100)).toBe('too_large');
		expect(checkImportFile({ name: 'a.pdf', size: 1 }, 100)).toBe('unsupported');
		expect(checkImportFile({ name: 'a.csv', size: 0 }, 100)).toBe('empty');
	});
});
