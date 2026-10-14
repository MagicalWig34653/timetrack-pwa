import { describe, expect, it } from 'vitest';
import { formatBytes, fromBytes, MAX_IMPORT_BYTES, toBytes } from './bytes';

describe('bytes', () => {
	it('formats with German decimals', () => {
		expect(formatBytes(12)).toBe('12 B');
		expect(formatBytes(1536)).toBe('1,5 KiB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5 MiB');
		expect(MAX_IMPORT_BYTES).toBe(5242880);
	});
	it('parses amounts with unit, comma or dot', () => {
		expect(toBytes('2', 'MiB')).toBe(2097152);
		expect(toBytes('1,5', 'KiB')).toBe(1536);
		expect(toBytes('100', 'B')).toBe(100);
		expect(toBytes('0', 'MiB')).toBeNull();
		expect(toBytes('', 'B')).toBeNull();
		expect(toBytes('-3', 'B')).toBeNull();
		expect(toBytes('abc', 'KiB')).toBeNull();
	});
	it('picks the largest exact unit', () => {
		expect(fromBytes(10485760)).toEqual({ amount: '10', unit: 'MiB' });
		expect(fromBytes(3072)).toEqual({ amount: '3', unit: 'KiB' });
		expect(fromBytes(1536)).toEqual({ amount: '1536', unit: 'B' });
		expect(fromBytes(1000)).toEqual({ amount: '1000', unit: 'B' });
	});
});
