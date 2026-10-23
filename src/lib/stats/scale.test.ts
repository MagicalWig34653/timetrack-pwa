import { describe, expect, it } from 'vitest';
import { hourTicks, labelIndexes, niceTicks } from './scale.js';

describe('scales', () => {
	it('nice ticks cover the range', () => {
		const t = niceTicks(0, 37);
		expect(t[0]).toBeLessThanOrEqual(0);
		expect(t.at(-1)!).toBeGreaterThanOrEqual(37);
		expect(t.length).toBeLessThanOrEqual(8);
	});
	it('handles flat and negative ranges', () => {
		expect(niceTicks(5, 5).length).toBeGreaterThan(1);
		const t = niceTicks(-10, 20);
		expect(t[0]).toBeLessThanOrEqual(-10);
		expect(t).toContain(0);
	});
	it('thins labels', () => {
		expect(labelIndexes(52, 520, 40).size).toBeLessThanOrEqual(13);
		expect(labelIndexes(4, 520, 40).size).toBe(4);
		expect(labelIndexes(0, 100, 40).size).toBe(0);
	});
	it('hour ticks are multiples of an hour', () => {
		expect(hourTicks(0, 7200 * 20).every((s) => s % 3600 === 0)).toBe(true);
	});
});
