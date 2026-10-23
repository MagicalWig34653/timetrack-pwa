import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the single icon set (E1): every icon reference resolves to a file in static/, versions are consistent, and no
// SvelteKit template default (svelte-logo favicon, %sveltekit.assets%/favicon.png) is left anywhere.
const root = resolve(__dirname, '../../..');
const html = readFileSync(join(root, 'src/app.html'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'static/manifest.webmanifest'), 'utf8')) as { icons: { src: string; sizes: string; type: string; purpose?: string }[] };

const split = (ref: string) => {
	const [path, query = ''] = ref.split('?');
	return { path, version: new URLSearchParams(query).get('v') };
};
const linkRefs = [...html.matchAll(/<link\s+([^>]*?)\/?>/g)]
	.map((m) => ({ rel: /rel="([^"]+)"/.exec(m[1])?.[1] ?? '', href: /href="([^"]+)"/.exec(m[1])?.[1] ?? '', sizes: /sizes="([^"]+)"/.exec(m[1])?.[1] }))
	.filter((l) => /icon|manifest/.test(l.rel));

function pngSize(file: string) {
	const b = readFileSync(file);
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function walk(dir: string, out: string[] = []) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === '.svelte-kit' || name === 'build') continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

describe('icon set', () => {
	it('app.html links the full set: svg, png sizes, ico fallback, apple-touch-icon and manifest', () => {
		const hrefs = linkRefs.map((l) => split(l.href).path);
		expect(hrefs).toEqual(expect.arrayContaining(['/favicon.svg', '/favicon-16.png', '/favicon-32.png', '/favicon.ico', '/icons/apple-180.png', '/manifest.webmanifest']));
	});

	it('every linked file exists in static/ and carries the same cache-busting version', () => {
		const versions = new Set<string | null>();
		for (const l of linkRefs) {
			const { path, version } = split(l.href);
			expect(existsSync(join(root, 'static', path)), l.href).toBe(true);
			versions.add(version);
		}
		for (const icon of manifest.icons) {
			const { path, version } = split(icon.src);
			expect(existsSync(join(root, 'static', path)), icon.src).toBe(true);
			versions.add(version);
		}
		expect([...versions]).toHaveLength(1);
		expect([...versions][0]).toMatch(/^\d+$/);
	});

	it('png links declare the real pixel size', () => {
		for (const l of linkRefs.filter((x) => x.sizes && x.href.includes('.png'))) {
			const [w, h] = l.sizes!.split('x').map(Number);
			expect(pngSize(join(root, 'static', split(l.href).path)), l.href).toEqual({ width: w, height: h });
		}
		expect(pngSize(join(root, 'static/icons/apple-180.png'))).toEqual({ width: 180, height: 180 });
	});

	it('manifest has any and maskable PNG icons plus the svg', () => {
		const keys = manifest.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
		expect(keys).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable', 'any:any']));
		for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
			const [w, h] = icon.sizes.split('x').map(Number);
			expect(pngSize(join(root, 'static', split(icon.src).path)), icon.src).toEqual({ width: w, height: h });
		}
	});

	it('the ico fallback contains 16, 32 and 48 px images', () => {
		const ico = readFileSync(join(root, 'static/favicon.ico'));
		expect(ico.readUInt16LE(2)).toBe(1);
		const count = ico.readUInt16LE(4);
		const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);
		expect(sizes).toEqual(expect.arrayContaining([16, 32, 48]));
	});
});

describe('no SvelteKit default asset remains', () => {
	it('app.html has no %sveltekit.assets% icon reference and no favicon.png', () => {
		expect(html).not.toMatch(/%sveltekit\.assets%\/favicon/);
		expect(html).not.toMatch(/favicon\.png/);
	});

	it('no source file references the template favicon or the svelte logo', () => {
		const offenders = walk(join(root, 'src'))
			.filter((f) => /\.(svelte|ts|js|html|css)$/.test(f) && !f.endsWith('static-assets.test.ts'))
			.filter((f) => /lib\/assets\/favicon|svelte-logo/.test(readFileSync(f, 'utf8')));
		expect(offenders).toEqual([]);
		expect(existsSync(join(root, 'src/lib/assets/favicon.svg'))).toBe(false);
	});

	it('no static svg is the Svelte logo', () => {
		for (const f of walk(join(root, 'static')).filter((x) => x.endsWith('.svg'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/svelte-logo/i);
	});

	it('routes do not add their own rel=icon link', () => {
		const offenders = walk(join(root, 'src/routes')).filter((f) => f.endsWith('.svelte') && /rel="icon"/.test(readFileSync(f, 'utf8')));
		expect(offenders).toEqual([]);
	});
});

describe('offline fallback', () => {
	it('static/offline.html is a self-contained German page', () => {
		const page = readFileSync(join(root, 'static/offline.html'), 'utf8');
		expect(page).toContain('lang="de"');
		expect(page).toContain('Keine Verbindung');
		expect(page).not.toMatch(/<link[^>]+rel="stylesheet"/);
		expect(page).not.toMatch(/<script[^>]+src=/);
	});
});
