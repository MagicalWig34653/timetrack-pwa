import { describe, expect, it } from 'vitest';
import type { ImportMapping } from '../api/types';
import { buildImportPreview, detectDelimiter, excelSerialToDate, isSummaryRow, mappingIssues, parseCsv, parseDateCell, parseKindCell, parseTimeCell } from './import-parse';

const mapping = (extra: Partial<ImportMapping> = {}): ImportMapping => ({
	sheet: 'Tabelle1',
	headerRow: 1,
	dateFormat: 'dd.MM.yyyy',
	timeFormat: 'HH:mm',
	columns: { date: 0, start: 1, end: 2, kind: null, place: null, note: null, duration: null },
	...extra
});
const empty = { places: [], existing: [] };

describe('parseCsv', () => {
	it('detects ; , and tab as delimiters', () => {
		expect(detectDelimiter('Datum;Beginn;Ende\n01.01.2031;8:00;12:00')).toBe(';');
		expect(detectDelimiter('Datum,Beginn,Ende\n2031-01-01,8:00,12:00')).toBe(',');
		expect(detectDelimiter('Datum\tBeginn\tEnde\n01.01.2031\t8:00\t12:00')).toBe('\t');
	});

	it('handles quotes, embedded delimiters, doubled quotes, line breaks, BOM and CRLF', () => {
		const text = '﻿Datum;Notiz\r\n01.01.2031;"Kunde; Termin ""A"""\r\n02.01.2031;"zwei\nZeilen"\r\n';
		expect(parseCsv(text)).toEqual([
			['Datum', 'Notiz'],
			['01.01.2031', 'Kunde; Termin "A"'],
			['02.01.2031', 'zwei\nZeilen']
		]);
	});

	it('keeps decimal commas inside a comma separated file only when quoted', () => {
		expect(parseCsv('Datum,Dauer\n01.01.2031,"7,7"', ',')).toEqual([['Datum', 'Dauer'], ['01.01.2031', '7,7']]);
	});

	it('never turns formula text into anything but text', () => {
		expect(parseCsv('a;b\n=1+1;@SUM(A1)')[1]).toEqual(['=1+1', '@SUM(A1)']);
	});

	it('keeps empty cells and drops fully empty lines', () => {
		expect(parseCsv('a;;c\n\nd;e;')).toEqual([['a', '', 'c'], ['d', 'e', '']]);
	});
});

describe('cell parsers', () => {
	it('reads decimal hours: 7,7 is 7:42 and not 7:07', () => {
		expect(parseTimeCell('7,7', 'decimal_hours', 'duration')).toBe(7 * 3600 + 42 * 60);
		expect(parseTimeCell('7.75', 'decimal_hours', 'duration')).toBe(7 * 3600 + 45 * 60);
		expect(parseTimeCell('8,5', 'decimal_hours', 'clock')).toBe(8 * 3600 + 30 * 60);
		expect(parseTimeCell('7:07', 'decimal_hours', 'duration')).toBeNull();
	});

	it('reads h:mm strictly and rejects decimals in clock format', () => {
		expect(parseTimeCell('7:42', 'HH:mm', 'duration')).toBe(27720);
		expect(parseTimeCell('08:00', 'HH:mm', 'clock')).toBe(28800);
		expect(parseTimeCell('7,7', 'HH:mm', 'duration')).toBeNull();
		expect(parseTimeCell('24:00', 'HH:mm', 'clock')).toBeNull();
		expect(parseTimeCell('7:61', 'HH:mm', 'clock')).toBeNull();
	});

	it('reads Excel day fractions', () => {
		expect(parseTimeCell('0,3208333', 'excel_fraction', 'duration')).toBe(27720);
		expect(parseTimeCell('0.5', 'excel_fraction', 'clock')).toBe(43200);
		expect(parseTimeCell('1', 'excel_fraction', 'clock')).toBeNull();
	});

	it('reads dates in the three formats and rejects impossible ones', () => {
		expect(parseDateCell('08.10.2026', 'dd.MM.yyyy')).toBe('2026-10-08');
		expect(parseDateCell('8.1.2026', 'dd.MM.yyyy')).toBe('2026-01-08');
		expect(parseDateCell('31.02.2026', 'dd.MM.yyyy')).toBeNull();
		expect(parseDateCell('2026-10-08', 'yyyy-MM-dd')).toBe('2026-10-08');
		expect(parseDateCell('08.10.2026', 'yyyy-MM-dd')).toBeNull();
		expect(parseDateCell('2026-10-08', 'dd.MM.yyyy')).toBeNull();
	});

	it('converts Excel serial dates (1900 system)', () => {
		expect(excelSerialToDate(46303)).toBe('2026-10-08');
		expect(excelSerialToDate(45292)).toBe('2024-01-01');
		expect(parseDateCell('46303,5', 'excel_serial')).toBe('2026-10-08');
		expect(excelSerialToDate(60)).toBeNull();
		expect(excelSerialToDate(0)).toBeNull();
		expect(parseDateCell('abc', 'excel_serial')).toBeNull();
	});

	it('recognises summary rows and kind words', () => {
		expect(isSummaryRow(['Summe', '', '40:00'])).toBe(true);
		expect(isSummaryRow(['', 'Gesamt', ''])).toBe(true);
		expect(isSummaryRow(['01.01.2031', '8:00'])).toBe(false);
		expect(parseKindCell(' Fahrt ')).toBe('travel');
		expect(parseKindCell('Berufsschule')).toBe('school');
		expect(parseKindCell('Urlaub')).toBeNull();
	});
});

