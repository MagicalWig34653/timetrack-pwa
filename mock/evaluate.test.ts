import { describe, expect, it } from 'vitest';
import { zonedTimeToInstant } from '../src/lib/time/dates.ts';
import type { WorkModel } from '../src/lib/api/types.ts';
import { dailyTarget, evaluateDay, modelForDate, type EvalSegment } from './evaluate.ts';

const model: WorkModel = {
	id: 'm1',
	createdAt: '2026-01-01T00:00:00Z',
	validFrom: '2026-01-01',
	validTo: null,
	timezone: 'Europe/Berlin',
	weeklyTargetSeconds: 38.5 * 3600,
	workdays: [1, 2, 3, 4, 5],
	travelCountsAsWork: true,
	roundingEnabled: true,
	roundingMinutes: 15,
	schoolFullDayThresholdSeconds: 10800,
	schoolCreditSeconds: null,
	dayBoundaryMinutes: 0,
	fixedBreaks: []
};

const at = (date: string, time: string) => zonedTimeToInstant(date, time).getTime();
const seg = (id: string, date: string, from: string, to: string | null, kind: EvalSegment['kind'] = 'work'): EvalSegment => ({
	id,
	kind,
	startedAt: at(date, from),
	endedAt: to ? at(date, to) : null
});
const NOW = at('2026-10-20', '12:00'); // a day after the days under test

describe('daily target', () => {
	it('spreads 38:30 h per week over five workdays as 7:42', () => {
		expect(dailyTarget(model, '2026-10-14')).toBe(27720);
		expect(dailyTarget(model, '2026-10-17')).toBe(0); // Saturday
	});

	it('lets an explicit weekday target win', () => {
		expect(dailyTarget({ ...model, dailyTargetSeconds: { '5': 4 * 3600 } }, '2026-10-16')).toBe(4 * 3600);
	});

	it('selects the model version by validity range', () => {
		const old = { ...model, id: 'old', validTo: '2026-06-30' };
		const next = { ...model, id: 'new', validFrom: '2026-07-01' };
		expect(modelForDate([old, next], '2026-06-30')?.id).toBe('old');
		expect(modelForDate([old, next], '2026-07-01')?.id).toBe('new');
		expect(modelForDate([old], '2026-07-01')).toBeNull();
	});
});

