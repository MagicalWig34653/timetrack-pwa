// TypeScript port of the import parsing rules of ADR-0006. The real backend (C12) parses on the server; this port backs the
// mock API and the client-side hints of the wizard (e.g. "7,7 are 7:42, not 7:07"). Nothing here writes data.
import type {
	ImportDateFormat,
	ImportErrorCode,
	ImportMapping,
	ImportPreview,
	ImportTimeFormat,
	SegmentKind
} from '../api/types.ts';
import { DEFAULT_TIMEZONE, isValidDate, zonedTimeToInstant } from '../time/dates.ts';

/** Sheet limits of ADR-0006. */
export const MAX_IMPORT_ROWS = 20_000;

// ---------------------------------------------------------------------------------------------------- CSV

export type CsvDelimiter = ';' | ',' | '\t';

/** Picks the delimiter that splits the first non-empty lines into the most (and consistently many) cells; `;` wins ties. */
export function detectDelimiter(text: string): CsvDelimiter {
	const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 10);
	let best: CsvDelimiter = ';';
	let bestScore = -1;
	for (const candidate of [';', '\t', ','] as const) {
		const counts = lines.map((line) => splitLine(line, candidate).length - 1);
		const min = Math.min(...counts, Infinity);
		if (!Number.isFinite(min) || min === 0) continue;
		// consistent column count across lines first, then more columns
		const consistent = counts.every((c) => c === counts[0]) ? 1 : 0;
		const score = consistent * 1000 + min;
		if (score > bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return best;
}

function splitLine(line: string, delimiter: string): string[] {
	const cells: string[] = [];
	let current = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quoted) {
			if (char === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else quoted = false;
			} else current += char;
		} else if (char === '"' && current === '') quoted = true;
		else if (char === delimiter) {
			cells.push(current);
			current = '';
		} else current += char;
	}
	cells.push(current);
	return cells;
}

