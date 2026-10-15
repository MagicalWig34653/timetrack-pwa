/**
 * Accent derivation (docs/DESIGN.md, "Akzentfarbe"). From one user-chosen colour four tokens are computed:
 * primary surface, foreground on it, ink (accent as text colour, adjusted until >= 4.5:1) and a soft tint.
 */

export const DEFAULT_ACCENT = '#2563eb';

/** The actual surfaces the accent text can sit on (hex of --background / --sidebar in layout.css). */
export const SURFACES = {
	light: { background: '#ffffff', sidebar: '#fafafa' },
	dark: { background: '#09090b', sidebar: '#18181b' }
} as const;

export const MIN_TEXT_CONTRAST = 4.5;

export type Rgb = [number, number, number];

/** Returns the normalised lowercase `#rrggbb` or null. Accepts `#rgb` shorthand. */
export function normalizeHex(input: string): string | null {
	const value = input.trim();
	const long = /^#([0-9a-f]{6})$/i.exec(value);
	if (long) return `#${long[1].toLowerCase()}`;
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
	if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
	return null;
}

export function hexToRgb(hex: string): Rgb {
	const n = normalizeHex(hex);
	if (!n) throw new Error(`invalid hex colour: ${hex}`);
	return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16)) as Rgb;
}

export function rgbToHex(rgb: readonly number[]): string {
	return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** WCAG relative luminance. */
export function relativeLuminance(rgb: readonly number[]): number {
	const [r, g, b] = rgb.map((v) => {
		const x = v / 255;
		return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(hexToRgb(a));
	const lb = relativeLuminance(hexToRgb(b));
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text colour on the accent surface: white or black, whichever contrasts more (always >= 4.5:1). */
export function foregroundFor(hex: string): '#ffffff' | '#000000' {
	return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000') ? '#ffffff' : '#000000';
}

/** sRGB mix of `hex` (share in percent) over `base`, as the CSS color-mix in srgb does. */
export function mix(hex: string, share: number, base: string): string {
	const a = hexToRgb(hex);
	const b = hexToRgb(base);
	return rgbToHex(a.map((v, i) => v * (share / 100) + b[i] * (1 - share / 100)));
}

export interface AccentTokens {
	primary: string;
	foreground: string;
	ink: string;
	soft: string;
	/** the soft tint resolved against the page background (for contrast checks) */
	softResolved: string;
}

/**
 * Derives the tokens for one scheme. The ink is moved in 10 % steps towards black (light) or white (dark) until it
 * reaches 4.5:1 against the page background, the sidebar and the soft tint on both (active navigation, chips).
 * Returns null for invalid input.
 */
export function accentTokens(input: string, dark: boolean): AccentTokens | null {
	const hex = normalizeHex(input);
	if (!hex) return null;
	const { background, sidebar } = dark ? SURFACES.dark : SURFACES.light;
	const share = dark ? 18 : 9;
	const soft = mix(hex, share, background);
	const surfaces = [background, sidebar, soft, mix(hex, share, sidebar)];
	const target = dark ? '#ffffff' : '#000000';
	let ink = hex;
	for (let i = 1; i <= 10 && !surfaces.every((s) => contrastRatio(ink, s) >= MIN_TEXT_CONTRAST); i++) {
		ink = mix(target, i * 10, hex);
	}
	return {
		primary: hex,
		foreground: foregroundFor(hex),
		ink,
		soft: `color-mix(in srgb, ${hex} ${share}%, var(--background))`,
		softResolved: soft
	};
}

/** Presets offered in the palette. */
export const ACCENT_PRESETS: { id: string; hex: string }[] = [
	{ id: 'blue', hex: '#2563eb' },
	{ id: 'teal', hex: '#0d9488' },
	{ id: 'green', hex: '#16a34a' },
	{ id: 'amber', hex: '#d97706' },
	{ id: 'rose', hex: '#e11d48' },
	{ id: 'violet', hex: '#7c3aed' },
	{ id: 'slate', hex: '#475569' }
];
