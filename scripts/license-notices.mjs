import fs from 'node:fs';
import path from 'node:path';

const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING)(\.|$)/i;
const NOTICE_FILE = /^NOTICE(\.|$)/i;

/** Collect packages that ship in the browser: runtime dependencies and the bundled Inter font.
 * @param {string} root
 */
export function generateLicenseNotices(root) {
	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const queue = [...Object.keys(manifest.dependencies ?? {}), '@fontsource-variable/inter'];
	const packages = new Map();
	while (queue.length) {
		const name = queue.shift();
		if (!name) continue;
		if (packages.has(name)) continue;
		const directory = path.join(root, 'node_modules', name);
		const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
		packages.set(name, { directory, metadata });
		queue.push(...Object.keys(metadata.dependencies ?? {}));
	}
	const sections = [
		'Timetrack – Hinweise zu Drittanbieter-Lizenzen',
		'Diese Datei wird beim Build aus den installierten Paketmetadaten und Lizenzdateien erstellt.',
		'Enthalten sind die Laufzeitabhängigkeiten und die ausgelieferte Schrift Inter.'
	];
	for (const [name, { directory, metadata }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
		const files = fs.readdirSync(directory);
		const license = files.find((file) => LICENSE_FILE.test(file));
		if (!license) throw new Error(`Missing license file for ${name}`);
		sections.push(`\n${'='.repeat(72)}\nPackage: ${name}\nVersion: ${metadata.version}\nSPDX: ${metadata.license ?? 'unknown'}\nLicense file: ${license}\n`);
		sections.push(fs.readFileSync(path.join(directory, license), 'utf8').trim());
		const notice = files.find((file) => NOTICE_FILE.test(file));
		if (notice) sections.push(`\nNOTICE (${notice}):\n${fs.readFileSync(path.join(directory, notice), 'utf8').trim()}`);
		if (name === 'pdfjs-dist' && !notice) {
			// The npm distribution has no separate NOTICE file; retain the notice from its shipped JavaScript header.
			const source = fs.readFileSync(path.join(directory, 'build/pdf.mjs'), 'utf8');
			const header = source.match(/^\/\*\*[\s\S]*?@licend[\s\S]*?\*\//)?.[0];
			if (!header) throw new Error('Missing PDF.js license notice');
			sections.push(`\nNOTICE (build/pdf.mjs header; no separate NOTICE file in npm package):\n${header}`);
		}
	}
	return sections.join('\n') + '\n';
}
