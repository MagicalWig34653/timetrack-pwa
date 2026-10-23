// Renders the raster icons from the SVG sources via headless Chromium (Playwright) and builds favicon.ico.
// Sources: static/icons/icon.svg (app icon, 512) and static/favicon.svg (tiny-size variant, 64).
// Run: npm run icons   (deterministic; commit the resulting files)
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'static');
const icon = readFileSync(join(root, 'icons', 'icon.svg'), 'utf8');
const favicon = readFileSync(join(root, 'favicon.svg'), 'utf8');
// Full-bleed variants (maskable / iOS apply their own shape): no rounded corners. Content already sits within the 80 % safe zone.
const fullBleed = icon.replace('rx="112"', 'rx="0"');

// Names avoid the backend's "hashed asset" pattern ("-<8+ chars>.") so icons are not served as immutable.
const targets = [
	{ file: 'icons/icon-192.png', size: 192, svg: icon },
	{ file: 'icons/icon-512.png', size: 512, svg: icon },
	{ file: 'icons/icon-mask.png', size: 512, svg: fullBleed },
	{ file: 'icons/apple-180.png', size: 180, svg: fullBleed },
	{ file: 'favicon-16.png', size: 16, svg: favicon },
	{ file: 'favicon-32.png', size: 32, svg: favicon }
];
const icoSizes = [16, 32, 48];

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size) {
	await page.setViewportSize({ width: size, height: size });
	const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
	await page.setContent(`<body style="margin:0;background:transparent">${sized}</body>`);
	return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
for (const { file, size, svg } of targets) writeFileSync(join(root, file), await render(svg, size));
const pngs = [];
for (const size of icoSizes) pngs.push({ size, data: await render(favicon, size) });
await browser.close();

// ICO container with PNG-compressed images (supported by all current browsers).
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map(({ size, data }) => {
	const e = Buffer.alloc(16);
	e[0] = size;
	e[1] = size;
	e.writeUInt16LE(1, 4); // planes
	e.writeUInt16LE(32, 6); // bpp
	e.writeUInt32LE(data.length, 8);
	e.writeUInt32LE(offset, 12);
	offset += data.length;
	return e;
});
writeFileSync(join(root, 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
console.log('icons written to', root);
