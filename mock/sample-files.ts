// Small, valid sample attachments for the dev mock (a real PDF and a PNG), so previews can be tried without uploading.
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** 240x140 PNG with a diagonal colour gradient (scan placeholder). */
export function samplePng(): Uint8Array {
	const width = 240;
	const height = 140;
	const raw = new Uint8Array((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (width * 3 + 1);
		for (let x = 0; x < width; x++) {
			const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
			raw[row + 1 + x * 3] = border ? 40 : 120 + Math.floor((x / width) * 100);
			raw[row + 2 + x * 3] = border ? 40 : 150 + Math.floor((y / height) * 80);
			raw[row + 3 + x * 3] = border ? 40 : 220;
		}
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = 8; // bit depth
	header[9] = 2; // RGB
	const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

/** One-page PDF with a line of text. The text must be ASCII without parentheses. */
export function samplePdf(text: string): Uint8Array {
	const stream = `BT /F1 20 Tf 60 740 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((o, i) => {
		offsets.push(body.length);
		body += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(body);
}
