import { describe, expect, it } from 'vitest';
import { countWorkingDays, datesBetween, fitRanges, freeDaysInSpan, freeReason, mergeIntoRanges } from './days';

const holiday = (startDate: string, endDate = startDate) => ({ startDate, endDate, kind: 'holiday' as const });
const model = (extra: Partial<{ workdays: number[]; dailyTargetSeconds: Record<string, number>; validFrom: string; validTo: string | null }> = {}) => ({
	validFrom: '2026-01-01',
	validTo: null,
	workdays: [1, 2, 3, 4, 5],
	...extra
});

describe('datesBetween', () => {
	it('is inclusive and empty for a reversed span', () => {
		expect(datesBetween('2026-07-30', '2026-08-02')).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
		expect(datesBetween('2026-08-02', '2026-07-30')).toEqual([]);
	});
});

describe('freeReason', () => {
	it('reports weekends, holidays and days the model leaves free', () => {
		const models = [model({ workdays: [1, 2, 3, 4], dailyTargetSeconds: { '2': 0 } })];
		expect(freeReason('2026-07-04', models, [])).toBe('weekend'); // Saturday
		expect(freeReason('2026-07-03', models, [])).toBe('non_working'); // Friday not a workday
		expect(freeReason('2026-07-07', models, [])).toBe('non_working'); // Tuesday with target 0
		expect(freeReason('2026-07-08', models, [holiday('2026-07-08')])).toBe('holiday');
		expect(freeReason('2026-07-08', models, [])).toBeNull();
	});
	it('ignores school holidays and falls back to Monday to Friday without a model', () => {
		expect(freeReason('2026-07-08', [], [{ startDate: '2026-07-01', endDate: '2026-08-31', kind: 'school_holiday' }])).toBeNull();
		expect(freeReason('2026-07-05', [], [])).toBe('weekend');
	});
	it('uses the model valid on the date', () => {
		const models = [model({ validTo: '2026-06-30' }), model({ validFrom: '2026-07-01', workdays: [1, 2, 3] })];
		expect(freeReason('2026-06-26', models, [])).toBeNull(); // Friday, old model
		expect(freeReason('2026-07-03', models, [])).toBe('non_working'); // Friday, new model
	});
});

describe('mergeIntoRanges', () => {
	it('merges consecutive days across month and year borders and sorts input', () => {
		expect(mergeIntoRanges(['2026-12-31', '2027-01-01', '2026-12-26', '2026-12-27', '2026-12-27'])).toEqual([
			{ from: '2026-12-26', to: '2026-12-27' },
			{ from: '2026-12-31', to: '2027-01-01' }
		]);
	});
	it('returns nothing for nothing', () => {
		expect(mergeIntoRanges([])).toEqual([]);
	});
});

describe('free days in a request span', () => {
	it('merges weekend plus holiday into one range and keeps separate weekends apart', () => {
		// Mon 2026-07-06 .. Fri 2026-07-17; Friday 10th is a holiday -> Fri 10 + Sat 11 + Sun 12 merge
		const free = freeDaysInSpan('2026-07-06', '2026-07-17', [model()], [holiday('2026-07-10')]);
		expect(mergeIntoRanges(free)).toEqual([{ from: '2026-07-10', to: '2026-07-12' }]);
	});
	it('lists weekend ranges inside a two-week span', () => {
		const free = freeDaysInSpan('2026-07-06', '2026-07-19', [model()], []);
		expect(mergeIntoRanges(free)).toEqual([
			{ from: '2026-07-11', to: '2026-07-12' },
			{ from: '2026-07-18', to: '2026-07-19' }
		]);
	});
});

describe('countWorkingDays', () => {
	it('counts Monday to Friday without holidays', () => {
		expect(countWorkingDays('2026-07-06', '2026-07-17', [model()], [])).toBe(10);
	});
	it('excludes public holidays and work-model free days', () => {
		expect(countWorkingDays('2026-07-06', '2026-07-17', [model()], [holiday('2026-07-08')])).toBe(9);
		expect(countWorkingDays('2026-07-06', '2026-07-17', [model({ workdays: [1, 2, 3, 4] })], [])).toBe(8);
	});
	it('removes half a day for half-day start/end on working days only', () => {
		expect(countWorkingDays('2026-07-06', '2026-07-10', [model()], [], true, false)).toBe(4.5);
		expect(countWorkingDays('2026-07-06', '2026-07-10', [model()], [], true, true)).toBe(4);
		expect(countWorkingDays('2026-07-06', '2026-07-06', [model()], [], true, true)).toBe(0.5);
		expect(countWorkingDays('2026-07-04', '2026-07-08', [model()], [], true, false)).toBe(3); // start on Saturday: nothing to halve
	});
});

describe('fitRanges', () => {
	it('reports the overflow instead of dropping it silently', () => {
		const ranges = [1, 2, 3].map((n) => ({ from: `2026-07-0${n}`, to: `2026-07-0${n}` }));
		expect(fitRanges(ranges, 2)).toEqual({ shown: ranges.slice(0, 2), overflow: ranges.slice(2) });
	});
});
