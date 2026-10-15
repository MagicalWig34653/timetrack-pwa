// Renders static/icons/*.png from the original SVG symbol via headless Chromium (Playwright).
// Run: node scripts/generate-icons.mjs   (deterministic; commit the resulting PNGs)
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');
const symbol = readFileSync(join(dir, 'icon.svg'), 'utf8');
const inner = symbol.replace(/^[\s\S]*?<rect width="512" height="512"[^>]*\/>/, '').replace('</svg>', '');

// Maskable: full-bleed background, symbol scaled into the central safe zone (80 %).
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<rect width="512" height="512" fill="#171717"/><g transform="translate(256 256) scale(0.72) translate(-256 -256)">${inner}</g></svg>`;

// Names avoid the backend's "hashed asset" pattern ("-<8+ chars>.") so icons are not served as immutable.
const targets = [
	{ file: 'icon-192.png', size: 192, svg: symbol },
	{ file: 'icon-512.png', size: 512, svg: symbol },
	{ file: 'icon-maskable.png', size: 512, svg: maskable },
	{ file: 'apple-180.png', size: 180, svg: maskable }
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, svg } of targets) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`);
	writeFileSync(join(dir, file), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
await browser.close();
console.log('icons written to', dir);
