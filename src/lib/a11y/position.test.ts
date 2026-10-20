import { describe, expect, it } from 'vitest';
import { clampMenu, placePopover } from './position.js';

const viewport = { width: 1000, height: 700 };
const size = { width: 200, height: 300 };

describe('clampMenu', () => {
	it('opens at the pointer when there is room', () => {
		expect(clampMenu({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
	});
	it('flips left and up at the right and bottom edge', () => {
		expect(clampMenu({ x: 950, y: 650 }, size, viewport)).toEqual({ x: 750, y: 350 });
	});
	it('clamps when it fits on neither side', () => {
		expect(clampMenu({ x: 50, y: 20 }, { width: 400, height: 900 }, { width: 300, height: 600 })).toEqual({ x: 8, y: 8 });
	});
});

describe('placePopover', () => {
	const anchor = { x: 400, y: 100, width: 80, height: 30 };
	it('prefers below the trigger', () => {
		expect(placePopover(anchor, size, viewport)).toEqual({ x: 400, y: 136, placement: 'below' });
	});
	it('flips above when below does not fit and above has more room', () => {
		const low = { x: 400, y: 600, width: 80, height: 30 };
		expect(placePopover(low, size, viewport)).toEqual({ x: 400, y: 294, placement: 'above' });
	});
	it('clamps horizontally into the viewport', () => {
		expect(placePopover({ ...anchor, x: 950 }, size, viewport).x).toBe(792);
		expect(placePopover({ ...anchor, x: -30 }, size, viewport).x).toBe(8);
	});
});
