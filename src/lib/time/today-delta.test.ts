import { describe, expect, it } from 'vitest';
import { todayDeltaNote } from './today-delta.js';

describe('todayDeltaNote (contract 0.36.0)', () => {
	it('shows the running day separately and says it flows in tomorrow', () => {
		expect(todayDeltaNote({ includesToday: false, todayDeltaSeconds: 42 * 60 })).toBe('Heute: +0:42, fließt morgen ein');
		expect(todayDeltaNote({ includesToday: false, todayDeltaSeconds: -90 * 60 })).toBe('Heute: -1:30, fließt morgen ein');
		expect(todayDeltaNote({ includesToday: false, todayDeltaSeconds: 0 })).toBe('Heute: 0:00, fließt morgen ein');
	});

	it('stays silent for older servers, missing values and other dates', () => {
		expect(todayDeltaNote({ todayDeltaSeconds: 600 })).toBeNull();
		expect(todayDeltaNote({ includesToday: true, todayDeltaSeconds: 600 })).toBeNull();
		expect(todayDeltaNote({ includesToday: false, todayDeltaSeconds: null })).toBeNull();
		expect(todayDeltaNote(null)).toBeNull();
	});
});
