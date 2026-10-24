import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { generateLicenseNotices } from '../../../scripts/license-notices.mjs';

describe('shipped license notices', () => {
	it('contains installed runtime dependencies, their licenses, and the PDF.js notice', () => {
		const root = process.cwd();
		const notice = generateLicenseNotices(root);
		expect(fs.readFileSync(path.join(root, 'static', 'THIRD-PARTY-NOTICES.txt'), 'utf8')).toBe(notice);
		for (const name of ['pdf-lib', '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib', 'pdfjs-dist', '@fontsource-variable/inter']) {
			const metadata = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
			expect(notice).toContain(`Package: ${name}\nVersion: ${metadata.version}`);
		}
		expect(notice).toContain('SPDX: Apache-2.0');
		expect(notice).toContain('NOTICE (build/pdf.mjs header');
		expect(notice).toContain('Copyright 2024 Mozilla Foundation');
		expect(notice).toContain('SIL OPEN FONT LICENSE');
	});
});
