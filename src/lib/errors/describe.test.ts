import { describe, expect, it } from 'vitest';
import { describeError, newErrorId } from './describe.js';

describe('describeError', () => {
	it('maps statuses to kinds', () => {
		expect(describeError(404).kind).toBe('not_found');
		expect(describeError(403).kind).toBe('forbidden');
		expect(describeError(401).kind).toBe('unauthorized');
		expect(describeError(500).kind).toBe('server');
		expect(describeError(503).kind).toBe('server');
		expect(describeError(400).kind).toBe('unexpected');
	});
	it('prefers the offline view for retryable errors while offline, but keeps 404 and 403', () => {
		expect(describeError(500, false).kind).toBe('offline');
		expect(describeError(404, false).kind).toBe('not_found');
		expect(describeError(403, false).kind).toBe('forbidden');
	});
});

describe('newErrorId', () => {
	it('returns 8 uppercase hex characters', () => {
		expect(newErrorId()).toMatch(/^[0-9A-F]{8}$/);
		expect(newErrorId(() => 0)).toBe('00000000');
	});
});
