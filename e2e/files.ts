import { crc32, deflateRawSync, inflateRawSync, inflateSync } from 'node:zlib';

// Small dependency-free helpers for the stage-3b specs: read/write ZIP (XLSX), pull cell text out of a worksheet,
// extract text from a simple PDF and parse semicolon/comma CSV. Test code only.

/** Reads all entries of a ZIP buffer (stored or deflated) via the central directory. */
export function unzip(buf: Buffer): Map<string, Buffer> {
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('not a ZIP file (no end of central directory)');
	const count = buf.readUInt16LE(eocd + 10);
	let p = buf.readUInt32LE(eocd + 16);
	const out = new Map<string, Buffer>();
	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
		const method = buf.readUInt16LE(p + 10);
		const compressed = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const local = buf.readUInt32LE(p + 42);
		const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
		const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const raw = buf.subarray(dataStart, dataStart + compressed);
		out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
		p += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}

/** Builds a ZIP (deflate) from name -> text entries. Enough for a minimal XLSX. */
export function zip(entries: Record<string, string>): Buffer {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(entries)) {
		const nameBuf = Buffer.from(name, 'utf8');
		const data = Buffer.from(text, 'utf8');
		const packed = deflateRawSync(data);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		parts.push(local, nameBuf, packed);
		const head = Buffer.alloc(46);
		head.writeUInt32LE(0x02014b50, 0);
		head.writeUInt16LE(20, 4);
		head.writeUInt16LE(20, 6);
		head.writeUInt16LE(0x0800, 8);
		head.writeUInt16LE(8, 10);
		head.writeUInt32LE(crc, 16);
		head.writeUInt32LE(packed.length, 20);
		head.writeUInt32LE(data.length, 24);
		head.writeUInt16LE(nameBuf.length, 28);
		head.writeUInt32LE(offset, 42);
		central.push(head, nameBuf);
		offset += local.length + nameBuf.length + packed.length;
	}
	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(central.length / 2, 8);
	end.writeUInt16LE(central.length / 2, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, centralBuf, end]);
}

const unescapeXml = (s: string) =>
	s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Cell {
	ref: string;
	type: string | null;
	/** index into cellXfs (style) */
	style: number | null;
	/** inline/shared text or the raw <v> value */
	value: string;
}

/** Cells of a worksheet XML in document order (inline strings, shared strings if a table is given, numbers). */
export function sheetCells(sheetXml: string, shared: string[] = []): Cell[] {
	const cells: Cell[] = [];
	for (const m of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
		const attrs = m[1];
		const body = m[2] ?? '';
		const ref = /\br="([^"]+)"/.exec(attrs)?.[1] ?? '';
		const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? null;
		const styleText = /\bs="(\d+)"/.exec(attrs)?.[1];
		let value = '';
		if (type === 'inlineStr') value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescapeXml(x[1])).join('');
		else {
			const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
			value = type === 's' ? (shared[Number(v)] ?? '') : unescapeXml(v);
		}
		cells.push({ ref, type, style: styleText === undefined ? null : Number(styleText), value });
	}
	return cells;
}

/** Workbook parts as text, the first worksheet's cells and the sheet names. */
export function readXlsx(buf: Buffer) {
	const files = unzip(buf);
	const text = (name: string) => files.get(name)?.toString('utf8') ?? '';
	const sharedXml = text('xl/sharedStrings.xml');
	const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescapeXml(x[1])).join(''));
	const sheetNames = [...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
	const sheetFile = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
	const styles = text('xl/styles.xml');
	const formatCodes = new Map([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), unescapeXml(m[2])]));
	const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
	const xfFormats = [...cellXfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map((m) => formatCodes.get(Number(m[1])) ?? `builtin:${m[1]}`);
	const cells = sheetCells(text(sheetFile), shared);
	return {
		files: [...files.keys()],
		sheetNames,
		cells,
		sheetXml: text(sheetFile),
		/** cell by reference, e.g. cell('I9') */
		cell: (ref: string) => cells.find((c) => c.ref === ref),
		/** number format code of a cell ("[h]:mm", "dd\\.mm\\.yyyy", ...) */
		formatOf: (ref: string) => {
			const style = cells.find((c) => c.ref === ref)?.style;
			return style == null ? undefined : xfFormats[style];
		}
	};
}

/** Minimal XLSX with the given sheets (rows of strings/numbers; strings as inline strings). */
export function buildXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Buffer {
	const col = (i: number) => String.fromCharCode(65 + i);
	const sheetXml = (rows: (string | number)[][]) =>
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
		rows
			.map(
				(row, r) =>
					`<row r="${r + 1}">` +
					row
						.map((v, c) =>
							typeof v === 'number'
								? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
								: `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${escapeXml(v)}</t></is></c>`
						)
						.join('') +
					`</row>`
			)
			.join('') +
		`</sheetData></worksheet>`;
	const entries: Record<string, string> = {
		'[Content_Types].xml':
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
			`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
			sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
			`</Types>`,
		'_rels/.rels':
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		'xl/workbook.xml':
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
			sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
			`</sheets></workbook>`,
		'xl/_rels/workbook.xml.rels':
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
			`</Relationships>`
	};
	sheets.forEach((s, i) => (entries[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows)));
	return zip(entries);
}

/** Text of all page content streams: hex strings `<..> Tj`, literal strings `(..) Tj` and TJ arrays, joined by newline. */
export function pdfText(buf: Buffer): string {
	const latin = buf.toString('latin1');
	const lines: string[] = [];
	for (const m of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
		let content = m[1];
		try {
			content = inflateSync(Buffer.from(content, 'latin1')).toString('latin1');
		} catch {
			/* uncompressed stream */
		}
		const decodeHex = (hex: string) => Buffer.from(hex.replace(/\s+/g, '').padEnd(Math.ceil(hex.length / 2) * 2, '0'), 'hex').toString('latin1');
		const decodeLit = (s: string) => s.replace(/\\([()\\])/g, '$1');
		for (const op of content.matchAll(/(?:<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\))\s*Tj|\[([^\]]*)\]\s*TJ/g)) {
			if (op[1] !== undefined) lines.push(decodeHex(op[1]));
			else if (op[2] !== undefined) lines.push(decodeLit(op[2]));
			else lines.push([...op[3].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g)].map((x) => (x[1] !== undefined ? decodeHex(x[1]) : decodeLit(x[2]))).join(''));
		}
	}
	// WinAnsi (latin1 superset for German text) -> JS string
	return lines.join('\n');
}

/** RFC 4180 style parser with a fixed delimiter (UTF-8 BOM stripped). */
export function parseCsv(text: string, delimiter: string): string[][] {
	const src = text.replace(/^﻿/, '');
	const rows: string[][] = [];
	let row: string[] = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"' && src[i + 1] === '"') (cur += '"', i++);
			else if (ch === '"') quoted = false;
			else cur += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === delimiter) (row.push(cur), (cur = ''));
		else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && src[i + 1] === '\n') i++;
			row.push(cur);
			rows.push(row);
			row = [];
			cur = '';
		} else cur += ch;
	}
	if (cur !== '' || row.length > 0) (row.push(cur), rows.push(row));
	return rows;
}
