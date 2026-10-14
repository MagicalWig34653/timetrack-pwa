import type { ImportColumns, ImportMapping } from '../api/types';

/** Wizard steps in order; `confirm` is an explicit step: nothing is written before "Übernehmen" there. */
export const IMPORT_STEPS = ['upload', 'sheet', 'mapping', 'preview', 'confirm', 'result'] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

const HEADER_HINTS: { field: keyof ImportColumns; words: RegExp }[] = [
	{ field: 'date', words: /^(datum|date|tag)$/i },
	{ field: 'start', words: /^(beginn|start|von|anfang|kommen)$/i },
	{ field: 'end', words: /^(ende|end|bis|gehen)$/i },
	{ field: 'duration', words: /^(dauer|stunden|arbeitszeit|duration|ist)$/i },
	{ field: 'kind', words: /^(art|typ|kind|tätigkeit)$/i },
	{ field: 'place', words: /^(ort|place|standort)$/i },
	{ field: 'note', words: /^(notiz|notizen|bemerkung|kommentar|note)$/i }
];

/** Suggests columns from header names; only a suggestion the user can change. A duration column is dropped when an end column exists. */
export function suggestColumns(header: (string | null)[]): Partial<Record<keyof ImportColumns, number>> {
	const found: Partial<Record<keyof ImportColumns, number>> = {};
	header.forEach((cell, index) => {
		const text = (cell ?? '').trim();
		for (const hint of HEADER_HINTS) {
			if (found[hint.field] === undefined && hint.words.test(text)) found[hint.field] = index;
		}
	});
	if (found.end !== undefined) delete found.duration;
	return found;
}

/** Column choices in the form: index or '' (not used). */
export interface MappingForm {
	sheet: string;
	headerRow: string;
	dateFormat: ImportMapping['dateFormat'];
	timeFormat: ImportMapping['timeFormat'];
	timezone: string;
	defaultKind: NonNullable<ImportMapping['defaultKind']>;
	skipSummaryRows: boolean;
	date: string;
	start: string;
	/** 'end' or 'duration' */
	endMode: 'end' | 'duration';
	end: string;
	duration: string;
	kind: string;
	place: string;
	note: string;
}

export function emptyMappingForm(sheet: string): MappingForm {
	return {
		sheet,
		headerRow: '1',
		dateFormat: 'dd.MM.yyyy',
		timeFormat: 'HH:mm',
		timezone: 'Europe/Berlin',
		defaultKind: 'work',
		skipSummaryRows: true,
		date: '',
		start: '',
		endMode: 'end',
		end: '',
		duration: '',
		kind: '',
		place: '',
		note: ''
	};
}

const col = (v: string): number | null => (v === '' ? null : Number(v));

export type FormIssue = 'date_required' | 'start_required' | 'end_required' | 'duration_required' | 'header_row' | 'duplicate_column';

export function formIssues(form: MappingForm): FormIssue[] {
	const issues: FormIssue[] = [];
	if (form.date === '') issues.push('date_required');
	if (form.start === '') issues.push('start_required');
	if (form.endMode === 'end' && form.end === '') issues.push('end_required');
	if (form.endMode === 'duration' && form.duration === '') issues.push('duration_required');
	if (!/^\d+$/.test(form.headerRow.trim())) issues.push('header_row');
	const chosen = [form.date, form.start, form.endMode === 'end' ? form.end : form.duration, form.kind, form.place, form.note].filter((v) => v !== '');
	if (new Set(chosen).size !== chosen.length) issues.push('duplicate_column');
	return issues;
}

export function mappingFromForm(form: MappingForm): ImportMapping {
	return {
		sheet: form.sheet,
		headerRow: Number(form.headerRow.trim() || 0),
		timezone: form.timezone,
		dateFormat: form.dateFormat,
		timeFormat: form.timeFormat,
		defaultKind: form.defaultKind,
		skipSummaryRows: form.skipSummaryRows,
		columns: {
			date: col(form.date) ?? 0,
			start: col(form.start),
			end: form.endMode === 'end' ? col(form.end) : null,
			duration: form.endMode === 'duration' ? col(form.duration) : null,
			kind: col(form.kind),
			place: col(form.place),
			note: col(form.note)
		}
	};
}

/** Restores the form from a saved template; the sheet comes from the current file when the template's sheet does not exist there. */
export function formFromMapping(mapping: ImportMapping, sheets: string[]): MappingForm {
	const s = (v: number | null | undefined) => (v == null ? '' : String(v));
	return {
		sheet: sheets.includes(mapping.sheet) ? mapping.sheet : (sheets[0] ?? mapping.sheet),
		headerRow: String(mapping.headerRow),
		dateFormat: mapping.dateFormat,
		timeFormat: mapping.timeFormat,
		timezone: mapping.timezone ?? 'Europe/Berlin',
		defaultKind: mapping.defaultKind ?? 'work',
		skipSummaryRows: mapping.skipSummaryRows ?? true,
		date: s(mapping.columns.date),
		start: s(mapping.columns.start),
		endMode: mapping.columns.duration != null && mapping.columns.end == null ? 'duration' : 'end',
		end: s(mapping.columns.end),
		duration: s(mapping.columns.duration),
		kind: s(mapping.columns.kind),
		place: s(mapping.columns.place),
		note: s(mapping.columns.note)
	};
}

/** "A", "B", ... "AA" for column headers of the raw preview. */
export function columnLetter(index: number): string {
	let n = index;
	let out = '';
	do {
		out = String.fromCharCode(65 + (n % 26)) + out;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return out;
}

export type FileCheck = 'ok' | 'too_large' | 'unsupported' | 'empty';
/** Client-side check before upload: 5 MiB (ADR-0006) and csv/xlsx by extension. */
export function checkImportFile(file: { name: string; size: number }, maxBytes: number): FileCheck {
	if (!/\.(csv|xlsx)$/i.test(file.name)) return 'unsupported';
	if (file.size === 0) return 'empty';
	if (file.size > maxBytes) return 'too_large';
	return 'ok';
}
