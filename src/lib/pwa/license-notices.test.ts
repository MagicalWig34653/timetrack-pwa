import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { generateLicenseNotices } from '../../../scripts/license-notices.mjs';

describe('shipped license notices', () => {
	it('contains installed runtime dependencies, their licenses, and the PDF.js notice', () => {
		const root = process.cwd();
		const notice = generateLicenseNotices(root);
		expect(fs.readFileSync(path.join(root, 'static', 'THIRD-PARTY-NOTICES.txt'), 'utf8')).toBe(notice);
		for (const name of ['pdf-lib', '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib', 'pdfjs-dist', '@fontsource-variable/inter', '@lucide/svelte', 'cn', 'tailwind-variants', 'clsx', 'svelte']) {
			const metadata = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
			expect(notice).toContain(`Package: ${name}\nVersion: ${metadata.version}`);
		}
		expect(notice).toContain('SPDX: Apache-2.0');
		expect(notice).toContain('NOTICE (build/pdf.mjs header');
		expect(notice).toContain('Copyright 2024 Mozilla Foundation');
		expect(notice).toContain('SIL OPEN FONT LICENSE');
	});

	it('lists every package that the production build bundled (when a build with sourcemaps exists)', () => {
		const root = process.cwd();
		const output = path.join(root, '.svelte-kit', 'output', 'client');
		if (!fs.existsSync(output)) return;
		const bundled = new Set<string>();
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const file = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(file);
				else if (entry.name.endsWith('.map')) {
					for (const source of (JSON.parse(fs.readFileSync(file, 'utf8')).sources ?? []) as string[]) {
						const match = source.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
						if (match) bundled.add(match[1]);
					}
				}
			}
		};
		walk(output);
		const notice = generateLicenseNotices(root);
		for (const name of bundled) expect(notice, `missing notice for bundled package ${name}`).toContain(`Package: ${name}\n`);
	});
	it('uses LF line endings only', () => {
		expect(generateLicenseNotices(process.cwd())).not.toContain('\r');
	});
});
