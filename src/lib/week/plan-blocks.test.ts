import { describe, expect, it } from 'vitest';
import { blocksText, blocksTimesText, gapMinutes, listsBlocks } from './plan-blocks.js';

const b = (start: string, end: string, kind: 'work' | 'school' | 'travel' | 'office' | 'home' | 'customer' = 'work') => ({ start, end, kind });

describe('plan block texts', () => {
	it('names every block with kind and times in time order', () => {
		expect(blocksText([b('13:00', '17:00'), b('08:00', '12:00', 'school')])).toBe('Schule 08:00–12:00, Arbeit 13:00–17:00');
		expect(blocksTimesText([b('13:00', '17:00'), b('08:00', '12:00')])).toBe('08:00–12:00, 13:00–17:00');
	});
	it('sums the gaps between blocks', () => {
		expect(gapMinutes([b('08:00', '12:00'), b('12:30', '16:00'), b('16:00', '17:00')])).toBe(30);
		expect(gapMinutes([b('08:00', '12:00')])).toBe(0);
	});
	it('lists blocks only when they carry more than a window with a break', () => {
		expect(listsBlocks(null)).toBe(false);
		expect(listsBlocks([b('08:00', '16:00')])).toBe(false);
		expect(listsBlocks([b('08:00', '12:00', 'office'), b('12:30', '16:00', 'office')])).toBe(false);
		expect(listsBlocks([b('08:00', '12:00', 'school'), b('13:00', '16:00', 'work')])).toBe(true);
		expect(listsBlocks([b('08:00', '10:00'), b('11:00', '12:00'), b('13:00', '16:00')])).toBe(true);
	});
});
