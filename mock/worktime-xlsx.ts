// Minimal XLSX reader/writer for the mock API (Node only): ZIP (stored/deflate), sheet XML cells, and the yearly-sheet layout of
// ADR-0013 ("Arbeitszeit-Tabelle"). The real backend has its own reader and writer; this one backs detection/parsing in the mock
// import, the mock export and the synthetic test workbooks. No real data is used anywhere: tests build workbooks from literals.
import { inflateRawSync } from 'node:zlib';
import { addDays, startOfWeek } from '../src/lib/time/dates.ts';
import type { WorktimeDayRow } from '../src/lib/transfer/worktime.ts';

// ---------------------------------------------------------------------------------------------------- ZIP

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function zlibCrc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

const MAX_ENTRIES = 200;
const MAX_UNCOMPRESSED = 64 * 1024 * 1024;

/** Reads all entries of a ZIP archive (stored or deflate). Throws on anything malformed or oversized. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocd = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('not a zip');
	const count = view.getUint16(eocd + 10, true);
	if (count > MAX_ENTRIES) throw new Error('too many entries');
	let offset = view.getUint32(eocd + 16, true);
	const out = new Map<string, Uint8Array>();
	let total = 0;
	for (let i = 0; i < count; i++) {
		if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('bad central directory');
		const method = view.getUint16(offset + 10, true);
		const compressed = view.getUint32(offset + 20, true);
		const size = view.getUint32(offset + 24, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const local = view.getUint32(offset + 42, true);
		const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
		offset += 46 + nameLength + extraLength + commentLength;
		total += size;
		if (total > MAX_UNCOMPRESSED) throw new Error('too large');
		const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const raw = bytes.subarray(dataStart, dataStart + compressed);
		if (method === 0) out.set(name, raw);
		else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(raw, { maxOutputLength: MAX_UNCOMPRESSED })));
		else throw new Error('unsupported compression');
	}
	return out;
}

/** Writes a ZIP archive with stored (uncompressed) entries. */
export function writeZip(files: Record<string, string>): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const nameBytes = encoder.encode(name);
		const data = encoder.encode(content);
		const crc = zlibCrc32(data);
		const local = new Uint8Array(30 + nameBytes.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, 0x0800, true); // UTF-8 names
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true);
		lv.setUint32(22, data.length, true);
		lv.setUint16(26, nameBytes.length, true);
		local.set(nameBytes, 30);
		const entry = new Uint8Array(46 + nameBytes.length);
		const ev = new DataView(entry.buffer);
		ev.setUint32(0, 0x02014b50, true);
		ev.setUint16(4, 20, true);
		ev.setUint16(6, 20, true);
		ev.setUint16(8, 0x0800, true);
		ev.setUint32(16, crc, true);
		ev.setUint32(20, data.length, true);
		ev.setUint32(24, data.length, true);
		ev.setUint16(28, nameBytes.length, true);
		ev.setUint32(42, offset, true);
		entry.set(nameBytes, 46);
		chunks.push(local, data);
		central.push(entry);
		offset += local.length + data.length;
	}
	const centralSize = central.reduce((n, c) => n + c.length, 0);
	const end = new Uint8Array(22);
	const dv = new DataView(end.buffer);
	dv.setUint32(0, 0x06054b50, true);
	dv.setUint16(8, central.length, true);
	dv.setUint16(10, central.length, true);
	dv.setUint32(12, centralSize, true);
	dv.setUint32(16, offset, true);
	const all = [...chunks, ...central, end];
	const result = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of all) {
		result.set(c, at);
		at += c.length;
	}
	return result;
}

// ---------------------------------------------------------------------------------------------------- workbook (read)

export interface Cell {
	/** number for numeric cells, string for text, null for empty */
	value: number | string | null;
	formula?: boolean;
}

export interface Sheet {
	name: string;
	/** 1-based row -> column letter -> cell */
	rows: Map<number, Map<string, Cell>>;
}