/** RFC 4180 style parser with quoted fields (embedded delimiters, quotes, line breaks) and a BOM. Values are never interpreted as formulas. */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
	const source = text.replace(/^﻿/, '');
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let touched = false;
	const endRow = () => {
		row.push(cell);
		if (touched || row.length > 1 || row[0] !== '') rows.push(row);
		row = [];
		cell = '';
		touched = false;
	};
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (quoted) {
			if (char === '"') {
				if (source[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else cell += char;
		} else if (char === '"' && cell === '') {
			quoted = true;
			touched = true;
		} else if (char === delimiter) {
			row.push(cell);
			cell = '';
			touched = true;
		} else if (char === '\r' || char === '\n') {
			if (char === '\r' && source[i + 1] === '\n') i++;
			endRow();
		} else cell += char;
	}
	if (cell !== '' || row.length > 0 || touched) endRow();
	return rows;
}

// ---------------------------------------------------------------------------------------------------- cells

const NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;
const toNumber = (text: string) => Number(text.replace(',', '.'));

/** Marker for a spreadsheet formula without cached value (xlsx) or a text that starts like a formula. */
export const isFormulaText = (value: string) => value.trim().startsWith('=');

/** Excel serial day number (1900 system) -> ISO date; fractions are cut off. 60 is Excel's fictitious 29.02.1900 and rejected. */
export function excelSerialToDate(serial: number): string | null {
	if (!Number.isFinite(serial)) return null;
	const day = Math.floor(serial);
	if (day < 1 || day > 2_958_465 || day === 60) return null;
	// 25569 days between 1899-12-30 and 1970-01-01
	const date = new Date((day - 25569) * 86_400_000);
	return date.toISOString().slice(0, 10);
}

export function parseDateCell(value: string, format: ImportDateFormat): string | null {
	const text = value.trim();
	if (format === 'dd.MM.yyyy') {
		const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
		if (!m) return null;
		const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
		return isValidDate(iso) ? iso : null;
	}
	if (format === 'yyyy-MM-dd') return /^\d{4}-\d{2}-\d{2}$/.test(text) && isValidDate(text) ? text : null;
	return NUMBER.test(text) ? excelSerialToDate(toNumber(text)) : null;
}

/**
 * Time-of-day or duration in whole seconds. `HH:mm` = h:mm(:ss); `excel_fraction` = fraction of a day (0,3208 = 7:42);
 * `decimal_hours` = hours as a decimal number: 7,7 is 7:42 (7 h + 0,7 h = 42 min) and NOT 7:07.
 */
export function parseTimeCell(value: string, format: ImportTimeFormat, kind: 'clock' | 'duration'): number | null {
	const text = value.trim();
	let seconds: number;
	if (format === 'HH:mm') {
		const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(text);
		if (!m) return null;
		seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
	} else {
		if (!NUMBER.test(text) || text.startsWith('-') || text.startsWith('+')) return null;
		const n = toNumber(text);
		seconds = Math.round(format === 'excel_fraction' ? n * 86_400 : n * 3600);
	}
	if (kind === 'clock' && (seconds < 0 || seconds >= 86_400)) return null;
	if (kind === 'duration' && (seconds <= 0 || seconds > 24 * 3600)) return null;
	return seconds;
}

const SUMMARY = /^(summe|gesamt|gesamtsumme|zwischensumme|total|übertrag|saldo|ergebnis)\b/i;
/** Summary rows ("Summe", "Gesamt" ...) are recognised by their first filled cell. */
export function isSummaryRow(cells: (string | null)[]): boolean {
	const first = cells.find((c) => c != null && c.trim() !== '');
	return first != null && SUMMARY.test(first.trim());
}

const KIND_WORDS: Record<SegmentKind, string[]> = {
	work: ['arbeit', 'work', 'büro', 'homeoffice', 'kunde'],
	travel: ['fahrt', 'fahrtzeit', 'reise', 'dienstreise', 'travel'],
	school: ['schule', 'berufsschule', 'school']
};
export function parseKindCell(value: string): SegmentKind | null {
	const text = value.trim().toLowerCase();
	for (const kind of Object.keys(KIND_WORDS) as SegmentKind[]) if (KIND_WORDS[kind].includes(text)) return kind;
	return null;
}

// ---------------------------------------------------------------------------------------------------- preview

export interface ParsedItem {
	/** 1-based sheet row */
	row: number;
	date: string;
	startedAt: string;
	endedAt: string;
	kind: SegmentKind;
	placeId: string | null;
	note: string | null;
}

export interface ImportContext {
	places: { id: string; name: string }[];
	/** existing, non-voided segments of the account (duplicate key: start + end + kind) */
	existing: { startedAt: string; endedAt: string | null; kind: SegmentKind }[];
}

export type MappingIssue = 'date_required' | 'start_required' | 'end_or_duration' | 'end_and_duration' | 'duplicate_column';

/** Structural problems of a mapping that make a preview impossible (the server answers 400 for them). */
export function mappingIssues(mapping: ImportMapping): MappingIssue[] {
	const c = mapping.columns;
	const issues: MappingIssue[] = [];
	if (c.date == null || c.date < 0) issues.push('date_required');
	if (c.start == null) issues.push('start_required');
	const hasEnd = c.end != null;
	const hasDuration = c.duration != null;
	if (!hasEnd && !hasDuration) issues.push('end_or_duration');
	if (hasEnd && hasDuration) issues.push('end_and_duration');
	const used = [c.date, c.start, c.end, c.duration, c.kind, c.place, c.note].filter((v): v is number => v != null);
	if (new Set(used).size !== used.length) issues.push('duplicate_column');
	return issues;
}

const keyOf = (startedAt: string, endedAt: string | null, kind: string) => `${Date.parse(startedAt)}|${endedAt ? Date.parse(endedAt) : ''}|${kind}`;

/** Row-wise validation of the data rows below the header row. Fills `items` with everything that would be created. */
export function buildImportPreview(
	rows: (string | null)[][],
	mapping: ImportMapping,
	context: ImportContext
): { preview: ImportPreview; items: ParsedItem[] } {
	const zone = mapping.timezone || DEFAULT_TIMEZONE;
	const c = mapping.columns;
	const errors: { row: number; code: ImportErrorCode }[] = [];
	const items: ParsedItem[] = [];
	const accepted = new Map<string, true>();
	const taken: { start: number; end: number }[] = context.existing
		.filter((s) => s.endedAt)
		.map((s) => ({ start: Date.parse(s.startedAt), end: Date.parse(s.endedAt as string) }));
	for (const s of context.existing) accepted.set(keyOf(s.startedAt, s.endedAt, s.kind), true);
	let counted = 0;
	let duplicates = 0;
	const cell = (cells: (string | null)[], index: number | null | undefined) => (index == null ? null : (cells[index] ?? '').trim());

	for (let i = Math.max(0, mapping.headerRow); i < rows.length && i < MAX_IMPORT_ROWS + mapping.headerRow; i++) {
		const cells = rows[i];
		const row = i + 1;
		if (cells.every((v) => v == null || v.trim() === '')) continue;
		if ((mapping.skipSummaryRows ?? true) && isSummaryRow(cells)) continue;
		counted++;
		const fail = (code: ImportErrorCode) => errors.push({ row, code });

		const dateText = cell(cells, c.date) ?? '';
		const startText = cell(cells, c.start) ?? '';
		const endText = cell(cells, c.end);
		const durationText = cell(cells, c.duration);
		const required = [dateText, startText, c.end != null ? endText : durationText];
		if (required.some((v) => v === '' || v === null)) {
			fail('missing_value');
			continue;
		}
		if ([dateText, startText, endText ?? '', durationText ?? ''].some(isFormulaText)) {
			fail('formula_without_value');
			continue;
		}
		const date = parseDateCell(dateText, mapping.dateFormat);
		if (!date) {
			fail('date_invalid');
			continue;
		}
		const startSeconds = parseTimeCell(startText, mapping.timeFormat, 'clock');
		if (startSeconds === null) {
			fail('time_invalid');
			continue;
		}
		let endSeconds: number;
				if (c.end != null) {
			const parsed = parseTimeCell(endText as string, mapping.timeFormat, 'clock');
			if (parsed === null) {
				fail('time_invalid');
				continue;
			}
			if (parsed <= startSeconds) {
				fail('end_before_start');
				continue;
			}
			endSeconds = parsed;
		} else {
			const duration = parseTimeCell(durationText as string, mapping.timeFormat, 'duration');
			if (duration === null) {
				fail('time_invalid');
				continue;
			}
			endSeconds = startSeconds + duration;
			if (endSeconds >= 86_400) {
				// would cross midnight: segments stay within one day, nothing is invented
				fail('end_before_start');
				continue;
			}
		}
		let kind: SegmentKind = mapping.defaultKind ?? 'work';
		const kindText = cell(cells, c.kind);
		if (kindText) {
			const parsed = parseKindCell(kindText);
			if (!parsed) {
				fail('missing_value');
				continue;
			}
			kind = parsed;
		}
		let placeId: string | null = null;
		const placeText = cell(cells, c.place);
		if (placeText) {
			const place = context.places.find((p) => p.name.trim().toLowerCase() === placeText.toLowerCase());
			if (!place) {
				fail('unknown_place');
				continue;
			}
			placeId = place.id;
		}
		const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
		const startedAt = zonedTimeToInstant(date, clock(startSeconds), zone).toISOString();
		const endedAt = zonedTimeToInstant(date, clock(endSeconds), zone).toISOString();
		const key = keyOf(startedAt, endedAt, kind);
		if (accepted.has(key)) {
			duplicates++;
			continue;
		}
		const start = Date.parse(startedAt);
		const end = Date.parse(endedAt);
		if (taken.some((t) => t.start < end && t.end > start)) {
			fail('overlap');
			continue;
		}
		accepted.set(key, true);
		taken.push({ start, end });
		items.push({ row, date, startedAt, endedAt, kind, placeId, note: cell(cells, c.note) || null });
	}
	return {
		preview: {
			rows: counted,
			valid: items.length,
			duplicates,
			errors,
			sample: items.slice(0, 10).map((i) => ({ date: i.date, startedAt: i.startedAt, endedAt: i.endedAt, kind: i.kind }))
		},
		items
	};
}
