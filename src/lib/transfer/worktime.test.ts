import { describe, expect, it } from 'vitest';
import {
	DEFAULT_WORKTIME_RULES,
	evaluateWorktime,
	exactRuleFor,
	isWarning,
	moveRule,
	normalizeRemark,
	removeRule,
	resolveRemark,
	ruleIssues,
	ruleMatches,
	splitAroundPause,
	type WorktimeContext,
	type WorktimeDayRow
} from './worktime';

const ctx = (extra: Partial<WorktimeContext> = {}): WorktimeContext => ({
	today: '2026-10-14',
	holidays: new Set(),
	customHolidays: new Set(),
	existingSegments: [],
	existingAbsences: [],
	tablePauseMinutes: 30,
	planningEnabled: true,
	dateSystem: '1900',
	...extra
});
const h = (hours: number, minutes = 0, seconds = 0) => hours * 3600 + minutes * 60 + seconds;
const row = (date: string, start: number | null, end: number | null, remark = '', n = 1, sheet = '2026'): WorktimeDayRow => ({ date, sheet, row: n, start, end, remark });

describe('remark rules', () => {
	it('normalizes whitespace including NBSP and ignores case', () => {
		expect(normalizeRemark('  Urlaub   (Freigestellt) ')).toBe('Urlaub (Freigestellt)');
		expect(ruleMatches({ pattern: 'URLAUB', action: 'vacation' }, 'ein  Urlaubstag')).toBe(true);
		expect(ruleMatches({ pattern: '^bs$', action: 'school' }, ' BS ')).toBe(true);
		expect(ruleMatches({ pattern: '^bs$', action: 'school' }, 'BSX')).toBe(false);
		expect(ruleMatches({ pattern: 'x', action: 'skip' }, '')).toBe(false);
	});

	it('first match wins; excused is listed before vacation; unmatched is work', () => {
		expect(resolveRemark(DEFAULT_WORKTIME_RULES, 'Urlaub (Freigestellt)').action).toBe('excused');
		expect(resolveRemark(DEFAULT_WORKTIME_RULES, 'Urlaub').action).toBe('vacation');
		expect(resolveRemark(DEFAULT_WORKTIME_RULES, 'Krank / Urlaub').action).toBe('sick');
		expect(resolveRemark(DEFAULT_WORKTIME_RULES, 'Berufsschule').action).toBe('school');
		expect(resolveRemark(DEFAULT_WORKTIME_RULES, 'BS').action).toBe('school');
		expect(resolveRemark(DEFAULT_WORKTIME_RULES, 'Arzttermin')).toEqual({ action: 'work', rule: null });
		expect(resolveRemark(DEFAULT_WORKTIME_RULES, '')).toEqual({ action: 'work', rule: null });
	});

	it('validates, reorders and removes rules', () => {
		const rules = [
			{ pattern: 'a', action: 'work' as const },
			{ pattern: ' ', action: 'skip' as const },
			{ pattern: 'A', action: 'sick' as const },
			{ pattern: '^$', action: 'skip' as const },
			{ pattern: 'x'.repeat(81), action: 'skip' as const }
		];
		expect(ruleIssues(rules).map((i) => `${i.index}:${i.issue}`)).toEqual(['1:pattern_empty', '2:duplicate_pattern', '3:pattern_exact_empty', '4:pattern_too_long']);
		expect(ruleIssues(DEFAULT_WORKTIME_RULES)).toEqual([]);
		expect(moveRule(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
		expect(moveRule(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
		expect(removeRule(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
		expect(exactRuleFor('  Arzt  Termin ', 'skip')).toEqual({ pattern: '^arzt termin$', action: 'skip' });
	});
});

describe('pause split', () => {
	it('splits at the configured start, in the middle when it does not fit, and keeps short days whole', () => {
		expect(splitAroundPause(h(8), h(16, 12), h(0, 30), h(12))).toEqual([[h(8), h(12)], [h(12, 30), h(16, 12)]]);
		expect(splitAroundPause(h(13), h(17), h(0, 30), h(12))).toEqual([[h(13), h(14, 45)], [h(15, 15), h(17)]]);
		expect(splitAroundPause(h(9), h(9, 20), h(0, 30), h(12))).toEqual([[h(9), h(9, 20)]]);
		expect(splitAroundPause(h(8), h(12), 0, h(12))).toEqual([[h(8), h(12)]]);
	});
});

describe('evaluateWorktime', () => {
	it('rounds seconds noise to whole minutes by default and keeps the duration (end - start - pause)', () => {
		const out = evaluateWorktime([row('2026-03-02', h(8, 0, 20), h(16, 11, 40))], {}, ctx());
		const total = out.segments.reduce((sum, s) => sum + (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000, 0);
		expect(total).toBe(h(7, 42));
		const exact = evaluateWorktime([row('2026-03-02', h(8, 0, 20), h(16, 11, 40))], { roundToMinutes: false, pauseMode: 'none' }, ctx());
		expect(Date.parse(exact.segments[0].startedAt) % 60_000).toBe(20_000);
	});

	it('merges absences over weekends and holidays but not over a workday gap or another kind', () => {
		const rows = [
			row('2026-03-05', h(8), h(16, 12), 'Urlaub', 1),
			row('2026-03-06', h(8), h(16, 12), 'Urlaub', 2),
			row('2026-03-09', h(8), h(16, 12), 'Urlaub', 3),
			row('2026-03-11', h(8), h(16, 12), 'Urlaub', 4),
			row('2026-03-12', h(8), h(16, 12), 'Krank', 5)
		];
		const out = evaluateWorktime(rows, {}, ctx());
		expect(out.absences.map((a) => [a.kind, a.startDate, a.endDate])).toEqual([
			['vacation', '2026-03-05', '2026-03-09'],
			['vacation', '2026-03-11', '2026-03-11'],
			['sick', '2026-03-12', '2026-03-12']
		]);
		const bridged = evaluateWorktime([row('2026-03-09', h(8), h(16), 'Urlaub'), row('2026-03-11', h(8), h(16), 'Urlaub')], {}, ctx({ holidays: new Set(['2026-03-10']) }));
		expect(bridged.absences).toHaveLength(1);
		expect(out.segments).toHaveLength(0);
	});

	it('uses taken for past and approved for current or future absences', () => {
		const out = evaluateWorktime([row('2026-10-13', null, null, 'Urlaub'), row('2026-10-20', null, null, 'Krank')], {}, ctx());
		expect(out.absences.map((a) => a.status)).toEqual(['taken', 'approved']);
	});

	it('handles holidays: built-in skipped, others become custom holidays, existing ones duplicates', () => {
		const rows = [row('2026-04-03', h(8), h(16), 'Feiertag', 1), row('2026-05-04', h(8), h(16), 'Feiertag Firmenfest', 2), row('2026-05-05', null, null, 'feiertag firmenfest 2', 3)];
		const out = evaluateWorktime(rows, {}, ctx({ holidays: new Set(['2026-04-03']), customHolidays: new Set(['2026-05-05']) }));
		expect(out.preview.worktime).toMatchObject({ skippedHolidays: 1, customDays: 1 });
		expect(out.customDays).toEqual([{ row: 2, date: '2026-05-04', name: 'Feiertag Firmenfest' }]);
		expect(out.preview.duplicates).toBe(1);
	});

	it('reports conflicting duplicates across sheets, merges identical ones and ignores date-only repeats', () => {
		const rows = [
			row('2026-12-31', h(8), h(12), '', 10, '2026'),
			row('2026-12-31', h(8), h(12), '', 4, '2027'),
			row('2027-01-01', h(8), h(12), '', 11, '2026'),
			row('2027-01-01', h(9), h(12), '', 5, '2027'),
			row('2027-01-02', null, null, '', 12, '2026'),
			row('2027-01-02', null, null, '', 6, '2027')
		];
		const out = evaluateWorktime(rows, { pauseMode: 'none' }, ctx());
		expect(out.preview.errors).toEqual([{ row: 5, code: 'duplicate_date_conflict' }]);
		expect(out.segments.map((s) => s.date)).toEqual(['2026-12-31']);
	});

	it('flags errors per row: end before start, missing end, pause longer than the day (warning), overlap, planning off', () => {
		const rows = [
			row('2026-03-02', h(9), h(8), '', 1),
			row('2026-03-03', h(9), null, '', 2),
			row('2026-03-04', h(9), h(9, 20), '', 3),
			row('2026-03-05', h(9), h(10), '', 4),
			row('2026-03-06', null, null, 'Krank', 5)
		];
		const existing = [{ startedAt: '2026-03-05T08:30:00Z', endedAt: '2026-03-05T09:30:00Z', kind: 'work' as const }];
		const out = evaluateWorktime(rows, {}, ctx({ existingSegments: existing, planningEnabled: false }));
		expect(out.preview.errors.map((e) => `${e.row}:${e.code}`)).toEqual(['1:end_before_start', '2:missing_value', '3:pause_exceeds_day', '4:overlap', '5:planning_disabled']);
		expect(isWarning('pause_exceeds_day')).toBe(true);
		expect(isWarning('overlap')).toBe(false);
		expect(out.segments).toHaveLength(1);
	});

	it('lists unmapped remark texts with counts and honours user rules', () => {
		const rows = [row('2026-03-02', h(8), h(12), 'Arzttermin', 1), row('2026-03-03', h(8), h(12), ' arzttermin ', 2), row('2026-03-04', h(8), h(12), 'Messe', 3)];
		const out = evaluateWorktime(rows, { pauseMode: 'none' }, ctx());
		expect(out.preview.worktime!.unmappedRemarks).toEqual([
			{ text: 'Arzttermin', count: 2 },
			{ text: 'Messe', count: 1 }
		]);
		const ruled = evaluateWorktime(rows, { pauseMode: 'none', rules: [exactRuleFor('Arzttermin', 'work'), ...DEFAULT_WORKTIME_RULES] }, ctx());
		expect(ruled.preview.worktime!.unmappedRemarks).toEqual([{ text: 'Messe', count: 1 }]);
	});
});
