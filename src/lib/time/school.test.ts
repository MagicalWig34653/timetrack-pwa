import { describe, expect, it } from 'vitest';
import type { Place, PlanDay, Segment, TimeWeekDay } from '#lib/api/types.js';
import {
	dayMarkOptions,
	isSchoolPlan,
	lastSchoolTimes,
	needsSchoolTimes,
	plannedSchoolWithoutBooking,
	planSchoolTimes,
	schoolCheckItems,
	schoolDayDefaults,
	schoolEvaluationText,
	schoolPlace,
	timerPreset,
	workAtSchoolPlace
} from './school.js';

const school: Place = { id: 'p-school', name: 'Berufsschule', kind: 'school', automationMode: 'suggest', archived: false, defaultSegmentKind: 'school' };
const office: Place = { id: 'p-office', name: 'Büro', kind: 'office', automationMode: 'off', archived: false };
const seg = (over: Partial<Segment>): Segment =>
	({ id: 's1', kind: 'school', placeId: school.id, startedAt: '2026-10-26T07:00:00Z', endedAt: '2026-10-26T12:30:00Z', source: 'manual', version: 1, revisions: 0, voided: false, ...over }) as Segment;
const plan = (over: Partial<PlanDay>): PlanDay => ({ date: '2026-10-28', mode: 'office', ...over });
const weekDay = (over: Partial<TimeWeekDay>): TimeWeekDay =>
	({ date: '2026-10-28', weekday: 3, mark: 'work', markSource: 'none', targetSeconds: 27720, plannedSeconds: 19800, planMode: 'school', planBlocks: [{ start: '08:00', end: '13:30', kind: 'school' }], workSeconds: 0, creditSeconds: 0, rawWorkSeconds: 0, breakSeconds: 0, breakDeductionSeconds: 0, travelSeconds: 0, schoolSeconds: 0, balanceSeconds: -27720, firstStart: null, lastEnd: null, segmentsCount: 0, absences: [], provisional: false, isToday: false, isFuture: false, ...over }) as TimeWeekDay;

describe('school plan', () => {
	it('detects a school plan by mode or by a school block', () => {
		expect(isSchoolPlan(plan({ mode: 'school' }))).toBe(true);
		expect(isSchoolPlan(plan({ mode: 'office', blocks: [{ start: '08:00', end: '12:00', kind: 'school' }] }))).toBe(true);
		expect(isSchoolPlan(plan({ mode: 'office', blocks: [{ start: '08:00', end: '12:00', kind: 'work' }] }))).toBe(false);
		expect(isSchoolPlan(null)).toBe(false);
	});

	it('takes the times of the school blocks, else the planned window of a school plan', () => {
		expect(planSchoolTimes(plan({ mode: 'office', blocks: [{ start: '13:00', end: '16:00', kind: 'work' }, { start: '08:00', end: '09:30', kind: 'school' }, { start: '10:00', end: '12:15', kind: 'school' }] }))).toEqual({ start: '08:00', end: '12:15' });
		expect(planSchoolTimes(plan({ mode: 'school', plannedStart: '07:45', plannedEnd: '13:00' }))).toEqual({ start: '07:45', end: '13:00' });
		expect(planSchoolTimes(plan({ mode: 'school' }))).toBeNull();
		expect(planSchoolTimes(plan({ mode: 'office', plannedStart: '08:00', plannedEnd: '16:00' }))).toBeNull();
	});
});

describe('last school day', () => {
	it('returns the first start and last end of the latest school day before the date (Berlin wall clock)', () => {
		const segments = [
			seg({ id: 'a', startedAt: '2026-10-19T06:30:00Z', endedAt: '2026-10-19T11:00:00Z' }),
			seg({ id: 'b', startedAt: '2026-10-21T06:15:00Z', endedAt: '2026-10-21T09:00:00Z' }),
			seg({ id: 'c', startedAt: '2026-10-21T09:30:00Z', endedAt: '2026-10-21T12:45:00Z' }),
			seg({ id: 'w', kind: 'work', startedAt: '2026-10-22T06:00:00Z', endedAt: '2026-10-22T14:00:00Z' }),
			seg({ id: 'v', voided: true, startedAt: '2026-10-22T06:00:00Z', endedAt: '2026-10-22T14:00:00Z' })
		];
		expect(lastSchoolTimes(segments, '2026-10-23', 'Europe/Berlin')).toEqual({ date: '2026-10-21', start: '08:15', end: '14:45' });
		// not the day itself and nothing later
		expect(lastSchoolTimes(segments, '2026-10-21', 'Europe/Berlin')).toEqual({ date: '2026-10-19', start: '08:30', end: '13:00' });
		// backfilling a day before every school day: the nearest later school day
		expect(lastSchoolTimes(segments, '2026-10-19', 'Europe/Berlin')).toEqual({ date: '2026-10-21', start: '08:15', end: '14:45' });
		expect(lastSchoolTimes(segments.filter((s) => s.id === 'a'), '2026-10-19', 'Europe/Berlin')).toBeNull();
		// a running school segment has no end and is ignored
		expect(lastSchoolTimes([seg({ endedAt: null })], '2026-10-30', 'Europe/Berlin')).toBeNull();
	});

	it('prefers the plan, then the last school day, else leaves the times open', () => {
		const last = { date: '2026-10-21', start: '08:15', end: '14:45' };
		expect(schoolDayDefaults(plan({ mode: 'school', plannedStart: '08:00', plannedEnd: '13:30' }), last)).toEqual({ start: '08:00', end: '13:30', source: 'plan' });
		expect(schoolDayDefaults(null, last)).toEqual({ start: '08:15', end: '14:45', source: 'last' });
		expect(schoolDayDefaults(plan({ mode: 'office' }), null)).toEqual({ start: '', end: '', source: 'none' });
	});

	it('finds the school place, skipping archived ones', () => {
		expect(schoolPlace([office, school])).toBe(school);
		expect(schoolPlace([office, { ...school, archived: true }])).toBeNull();
	});
});