export interface Workbook {
	date1904: boolean;
	sheets: Sheet[];
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : '');

function sharedStrings(xml: string): string[] {
	return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
}

export function readWorkbook(bytes: Uint8Array): Workbook {
	const files = readZip(bytes);
	const workbookXml = text(files.get('xl/workbook.xml'));
	if (!workbookXml) throw new Error('not a workbook');
	const rels = new Map<string, string>();
	for (const m of text(files.get('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
		const id = m[1].match(/\bId="([^"]*)"/)?.[1];
		const target = m[1].match(/\bTarget="([^"]*)"/)?.[1];
		if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
	}
	const strings = sharedStrings(text(files.get('xl/sharedStrings.xml')));
	const sheets: Sheet[] = [];
	for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
		const name = unescapeXml(m[1].match(/\bname="([^"]*)"/)?.[1] ?? '');
		const rid = m[1].match(/\br:id="([^"]*)"/)?.[1] ?? '';
		const xml = text(files.get(rels.get(rid) ?? ''));
		const rows = new Map<number, Map<string, Cell>>();
		for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const ref = c[1].match(/\br="([A-Z]+)(\d+)"/);
			if (!ref) continue;
			const type = c[1].match(/\bt="([^"]*)"/)?.[1];
			const body = c[2] ?? '';
			const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
			const formula = /<f\b/.test(body);
			let value: Cell['value'] = null;
			if (type === 'inlineStr') value = unescapeXml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
			else if (v !== undefined && type === 's') value = strings[Number(v)] ?? null;
			else if (v !== undefined && (type === 'str' || type === 'e')) value = unescapeXml(v);
			else if (v !== undefined && v !== '') value = Number(v);
			const row = Number(ref[2]);
			if (!rows.has(row)) rows.set(row, new Map());
			rows.get(row)!.set(ref[1], { value, formula });
		}
		sheets.push({ name, rows });
	}
	return { date1904: /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbookXml), sheets };
}

// ---------------------------------------------------------------------------------------------------- worktime layout

const SERIAL_1900_OFFSET = 25569; // days from 1899-12-30 to 1970-01-01
const DATE_1904_OFFSET = 1462;

export function dateToSerial(date: string, date1904 = false): number {
	return Math.round(Date.parse(date + 'T00:00:00Z') / 86_400_000) + SERIAL_1900_OFFSET - (date1904 ? DATE_1904_OFFSET : 0);
}
export function serialToDate(serial: number, date1904 = false): string | null {
	const day = Math.floor(serial) + (date1904 ? DATE_1904_OFFSET : 0);
	if (!Number.isFinite(day) || day < 61 || day > 2_958_465) return null;
	return new Date((day - SERIAL_1900_OFFSET) * 86_400_000).toISOString().slice(0, 10);
}

const WEEK_HEADER = /^KW\s*\d{1,2}(?:\s*-\s*\d{4})?$/i;
const str = (cell: Cell | undefined) => (typeof cell?.value === 'string' ? cell.value : '');
const num = (cell: Cell | undefined) => (typeof cell?.value === 'number' ? cell.value : null);

/** A sheet is a worktime sheet when A1 reads "Wochenarbeitszeit" or a "KWnn" header is followed by a date row. */
export function isWorktimeSheet(sheet: Sheet): boolean {
	if (str(sheet.rows.get(1)?.get('A')).trim().toLowerCase() === 'wochenarbeitszeit') return true;
	for (const [row, cells] of sheet.rows) {
		if (WEEK_HEADER.test(str(cells.get('A')).trim()) && num(sheet.rows.get(row + 1)?.get('A')) !== null) return true;
	}
	return false;
}

export interface ParsedWorktimeWorkbook {
	dateSystem: '1900' | '1904';
	rows: WorktimeDayRow[];
	tablePauseMinutes: number;
	sheetBalanceSeconds: number | null;
	sheets: string[];
}

