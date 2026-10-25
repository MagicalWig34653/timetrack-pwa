import fs from 'node:fs';
import path from 'node:path';

const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING)(\.|$)/i;
const NOTICE_FILE = /^NOTICE(\.|$)/i;

const SOURCE_FILE = /\.(ts|js|mjs|svelte|css)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
// Specifiers in `from '…'`, side-effect `import '…'`, dynamic `import('…')` and CSS `@import '…'`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+(?:url\()?\s*)['"]([^'"]+)['"]/g;
// Packages whose runtime is compiled into every bundle without a bare import in src/ (Svelte and SvelteKit client runtime).
const IMPLICIT_RUNTIME = ['svelte', '@sveltejs/kit', 'clsx', 'esm-env', 'devalue'];
// Packages whose own dependencies are build-/server-side only (the static SPA bundles just the client runtime; the CSS packages contribute stylesheets only).
const NO_TRANSITIVE = new Set(['svelte', '@sveltejs/kit', 'shadcn-svelte', 'tailwindcss', 'tw-animate-css']);

/** @param {string} dir @param {string[]} out */
function sourceFiles(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) sourceFiles(file, out);
		else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(file);
	}
	return out;
}

/** Package names imported by the application sources (conservative: includes type-only imports, excludes tests).
 * @param {string} root
 */
export function importedPackages(root) {
	const names = new Set(IMPLICIT_RUNTIME);
	for (const file of sourceFiles(path.join(root, 'src'))) {
		for (const match of fs.readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
			const specifier = match[1];
			if (/^(\.|#|\$|\/|node:|https?:|data:)/.test(specifier)) continue;
			const parts = specifier.split('/');
			const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
			if (fs.existsSync(path.join(root, 'node_modules', name, 'package.json'))) names.add(name);
		}
	}
	return [...names].sort();
}

/** Collect packages that ship in the browser: runtime dependencies, the bundled Inter font and every package the
 * application sources import (including devDependencies such as icons and class helpers that Vite bundles).
 * @param {string} root
 */
export function generateLicenseNotices(root) {
	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	const queue = [...Object.keys(manifest.dependencies ?? {}), '@fontsource-variable/inter', ...importedPackages(root)];
	const packages = new Map();
	while (queue.length) {
		const name = queue.shift();
		if (!name) continue;
		if (packages.has(name)) continue;
		const directory = path.join(root, 'node_modules', name);
		const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
		packages.set(name, { directory, metadata });
		if (!NO_TRANSITIVE.has(name)) queue.push(...Object.keys(metadata.dependencies ?? {}));
	}
	const sections = [
		'Timetrack – Hinweise zu Drittanbieter-Lizenzen',
		'Diese Datei wird beim Build aus den installierten Paketmetadaten und Lizenzdateien erstellt.',
		'Enthalten sind die Laufzeitabhängigkeiten, die im Browser gebündelten Pakete und die ausgelieferte Schrift Inter.'
	];
	for (const [name, { directory, metadata }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
		const files = fs.readdirSync(directory);
		const license = files.find((file) => LICENSE_FILE.test(file));
		if (!license) throw new Error(`Missing license file for ${name}`);
		sections.push(`\n${'='.repeat(72)}\nPackage: ${name}\nVersion: ${metadata.version}\nSPDX: ${metadata.license ?? 'unknown'}\nLicense file: ${license}\n`);
		sections.push(fs.readFileSync(path.join(directory, license), 'utf8').replace(/\r\n/g, '\n').trim());
		const notice = files.find((file) => NOTICE_FILE.test(file));
		if (notice) sections.push(`\nNOTICE (${notice}):\n${fs.readFileSync(path.join(directory, notice), 'utf8').replace(/\r\n/g, '\n').trim()}`);
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