describe('day mark choice', () => {
	it('no longer offers "Schultag (Gutschrift)" for new marks', () => {
		expect(dayMarkOptions('none')).toEqual(['none', 'holiday', 'vacation', 'sick', 'excused']);
		expect(dayMarkOptions('vacation')).not.toContain('school_credit');
	});

	it('keeps it on a day that already carries it, so the stored mark stays valid and visible', () => {
		expect(dayMarkOptions('school_credit')).toContain('school_credit');
	});

	it('asks for times on a school-credit day without school segments', () => {
		expect(needsSchoolTimes('school_credit', [])).toBe(true);
		expect(needsSchoolTimes('school_credit', [seg({ voided: true })])).toBe(true);
		expect(needsSchoolTimes('school_credit', [seg({})])).toBe(false);
		expect(needsSchoolTimes('none', [])).toBe(false);
	});
});

describe('evaluation text', () => {
	it('says how recorded school time is credited on a full school day', () => {
		expect(schoolEvaluationText({ mark: 'none', creditSeconds: 27720 }, [seg({})])).toBe('Schule erfasst 5:30 → voller Schultag, angerechnet 7:42');
	});

	it('says that school time below the threshold counts as it is', () => {
		expect(schoolEvaluationText({ mark: 'none', creditSeconds: 0 }, [seg({ endedAt: '2026-10-26T09:00:00Z' })])).toBe('Schule erfasst 2:00 → kein voller Schultag, zählt 2:00');
	});

	it('stays silent without school segments', () => {
		expect(schoolEvaluationText({ mark: 'none', creditSeconds: 0 }, [seg({ kind: 'work' })])).toBeNull();
		expect(schoolEvaluationText({ mark: 'none', creditSeconds: 0 }, [seg({ voided: true })])).toBeNull();
	});
});

describe('week hint', () => {
	it('flags a past or current day planned as school without school time', () => {
		expect(plannedSchoolWithoutBooking(weekDay({}))).toBe(true);
		expect(plannedSchoolWithoutBooking(weekDay({ isToday: true }))).toBe(true);
		expect(plannedSchoolWithoutBooking(weekDay({ planMode: 'office', planBlocks: [{ start: '08:00', end: '13:30', kind: 'school' }] }))).toBe(true);
	});

	it('stays quiet for future days, booked school, a school-credit mark, absences and other plans', () => {
		expect(plannedSchoolWithoutBooking(weekDay({ isFuture: true }))).toBe(false);
		expect(plannedSchoolWithoutBooking(weekDay({ schoolSeconds: 19800 }))).toBe(false);
		expect(plannedSchoolWithoutBooking(weekDay({ mark: 'school' }))).toBe(false);
		expect(plannedSchoolWithoutBooking(weekDay({ mark: 'vacation' }))).toBe(false);
		expect(plannedSchoolWithoutBooking(weekDay({ planMode: 'office', planBlocks: [{ start: '08:00', end: '16:00', kind: 'work' }] }))).toBe(false);
	});
});

describe('timer', () => {
	it('follows a school plan for today: kind school at the school place', () => {
		expect(timerPreset(plan({ mode: 'school' }), [office, school])).toEqual({ kind: 'school', placeId: school.id });
		expect(timerPreset(plan({ mode: 'school' }), [office])).toEqual({ kind: 'school', placeId: '' });
		expect(timerPreset(plan({ mode: 'office' }), [office, school])).toBeNull();
		expect(timerPreset(null, [school])).toBeNull();
	});

	it('flags work at a place of kind school', () => {
		expect(workAtSchoolPlace('work', school)).toBe(true);
		expect(workAtSchoolPlace('school', school)).toBe(false);
		expect(workAtSchoolPlace('work', office)).toBe(false);
		expect(workAtSchoolPlace('work', undefined)).toBe(false);
	});
});

describe('school check list', () => {
	it('lists planned-but-unbooked days, work at the school place and school-credit days without times', () => {
		const days = [
			weekDay({ date: '2026-10-27', mark: 'school', planMode: null, planBlocks: null, plannedSeconds: null, creditSeconds: 27720 }),
			weekDay({ date: '2026-10-28' }),
			weekDay({ date: '2026-10-29', planMode: null, planBlocks: null, plannedSeconds: null, segmentsCount: 1, workSeconds: 19800 }),
			weekDay({ date: '2026-10-30', isFuture: true })
		];
		const marks = { '2026-10-27': 'school_credit' } as const;
		const segments = [seg({ id: 'd', kind: 'work', startedAt: '2026-10-29T07:00:00Z', endedAt: '2026-10-29T12:30:00Z' }), seg({ id: 'o', kind: 'work', placeId: office.id, startedAt: '2026-10-29T13:00:00Z', endedAt: '2026-10-29T14:00:00Z' })];
		const items = schoolCheckItems(days, marks, segments, [office, school], 'Europe/Berlin');
		expect(items.map((i) => [i.date, i.type, i.segmentId ?? null])).toEqual([
			['2026-10-29', 'work_at_school', 'd'],
			['2026-10-28', 'planned_not_booked', null],
			['2026-10-27', 'credit_without_times', null]
		]);
	});
});