export function detectWorktimeWorkbook(bytes: Uint8Array): boolean {
	try {
		return readWorkbook(bytes).sheets.some(isWorktimeSheet);
	} catch {
		return false;
	}
}

/** Extracts `{Datum, Beginn?, Ende?, Bemerkung?}` rows of all worktime sheets. D/E/G/B2 are never imported (E only feeds `sheetBalanceSeconds`). */
export function parseWorktimeWorkbook(bytes: Uint8Array): ParsedWorktimeWorkbook {
	const book = readWorkbook(bytes);
	const rows: WorktimeDayRow[] = [];
	let pause = 0;
	let balance: number | null = null;
	const balanceDates = new Set<string>();
	for (const sheet of book.sheets.filter(isWorktimeSheet)) {
		const h1 = num(sheet.rows.get(1)?.get('H'));
		if (pause === 0 && h1 !== null) pause = Math.round(h1 * 1440);
		for (const [row, cells] of [...sheet.rows].sort((a, b) => a[0] - b[0])) {
			if (row < 3) continue;
			const serial = num(cells.get('A'));
			if (serial === null) continue;
			const date = serialToDate(serial, book.date1904);
			if (!date) continue;
			const b = num(cells.get('B'));
			const c = num(cells.get('C'));
			rows.push({
				date,
				sheet: sheet.name,
				row,
				start: b === null ? null : b * 86_400,
				end: c === null ? null : c * 86_400,
				remark: str(cells.get('F'))
			});
			const e = num(cells.get('E'));
			if (e !== null && !balanceDates.has(date)) {
				balanceDates.add(date);
				balance = (balance ?? 0) + Math.round(e * 86_400);
			}
		}
	}
	return { dateSystem: book.date1904 ? '1904' : '1900', rows, tablePauseMinutes: pause, sheetBalanceSeconds: balance, sheets: book.sheets.map((s) => s.name) };
}

/** Raw rows (all cells as text) of one sheet for the wizard's preview table. */
export function sheetToRows(sheet: Sheet, maxRows = 50): (string | null)[][] {
	const out: (string | null)[][] = [];
	const rowNumbers = [...sheet.rows.keys()].sort((a, b) => a - b).slice(0, maxRows);
	for (const rowNumber of rowNumbers) {
		const cells = sheet.rows.get(rowNumber)!;
		const line: (string | null)[] = [];
		for (const [col, cell] of cells) {
			const index = col.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
			line[index] = cell.value === null ? null : String(cell.value);
		}
		out[rowNumber - 1] = Array.from(line, (v) => v ?? null);
	}
	return Array.from(out, (r) => r ?? []);
}

// ---------------------------------------------------------------------------------------------------- worktime layout (write)

export interface WorktimeSheetInput {
	/** calendar year; becomes the sheet name */
	year: number;
	days: { date: string; start?: string | null; end?: string | null; remark?: string | null }[];
	/** also write the given days into weeks that belong to another ISO year (a boundary week filled in both sheets; default: date cells only) */
	writeForeignWeeks?: boolean;
}

export interface WorktimeWorkbookInput {
	date1904?: boolean;
	/** daily pause as "H:MM"; default 0:30 */
	pause?: string;
	/** weekly target in hours; default 38.5 */
	weeklyHours?: number;
	sheets: WorktimeSheetInput[];
}

const parseHm = (value: string): number => {
	const [h, m = 0, s = 0] = value.split(':').map(Number);
	return (h * 3600 + m * 60 + s) / 86_400;
};

