import { describe, expect, it } from 'vitest';
import { durationInputValue, parseReportDuration } from './duration';
import { formatWeekText, singleLine } from './text';
import { compareWeeks, isoWeekOf, isoWeeksInYear, isValidIsoWeek, shiftWeek, weekDates, weekStartDate } from './weeks';

describe('parseReportDuration', () => {
	it('reads h:mm', () => {
		expect(parseReportDuration('1:30')).toEqual({ seconds: 5400, kind: 'clock' });
		expect(parseReportDuration('01:05')).toEqual({ seconds: 3900, kind: 'clock' });
		expect(parseReportDuration(' 0:45 ')).toEqual({ seconds: 2700, kind: 'clock' });
		expect(parseReportDuration('24:00')).toEqual({ seconds: 86400, kind: 'clock' });
	});

	it('reads decimal hours with comma or dot and rounds to whole minutes', () => {
		expect(parseReportDuration('1,5')).toEqual({ seconds: 5400, kind: 'decimal' });
		expect(parseReportDuration('1.5')).toEqual({ seconds: 5400, kind: 'decimal' });
		expect(parseReportDuration(',5')).toEqual({ seconds: 1800, kind: 'decimal' });
		expect(parseReportDuration('0,25')).toEqual({ seconds: 900, kind: 'decimal' });
		// 7,7 h is 7:42, not 7:07
		expect(parseReportDuration('7,7')?.seconds).toBe(7 * 3600 + 42 * 60);
		// 1,33 h = 79.8 min -> 80 min
		expect(parseReportDuration('1,33')?.seconds).toBe(80 * 60);
	});

	it('reads whole hours and treats empty as zero', () => {
		expect(parseReportDuration('2')).toEqual({ seconds: 7200, kind: 'hours' });
		expect(parseReportDuration('')).toEqual({ seconds: 0, kind: 'empty' });
		expect(parseReportDuration('   ')).toEqual({ seconds: 0, kind: 'empty' });
	});

	it('rejects invalid input and more than 24 hours', () => {
		for (const bad of ['abc', '1:75', '1:5', '1,', '-1', '1:30:00', '25', '24:01', '24,5', '1,234', '1 5', ',']) {
			expect(parseReportDuration(bad), bad).toBeNull();
		}
	});

	it('formats the edit value as h:mm', () => {
		expect(durationInputValue(5400)).toBe('1:30');
		expect(durationInputValue(0)).toBe('');
		expect(durationInputValue(undefined)).toBe('');
		expect(parseReportDuration(durationInputValue(27720))?.seconds).toBe(27720);
	});
});

describe('ISO weeks', () => {
	it('derives year and week around the year border', () => {
		expect(isoWeekOf('2026-10-14')).toEqual({ year: 2026, week: 42 });
		expect(isoWeekOf('2024-12-30')).toEqual({ year: 2025, week: 1 });
		expect(isoWeekOf('2021-01-03')).toEqual({ year: 2020, week: 53 });
		expect(isoWeekOf('2021-01-04')).toEqual({ year: 2021, week: 1 });
		expect(isoWeekOf('2026-12-31')).toEqual({ year: 2026, week: 53 });
		expect(isoWeekOf('2027-01-03')).toEqual({ year: 2026, week: 53 });
		expect(isoWeekOf('2027-01-04')).toEqual({ year: 2027, week: 1 });
		expect(isoWeekOf('2026-01-01')).toEqual({ year: 2026, week: 1 });
	});

	it('knows which years have 53 weeks (Jan 1 on Thursday, or Wednesday in leap years)', () => {
		for (const year of [2004, 2009, 2015, 2020, 2026, 2032]) expect(isoWeeksInYear(year), String(year)).toBe(53);
		for (const year of [2021, 2022, 2023, 2024, 2025, 2027, 2028]) expect(isoWeeksInYear(year), String(year)).toBe(52);
	});

	it('validates year and week', () => {
		expect(isValidIsoWeek(2026, 53)).toBe(true);
		expect(isValidIsoWeek(2027, 53)).toBe(false);
		expect(isValidIsoWeek(2026, 0)).toBe(false);
		expect(isValidIsoWeek(2026, 1.5)).toBe(false);
		expect(isValidIsoWeek(99, 1)).toBe(false);
	});

	it('finds Monday and the seven days', () => {
		expect(weekStartDate(2026, 42)).toBe('2026-10-12');
		expect(weekStartDate(2026, 1)).toBe('2025-12-29');
		expect(weekStartDate(2026, 53)).toBe('2026-12-28');
		expect(weekDates(2026, 53)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
	});

	it('moves across year borders and through week 53', () => {
		expect(shiftWeek({ year: 2026, week: 52 }, 1)).toEqual({ year: 2026, week: 53 });
		expect(shiftWeek({ year: 2026, week: 53 }, 1)).toEqual({ year: 2027, week: 1 });
		expect(shiftWeek({ year: 2027, week: 1 }, -1)).toEqual({ year: 2026, week: 53 });
		expect(shiftWeek({ year: 2025, week: 52 }, 1)).toEqual({ year: 2026, week: 1 });
		expect(shiftWeek({ year: 2026, week: 42 }, 0)).toEqual({ year: 2026, week: 42 });
		expect(compareWeeks({ year: 2026, week: 53 }, { year: 2027, week: 1 })).toBeLessThan(0);
	});
});

describe('formatWeekText (ADR-0008 standard format)', () => {
	it('matches the golden output', () => {
		const text = formatWeekText({ year: 2026, week: 42 }, [
			{ date: '2026-10-13', learningField: 'Lernfeld 4 Netzwerke', durationSeconds: 3600, notes: 'Subnetze\nberechnet' },
			{ date: '2026-10-12', learningField: 'Lernfeld 1 Betrieb', durationSeconds: 9000, notes: 'Einführung ins Ticketsystem' },
			{ date: '2026-10-12', learningField: 'Freitext', durationSeconds: 1800, notes: '' }
		]);
		expect(text).toBe(
			[
				'Berichtsheft KW 42/2026 (12.10.2026 – 18.10.2026)',
				'',
				'Montag, 12.10.2026',
				'Lernfeld 1 Betrieb | 2:30 h | Einführung ins Ticketsystem',
				'Freitext | 0:30 h',
				'',
				'Dienstag, 13.10.2026',
				'Lernfeld 4 Netzwerke | 1:00 h | Subnetze / berechnet',
				'',
				'Summe: 4:00 h',
				''
			].join('\n')
		);
	});

	it('single-lines notes like the server and omits an empty note part', () => {
		const text = formatWeekText({ year: 2026, week: 42 }, [{ date: '2026-10-12', learningField: 'A\nB', durationSeconds: 3659, notes: ' eins \r\n\r\n zwei\u2028drei\n' }]);
		expect(text).toContain('A / B | 1:00 h | eins / zwei / drei\n');
		expect(singleLine('  \n ')).toBe('');
	});

	it('produces only the header and a zero total for an empty week', () => {
		expect(formatWeekText({ year: 2026, week: 53 }, [])).toBe('Berichtsheft KW 53/2026 (28.12.2026 – 03.01.2027)\n\nSumme: 0:00 h\n');
	});

	it('includes days that fall into the next calendar year in week 53', () => {
		const text = formatWeekText({ year: 2026, week: 53 }, [{ date: '2027-01-01', learningField: 'X', durationSeconds: 60, notes: 'a' }]);
		expect(text).toContain('Freitag, 01.01.2027\nX | 0:01 h | a');
	});
});
