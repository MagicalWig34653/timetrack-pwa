// Builders for the export mock: CSV is real, XLSX and PDF are small placeholder files with the proper type.
import type { DayEvaluation } from '../src/lib/api/types.ts';
import { formatDateNumeric, localTimeOf } from '../src/lib/time/dates.ts';
import { formatDuration } from '../src/lib/time/format.ts';

const MARKS: Record<string, string> = { holiday: 'Feiertag', vacation: 'Urlaub', sick: 'Krank', excused: 'Freigestellt', school_credit: 'Schultag (Gutschrift)' };
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Formula injection guard of ADR-0006: text cells that start with = + - @ tab or CR are marked as text with a leading apostrophe. */
export function guardText(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
	return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface ExportRow {
	date: string;
	weekday: string;
	rawStart: string;
	rawEnd: string;
	rawWork: number;
	startAdjust: number;
	endAdjust: number;
	breakDeduction: number;
	evaluatedWork: number;
	target: number;
	delta: number;
	mark: string;
	status: string;
}

export const EXPORT_HEADERS = [
	'Datum',
	'Wochentag',
	'Beginn (tatsächlich)',
	'Ende (tatsächlich)',
	'Arbeitszeit (tatsächlich)',
	'Rundung Beginn (bewertet)',
	'Rundung Ende (bewertet)',
	'Pausenabzug (bewertet)',
	'Arbeitszeit (bewertet)',
	'Soll',
	'Differenz',
	'Markierung',
	'Status'
];

/** Days worth listing: worked, marked or with a target. */
export function exportRows(days: DayEvaluation[]): ExportRow[] {
	return days
		.filter((d) => d.rawWorkSeconds > 0 || d.targetSeconds > 0 || (d.mark && d.mark !== 'none') || d.creditSeconds > 0)
		.map((d) => {
			const segments = (d.segments ?? []).filter((s) => !s.voided);
			const first = segments[0]?.rawStartedAt ?? d.evaluatedStart ?? null;
			const last = [...segments].reverse().find((s) => s.rawEndedAt)?.rawEndedAt ?? d.evaluatedEnd ?? null;
			return {
				date: d.date,
				weekday: WEEKDAYS[new Date(d.date + 'T12:00:00Z').getUTCDay()],
				rawStart: first ? localTimeOf(first) : '',
				rawEnd: last ? localTimeOf(last) : '',
				rawWork: d.rawWorkSeconds,
				startAdjust: d.startAdjustSeconds,
				endAdjust: d.endAdjustSeconds,
				breakDeduction: d.breakDeductionSeconds,
				evaluatedWork: d.evaluatedWorkSeconds,
				target: d.targetSeconds,
				delta: d.deltaSeconds,
				mark: d.mark && d.mark !== 'none' ? MARKS[d.mark] : '',
				status: d.provisional ? 'vorläufig' : ''
			};
		});
}

export function buildCsv(owner: string, from: string, to: string, rows: ExportRow[], createdAt: Date): string {
	const lines: string[] = [
		'Arbeitszeitnachweis',
		`Name;${csvCell(guardText(owner))}`,
		`Zeitraum;${formatDateNumeric(from)} – ${formatDateNumeric(to)}`,
		'',
		EXPORT_HEADERS.join(';')
	];
	const sum = { rawWork: 0, evaluatedWork: 0, target: 0, delta: 0 };
	for (const r of rows) {
		sum.rawWork += r.rawWork;
		sum.evaluatedWork += r.evaluatedWork;
		sum.target += r.target;
		sum.delta += r.delta;
		lines.push(
			[
				formatDateNumeric(r.date),
				r.weekday,
				r.rawStart,
				r.rawEnd,
				formatDuration(r.rawWork),
				formatDuration(r.startAdjust),
				formatDuration(r.endAdjust),
				formatDuration(r.breakDeduction),
				formatDuration(r.evaluatedWork),
				formatDuration(r.target),
				formatDuration(r.delta),
				csvCell(guardText(r.mark)),
				r.status
			].join(';')
		);
	}
	lines.push(['Summe', '', '', '', formatDuration(sum.rawWork), '', '', '', formatDuration(sum.evaluatedWork), formatDuration(sum.target), formatDuration(sum.delta), '', ''].join(';'));
	lines.push('', `Erstellt am ${createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
	// BOM so that German Excel opens the file as UTF-8
	return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Placeholder: starts with the ZIP signature so the type is recognisable, but it is not an openable workbook. */
export function buildXlsxPlaceholder(csv: string): Uint8Array {
	return new TextEncoder().encode('PK\u0003\u0004' + 'Platzhalter aus der Mock-API, keine echte XLSX-Datei.\n' + csv);
}

/** Minimal but valid one-page PDF (Helvetica, WinAnsi) listing the CSV lines; good enough for a download test. */
export function buildPdfPlaceholder(csv: string): Uint8Array {
	const latin = (text: string) => text.replace(/﻿/g, '').replace(/[–—]/g, '-').replace(/[„“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
	const escape = (text: string) => text.replace(/[\\()]/g, '\\$&');
	const lines = csv.split(/\r?\n/).slice(0, 48).map((l) => latin(l.replace(/;/g, '  ')));
	const content = ['BT', '/F1 8 Tf', '10 TL', '36 800 Td', ...lines.map((l) => `(${escape(l)}) '`), 'ET'].join('\n');
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
	];
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	const bytes = new Uint8Array(out.length);
	for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
	return bytes;
}
