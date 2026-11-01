import { describe, expect, it } from 'vitest';
import { compareVersions, supportsPlanBlocks } from './api-version.js';

describe('api version gates', () => {
	it('compares numerically, not as text', () => {
		expect(compareVersions('0.35.0', '0.4.0')).toBe(1);
		expect(compareVersions('0.34.0', '0.35.0')).toBe(-1);
		expect(compareVersions('1.0.0-mock', '1.0.0')).toBe(0);
		expect(compareVersions('garbage', '0.1.0')).toBe(-1);
	});
	it('enables plan blocks from 0.35.0 only', () => {
		expect(supportsPlanBlocks('0.34.0')).toBe(false);
		expect(supportsPlanBlocks('0.35.0')).toBe(true);
		expect(supportsPlanBlocks('0.40.2')).toBe(true);
		expect(supportsPlanBlocks(undefined)).toBe(false);
		expect(supportsPlanBlocks('')).toBe(false);
	});
});
