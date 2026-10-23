import { afterEach, describe, expect, it, vi } from 'vitest';
import { recalledWeek, rememberWeek } from './last-week.js';

afterEach(() => {
	sessionStorage.clear();
	vi.restoreAllMocks();
});

describe('last viewed week', () => {
	it('round-trips a valid week', () => {
		expect(recalledWeek()).toBeNull();
		rememberWeek('2026-W43');
		expect(recalledWeek()).toBe('2026-W43');
	});
	it('ignores invalid labels, stored or given', () => {
		rememberWeek('nonsense');
		expect(recalledWeek()).toBeNull();
		sessionStorage.setItem('timetrack.week.last', 'garbage');
		expect(recalledWeek()).toBeNull();
	});
	it('survives blocked storage', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => rememberWeek('2026-W43')).not.toThrow();
		expect(recalledWeek()).toBeNull();
	});
});