describe('evaluateDay', () => {
	it('matches the ADR example: 08:07-12:00 and 13:00-16:02 -> raw 6:55, +7 min, +13 min -> 7:15', () => {
		const day = evaluateDay({
			date: '2026-10-14',
			models: [model],
			segments: [seg('a', '2026-10-14', '08:07', '12:00'), seg('b', '2026-10-14', '13:00', '16:02')],
			now: NOW
		});
		expect(day.rawWorkSeconds).toBe(6 * 3600 + 55 * 60);
		expect(day.startAdjustSeconds).toBe(7 * 60);
		expect(day.endAdjustSeconds).toBe(13 * 60);
		expect(day.evaluatedWorkSeconds).toBe(7 * 3600 + 15 * 60);
		expect(day.targetSeconds).toBe(27720);
		expect(day.deltaSeconds).toBe(26100 - 27720);
		expect(day.provisional).toBe(false);
		// the 12:00-13:00 gap stays a gap: it is not part of the sum and is not rounded
		expect(new Date(day.evaluatedStart!).getTime()).toBe(at('2026-10-14', '08:00'));
		expect(new Date(day.evaluatedEnd!).getTime()).toBe(at('2026-10-14', '16:15'));
	});

	it('does not round when rounding is off', () => {
		const day = evaluateDay({
			date: '2026-10-14',
			models: [{ ...model, roundingEnabled: false }],
			segments: [seg('a', '2026-10-14', '08:07', '16:02')],
			now: NOW
		});
		expect(day.startAdjustSeconds + day.endAdjustSeconds).toBe(0);
		expect(day.evaluatedWorkSeconds).toBe(7 * 3600 + 55 * 60);
	});

	it('deducts only the part of a fixed break inside work segments, never twice with a real gap', () => {
		const withBreak = { ...model, roundingEnabled: false, fixedBreaks: [{ start: '12:00', end: '12:30' }] };
		const overlapping = evaluateDay({
			date: '2026-10-14',
			models: [withBreak],
			segments: [seg('a', '2026-10-14', '08:00', '16:00')],
			now: NOW
		});
		expect(overlapping.breakDeductionSeconds).toBe(1800);
		expect(overlapping.evaluatedWorkSeconds).toBe(8 * 3600 - 1800);
		const gap = evaluateDay({
			date: '2026-10-14',
			models: [withBreak],
			segments: [seg('a', '2026-10-14', '08:00', '12:00'), seg('b', '2026-10-14', '12:30', '16:00')],
			now: NOW
		});
		expect(gap.breakDeductionSeconds).toBe(0);
		const skipped = evaluateDay({
			date: '2026-10-14',
			models: [withBreak],
			segments: [seg('a', '2026-10-14', '08:00', '16:00')],
			prefs: { skipFixedBreaks: true },
			now: NOW
		});
		expect(skipped.breakDeductionSeconds).toBe(0);
	});

	it('counts travel only when configured', () => {
		const segments = [seg('a', '2026-10-14', '08:00', '12:00'), seg('b', '2026-10-14', '12:00', '13:00', 'travel')];
		const counted = evaluateDay({ date: '2026-10-14', models: [model], segments, now: NOW });
		const ignored = evaluateDay({ date: '2026-10-14', models: [{ ...model, travelCountsAsWork: false }], segments, now: NOW });
		expect(counted.rawWorkSeconds).toBe(5 * 3600);
		expect(ignored.rawWorkSeconds).toBe(4 * 3600);
	});

	it('applies the school rule only above the threshold and never fills up below it', () => {
		const full = evaluateDay({
			date: '2026-10-14',
			models: [model],
			segments: [seg('a', '2026-10-14', '08:00', '11:00', 'school')],
			now: NOW
		});
		expect(full.creditSeconds).toBe(27720);
		expect(full.evaluatedWorkSeconds).toBe(0);
		expect(full.deltaSeconds).toBe(0);
		const partial = evaluateDay({
			date: '2026-10-14',
			models: [model],
			segments: [seg('a', '2026-10-14', '08:00', '10:15', 'school')],
			now: NOW
		});
		expect(partial.creditSeconds).toBe(0);
		expect(partial.rawWorkSeconds).toBe(2 * 3600 + 15 * 60);
		expect(partial.deltaSeconds).toBeLessThan(0);
	});

	it('uses marks: holiday has no target, school_credit credits the school time', () => {
		const holiday = evaluateDay({ date: '2026-10-14', models: [model], segments: [], prefs: { mark: 'holiday' }, now: NOW });
		expect(holiday.targetSeconds).toBe(0);
		expect(holiday.deltaSeconds).toBe(0);
		const school = evaluateDay({ date: '2026-10-14', models: [model], segments: [], prefs: { mark: 'school_credit' }, now: NOW });
		expect(school.creditSeconds).toBe(27720);
		expect(school.deltaSeconds).toBe(0);
	});

	it('marks the running day provisional and counts until now', () => {
		const now = at('2026-10-20', '10:00');
		const day = evaluateDay({ date: '2026-10-20', models: [model], segments: [seg('a', '2026-10-20', '08:00', null)], now });
		expect(day.provisional).toBe(true);
		expect(day.rawWorkSeconds).toBe(2 * 3600);
	});

	it('gives days without a model no target', () => {
		const day = evaluateDay({ date: '2025-01-01', models: [model], segments: [], now: NOW });
		expect(day.modelId).toBeNull();
		expect(day.targetSeconds).toBe(0);
	});

	it('only hints at missing breaks from actual times, without inventing pauses', () => {
		const long = evaluateDay({
			date: '2026-10-14',
			models: [model],
			segments: [seg('a', '2026-10-14', '08:00', '15:00')],
			now: NOW
		});
		expect(long.breakHints.map((h) => h.code)).toEqual(['break_missing_30', 'work_over_6h_without_break']);
		const withBreak = evaluateDay({
			date: '2026-10-14',
			models: [model],
			segments: [seg('a', '2026-10-14', '08:00', '12:00'), seg('b', '2026-10-14', '12:30', '16:00')],
			now: NOW
		});
		expect(withBreak.breakHints).toEqual([]);
		const tiny = evaluateDay({
			date: '2026-10-14',
			models: [model],
			segments: [seg('a', '2026-10-14', '08:00', '12:00'), seg('b', '2026-10-14', '12:10', '16:00')],
			now: NOW
		});
		expect(tiny.breakHints.map((h) => h.code)).toContain('break_part_too_short');
		const nine = evaluateDay({
			date: '2026-10-14',
			models: [model],
			segments: [seg('a', '2026-10-14', '07:00', '12:00'), seg('b', '2026-10-14', '12:35', '17:00')],
			now: NOW
		});
		expect(nine.breakHints.map((h) => h.code)).toEqual(['break_missing_45']);
	});

	it('handles a 23-hour spring day with correct wall-clock rounding', () => {
		const day = evaluateDay({
			date: '2026-03-30',
			models: [model],
			segments: [seg('a', '2026-03-30', '08:07', '16:02')],
			now: NOW
		});
		expect(day.evaluatedWorkSeconds).toBe(8 * 3600 + 15 * 60);
	});
});
