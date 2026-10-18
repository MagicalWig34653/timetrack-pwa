import { describe, expect, it } from 'vitest';
import { ACCENT_IDS, ACCENT_IDS_V015, ACCENT_IDS_V021, ACCENT_PRESETS, MIN_TEXT_CONTRAST, SURFACES, accentTokens, contrastRatio, hexToRgb, mix, whiteOnAccent } from './accent';
import { DEFAULT_GLOW, GLOW_IDS, MIN_GLOW_CONTRAST, glowColor, glowLevel, glowTokens, isGlowId } from './glow';

describe('glow levels', () => {
	it('has off, subtle, medium, strong in order with subtle as default', () => {
		expect([...GLOW_IDS]).toEqual(['off', 'subtle', 'medium', 'strong']);
		expect(GLOW_IDS.map(glowLevel)).toEqual([0, 1, 2, 3]);
		expect(DEFAULT_GLOW).toBe('subtle');
		expect(isGlowId('strong')).toBe(true);
		expect(isGlowId('max')).toBe(false);
		expect(isGlowId(2)).toBe(false);
	});
});

describe('glow colour derivation', () => {
	it('keeps accents that stand out from the page and moves the others away from it', () => {
		expect(glowColor('#2563eb', false)).toBe('#2563eb');
		expect(glowColor('#2563eb', true)).toBe('#2563eb');
		// a very light yellow would vanish on white: it is darkened until the halo is visible
		expect(glowColor('#fde68a', false)).not.toBe('#fde68a');
		expect(contrastRatio(glowColor('#fde68a', false), SURFACES.light.background)).toBeGreaterThanOrEqual(MIN_GLOW_CONTRAST);
		// a dark navy vanishes on the dark theme: it is lightened
		expect(contrastRatio(glowColor('#1e3a8a', true), SURFACES.dark.background)).toBeGreaterThanOrEqual(MIN_GLOW_CONTRAST);
	});

	it('is visible for every preset and for light and dark custom colours in both schemes', () => {
		const colours = [...ACCENT_PRESETS.map((p) => p.hex), '#ffff00', '#fef9c3', '#000000', '#ffffff', '#111827'];
		for (const dark of [false, true]) {
			const background = dark ? SURFACES.dark.background : SURFACES.light.background;
			for (const hex of colours) {
				expect(contrastRatio(glowColor(hex, dark), background), `${hex} ${dark ? 'dark' : 'light'}`).toBeGreaterThanOrEqual(MIN_GLOW_CONTRAST - 0.05);
			}
		}
	});

	it('returns the CSS variable for the root element and survives invalid input', () => {
		expect(glowTokens('#d97706', false)).toEqual({ '--glow-color': '#d97706' });
		expect(glowColor('nope', false)).toBe('#2563eb');
	});
});

describe('accent presets', () => {
	it('keeps the contract ids and adds fourteen white-text presets', () => {
		expect(ACCENT_IDS.slice(0, 7)).toEqual(['blue', 'teal', 'violet', 'green', 'orange', 'pink', 'graphite']);
		expect([...ACCENT_IDS_V015]).toEqual(['indigo', 'navy', 'purple', 'magenta', 'crimson', 'forest', 'petrol', 'bronze']);
		expect([...ACCENT_IDS_V021]).toEqual(['wine', 'slate', 'cocoa', 'olive', 'ocean', 'ink']);
		expect(ACCENT_IDS).toHaveLength(21);
		expect(ACCENT_PRESETS.map((p) => p.id)).toEqual([...ACCENT_IDS]);
		expect(new Set(ACCENT_PRESETS.map((p) => p.hex)).size).toBe(ACCENT_PRESETS.length);
	});

	for (const preset of ACCENT_PRESETS) {
		for (const dark of [false, true]) {
			it(`${preset.id} (${dark ? 'dark' : 'light'}): readable text on the fill and as ink`, () => {
				const tokens = accentTokens(preset.hex, dark)!;
				expect(contrastRatio(tokens.primary, tokens.foreground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
				const { background, sidebar } = dark ? SURFACES.dark : SURFACES.light;
				expect(contrastRatio(tokens.ink, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
				expect(contrastRatio(tokens.ink, sidebar)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
				expect(contrastRatio(tokens.ink, tokens.softResolved)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
			});
		}
	}

	it('the new presets carry white text, three of the old ones black', () => {
		for (const id of [...ACCENT_IDS_V015, ...ACCENT_IDS_V021]) expect(whiteOnAccent(ACCENT_PRESETS.find((p) => p.id === id)!.hex), id).toBe(true);
		for (const id of ['teal', 'green', 'orange']) expect(whiteOnAccent(ACCENT_PRESETS.find((p) => p.id === id)!.hex), id).toBe(false);
	});
});

/** OKLab distance (x100) of two hex colours. */
function oklabDistance(a: string, b: string): number {
	const lab = (hex: string) => {
		const [r, g, bl] = hexToRgb(hex).map((v) => {
			const x = v / 255;
			return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
		});
		const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
		const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
		const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
		return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
	};
	const x = lab(a);
	const y = lab(b);
	return Math.hypot(...x.map((v, i) => (v - y[i]) * 100));
}

describe('AC2 presets', () => {
	const added = ACCENT_PRESETS.filter((p) => ACCENT_IDS_V021.includes(p.id));

	it('every new preset has white-text contrast of at least 4.5:1', () => {
		expect(added).toHaveLength(6);
		for (const preset of added) expect(contrastRatio(preset.hex, '#ffffff'), preset.id).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
	});

	it('every new preset is visibly distinct from all other presets (OKLab distance >= 5.5)', () => {
		for (const preset of added) {
			for (const other of ACCENT_PRESETS) {
				if (other.id === preset.id) continue;
				expect(oklabDistance(preset.hex, other.hex), `${preset.id} vs ${other.id}`).toBeGreaterThanOrEqual(5.5);
			}
		}
	});
});

describe('muted text on the glass sheet', () => {
	it('stays above 4.5:1 with the strongest aurora tint behind the sheet', () => {
		const mutedLight = '#71717a'; // --muted-foreground, light
		const mutedDark = '#a1a1aa'; // --muted-foreground, dark
		for (const preset of ACCENT_PRESETS) {
			// aurora (<= 20 % light, 34 % dark) seen through a sheet that is 66 % / 58 % opaque
			const light = mix(mix(preset.hex, 20 * 0.34, '#ffffff'), 100, '#ffffff');
			const lightSheet = mix('#ffffff', 66, light);
			expect(contrastRatio(mutedLight, lightSheet), preset.id).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
			const dark = mix(preset.hex, 34 * 0.42, '#09090b');
			const darkSheet = mix('#09090b', 58, dark);
			expect(contrastRatio(mutedDark, darkSheet), preset.id).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
		}
	});
});
