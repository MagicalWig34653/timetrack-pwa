/**
 * Glow effect ("Leuchteffekt", G1). Four levels; the structure of each level lives in layout.css and is selected with
 * `data-glow` on <html>. This module only owns the level list and the one thing CSS cannot compute: a glow colour derived
 * from the chosen accent that is visible on the current page background (a pale yellow accent would otherwise vanish on
 * white, a dark navy on the dark theme).
 */
import { SURFACES, contrastRatio, mix, normalizeHex } from './accent';

export const GLOW_IDS = ['off', 'subtle', 'medium', 'strong'] as const;
export type GlowId = (typeof GLOW_IDS)[number];
export const DEFAULT_GLOW: GlowId = 'subtle';

export function isGlowId(value: unknown): value is GlowId {
	return typeof value === 'string' && (GLOW_IDS as readonly string[]).includes(value);
}

/** 0 = off .. 3 = strong. */
export function glowLevel(id: GlowId): number {
	return GLOW_IDS.indexOf(id);
}

/** Minimum contrast of the glow colour against the page background so that a halo is perceivable at all. */
export const MIN_GLOW_CONTRAST = 1.8;

/**
 * Colour of the halos: the accent itself when it stands out from the background, otherwise moved towards black (light
 * theme) or white (dark theme) in 10 % steps until it does. Falls back to the default blue for invalid input.
 */
export function glowColor(accent: string, dark: boolean): string {
	const hex = normalizeHex(accent);
	if (!hex) return '#2563eb';
	const background = (dark ? SURFACES.dark : SURFACES.light).background;
	const target = dark ? '#ffffff' : '#000000';
	let color = hex;
	for (let i = 1; i <= 10 && contrastRatio(color, background) < MIN_GLOW_CONTRAST; i++) color = mix(target, i * 10, hex);
	return color;
}

/** CSS custom properties written on <html> (the strength per level is defined in layout.css via `data-glow`). */
export function glowTokens(accent: string, dark: boolean): Record<string, string> {
	return { '--glow-color': glowColor(accent, dark) };
}