function cellXml(ref: string, value: number | string | null | undefined, formula?: string): string {
	if (formula !== undefined) return `<c r="${ref}"><f>${escapeXml(formula)}</f>${typeof value === 'number' ? `<v>${value}</v>` : ''}</c>`;
	if (value === null || value === undefined || value === '') return '';
	if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
	return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Builds a workbook in the layout of ADR-0013: header rows, then weekly blocks of 9 rows from row 6 (KW header, Mon-Sun, blank).
 * Day rows hold date serial, start/end fractions, `=C-B-$H$1` and `=D-$E$1` formulas with cached values, and the remark.
 */
export function buildWorktimeWorkbook(input: WorktimeWorkbookInput): Uint8Array {
	const date1904 = input.date1904 ?? false;
	const pauseFraction = parseHm(input.pause ?? '0:30');
	const weekly = (input.weeklyHours ?? 38.5) / 24;
	const sheetsXml: string[] = [];
	input.sheets.forEach((sheet, sheetIndex) => {
		const byDate = new Map(sheet.days.map((d) => [d.date, d]));
		const rows: string[] = [];
		const addRow = (n: number, cells: string[]) => rows.push(`<row r="${n}">${cells.join('')}</row>`);
		addRow(1, [cellXml('A1', 'Wochenarbeitszeit'), cellXml('B1', weekly), cellXml('D1', 'Tägl. Arbeitszeit'), cellXml('E1', weekly / 5, 'B1/5'), cellXml('G1', 'Pause'), cellXml('H1', pauseFraction)]);
		addRow(2, [cellXml('A2', 'Summe'), cellXml('B2', 0, `SUM(E7:E${6 + 9 * 60})`)]);
		const first = `${sheet.year}-01-01`;
		const last = `${sheet.year}-12-31`;
		let monday = startOfWeek(first);
		let row = 6;
		while (monday <= last) {
			const isoYear = Number(addDays(monday, 3).slice(0, 4));
			const week = Math.ceil((Date.parse(addDays(monday, 3) + 'T00:00:00Z') - Date.parse(`${isoYear}-01-01T00:00:00Z`) + 86_400_000) / 86_400_000 / 7);
			const label = `KW${String(week).padStart(2, '0')}${isoYear === sheet.year ? '' : ` - ${isoYear}`}`;
			addRow(row, [cellXml(`A${row}`, label)]);
			for (let i = 0; i < 7; i++) {
				const date = addDays(monday, i);
				const r = row + 1 + i;
				const day = isoYear === sheet.year || sheet.writeForeignWeeks ? byDate.get(date) : undefined;
				const start = day?.start ? parseHm(day.start) : null;
				const end = day?.end ? parseHm(day.end) : null;
				const cells = [cellXml(`A${r}`, dateToSerial(date, date1904)), cellXml(`B${r}`, start), cellXml(`C${r}`, end)];
				if (start !== null && end !== null) {
					cells.push(cellXml(`D${r}`, end - start - pauseFraction, `C${r}-B${r}-$H$1`), cellXml(`E${r}`, end - start - pauseFraction - weekly / 5, `D${r}-$E$1`));
				}
				cells.push(cellXml(`F${r}`, day?.remark));
				addRow(r, cells);
			}
			row += 9;
			monday = addDays(monday, 7);
		}
		sheetsXml.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`);
		void sheetIndex;
	});
	const sheetEntries = input.sheets.map((s, i) => `<sheet name="${s.year}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
	const files: Record<string, string> = {
		'[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${input.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
		'_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
		'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${sheetEntries}</sheets></workbook>`,
		'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${input.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`
	};
	sheetsXml.forEach((xml, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = xml));
	return writeZip(files);
}

/** Builds a generic one-sheet workbook of text/number rows (for generic-profile tests); numbers stay numeric. */
export function buildSimpleWorkbook(sheetName: string, rows: (string | number | null)[][]): Uint8Array {
	const col = (i: number) => String.fromCharCode(65 + i);
	const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
		.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellXml(`${col(j)}${i + 1}`, v)).join('')}</row>`)
		.join('')}</sheetData></worksheet>`;
	return writeZip({
		'[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
		'_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
		'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
		'xl/worksheets/sheet1.xml': sheet
	});
}