describe('mappingIssues', () => {
	it('requires date, start and exactly one of end/duration, and distinct columns', () => {
		expect(mappingIssues(mapping())).toEqual([]);
		expect(mappingIssues(mapping({ columns: { date: 0, start: null, end: 2 } }))).toContain('start_required');
		expect(mappingIssues(mapping({ columns: { date: 0, start: 1 } }))).toContain('end_or_duration');
		expect(mappingIssues(mapping({ columns: { date: 0, start: 1, end: 2, duration: 3 } }))).toContain('end_and_duration');
		expect(mappingIssues(mapping({ columns: { date: 0, start: 0, end: 2 } }))).toContain('duplicate_column');
	});
});

describe('buildImportPreview', () => {
	const rows = [
		['Datum', 'Beginn', 'Ende'],
		['03.03.2031', '8:00', '12:00'],
		['03.03.2031', '12:30', '16:45'],
		['Summe', '', '8:15']
	];

	it('builds Berlin instants, skips summary rows and counts valid rows', () => {
		const { preview, items } = buildImportPreview(rows, mapping(), empty);
		expect(preview).toMatchObject({ rows: 2, valid: 2, duplicates: 0, errors: [] });
		expect(items[0].startedAt).toBe('2031-03-03T07:00:00.000Z');
		expect(items[1].endedAt).toBe('2031-03-03T15:45:00.000Z');
		expect(preview.sample).toHaveLength(2);
	});

	it('treats summary rows as ordinary (failing) rows when skipping is off', () => {
		const { preview } = buildImportPreview(rows, mapping({ skipSummaryRows: false }), empty);
		expect(preview.rows).toBe(3);
		expect(preview.errors).toEqual([{ row: 4, code: 'missing_value' }]);
	});

	it('reports row errors with 1-based sheet rows and codes', () => {
		const bad = [
			['Datum', 'Beginn', 'Ende'],
			['xx', '8:00', '12:00'],
			['03.03.2031', '8:99', '12:00'],
			['03.03.2031', '12:00', '11:00'],
			['03.03.2031', '', '11:00'],
			['03.03.2031', '=A1', '11:00']
		];
		const { preview } = buildImportPreview(bad, mapping(), empty);
		expect(preview.errors).toEqual([
			{ row: 2, code: 'date_invalid' },
			{ row: 3, code: 'time_invalid' },
			{ row: 4, code: 'end_before_start' },
			{ row: 5, code: 'missing_value' },
			{ row: 6, code: 'formula_without_value' }
		]);
		expect(preview.valid).toBe(0);
	});

	it('computes the end from a duration column (decimal hours)', () => {
		const data = [['Datum', 'Beginn', 'Dauer'], ['03.03.2031', '8,5', '7,7']];
		const m = mapping({ timeFormat: 'decimal_hours', columns: { date: 0, start: 1, end: null, duration: 2 } });
		const { items } = buildImportPreview(data, m, empty);
		// 8:30 + 7:42 = 16:12 Berlin (CET, UTC+1)
		expect(items[0].startedAt).toBe('2031-03-03T07:30:00.000Z');
		expect(items[0].endedAt).toBe('2031-03-03T15:12:00.000Z');
	});

	it('flags duplicates of existing segments and repeated rows, but an overlap with different times is an error', () => {
		const existing = [{ startedAt: '2031-03-03T07:00:00.000Z', endedAt: '2031-03-03T11:00:00.000Z', kind: 'work' as const }];
		const data = [
			['Datum', 'Beginn', 'Ende'],
			['03.03.2031', '8:00', '12:00'],
			['03.03.2031', '8:00', '12:00'],
			['03.03.2031', '11:30', '13:00'],
			['03.03.2031', '13:00', '14:00'],
			['03.03.2031', '13:30', '15:00']
		];
		const { preview } = buildImportPreview(data, mapping(), { places: [], existing });
		expect(preview.duplicates).toBe(2);
		expect(preview.valid).toBe(1);
		expect(preview.errors).toEqual([{ row: 4, code: 'overlap' }, { row: 6, code: 'overlap' }]);
	});

	it('maps kind and place columns and reports unknown places without inventing them', () => {
		const data = [
			['Datum', 'Beginn', 'Ende', 'Art', 'Ort'],
			['03.03.2031', '8:00', '9:00', 'Fahrt', 'Büro'],
			['03.03.2031', '10:00', '11:00', 'Schule', 'Mars']
		];
		const m = mapping({ columns: { date: 0, start: 1, end: 2, kind: 3, place: 4 } });
		const { preview, items } = buildImportPreview(data, m, { places: [{ id: 'p1', name: 'Büro' }], existing: [] });
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'travel', placeId: 'p1' });
		expect(preview.errors).toEqual([{ row: 3, code: 'unknown_place' }]);
	});

	it('without header row all rows are data', () => {
		const { preview } = buildImportPreview([['03.03.2031', '8:00', '9:00']], mapping({ headerRow: 0 }), empty);
		expect(preview.valid).toBe(1);
	});
});
