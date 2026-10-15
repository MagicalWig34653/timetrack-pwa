import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, DEFAULT_ACCENT, SURFACES, accentTokens, contrastRatio, foregroundFor, normalizeHex, relativeLuminance, hexToRgb, mix } from './accent';

const samples = [
	'#000000', '#ffffff', '#2563eb', '#0d9488', '#16a34a', '#d97706', '#e11d48', '#7c3aed', '#475569',
	'#ffff00', '#00ffff', '#ff00ff', '#ff0000', '#00ff00', '#0000ff', '#facc15', '#a3e635', '#fde68a',
	'#f9a8d4', '#93c5fd', '#111827', '#808080', '#777777', '#767676', '#ff7f50', '#20b2aa', '#4b0082',
	...Array.from({ length: 36 }, (_, i) => `hsl-${i * 10}`)
].map((value) => {
	if (!value.startsWith('hsl-')) return value;
	// hue sweep at mid saturation and lightness, converted to hex
	const h = Number(value.slice(4));
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
});

describe('hex handling', () => {
	it('normalises and validates', () => {
		expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
		expect(normalizeHex(' #fa0 ')).toBe('#ffaa00');
		for (const bad of ['', 'red', '#12', '#12345', '#1234567', '2563eb', '#gggggg', 'rgb(0,0,0)']) expect(normalizeHex(bad)).toBeNull();
		expect(accentTokens('nonsense', false)).toBeNull();
	});
	it('computes WCAG luminance and contrast', () => {
		expect(relativeLuminance(hexToRgb('#ffffff'))).toBeCloseTo(1, 5);
		expect(relativeLuminance(hexToRgb('#000000'))).toBeCloseTo(0, 5);
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 3);
	});
	it('mixes in sRGB', () => {
		expect(mix('#000000', 50, '#ffffff')).toBe('#808080');
	});
});

describe('accent tokens', () => {
	it('uses the documented default', () => {
		expect(DEFAULT_ACCENT).toBe('#2563eb');
		expect(ACCENT_PRESETS[0].hex).toBe(DEFAULT_ACCENT);
	});
	it('picks a foreground with at least 4.5:1', () => {
		for (const hex of samples) {
			const fg = foregroundFor(hex);
			expect(contrastRatio(hex, fg), `${hex} on ${fg}`).toBeGreaterThanOrEqual(4.5);
		}
	});
	for (const dark of [false, true]) {
		it(`keeps ink >= 4.5:1 on the real surfaces (${dark ? 'dark' : 'light'})`, () => {
			const surfaces = dark ? SURFACES.dark : SURFACES.light;
			for (const hex of [...samples, ...ACCENT_PRESETS.map((p) => p.hex)]) {
				const tokens = accentTokens(hex, dark)!;
				expect(tokens.primary).toBe(normalizeHex(hex));
				expect(contrastRatio(tokens.ink, surfaces.background), `${hex} ink on background`).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(tokens.ink, surfaces.sidebar), `${hex} ink on sidebar`).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(tokens.ink, tokens.softResolved), `${hex} ink on soft`).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(tokens.foreground, tokens.primary), `${hex} foreground`).toBeGreaterThanOrEqual(4.5);
			}
		});
	}
	it('leaves already readable colours untouched', () => {
		expect(accentTokens('#1e3a8a', false)!.ink).toBe('#1e3a8a');
		expect(accentTokens('#93c5fd', true)!.ink).toBe('#93c5fd');
	});
	it('darkens light accents in light mode and lightens dark accents in dark mode', () => {
		expect(relativeLuminance(hexToRgb(accentTokens('#facc15', false)!.ink))).toBeLessThan(relativeLuminance(hexToRgb('#facc15')));
		expect(relativeLuminance(hexToRgb(accentTokens('#1e3a8a', true)!.ink))).toBeGreaterThan(relativeLuminance(hexToRgb('#1e3a8a')));
	});
	it('uses 9 % soft tint in light and 18 % in dark', () => {
		expect(accentTokens('#2563eb', false)!.soft).toContain('9%');
		expect(accentTokens('#2563eb', true)!.soft).toContain('18%');
	});
});
