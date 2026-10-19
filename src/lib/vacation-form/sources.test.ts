import { describe, expect, it } from 'vitest';
import { de } from '../i18n/de';
import { formatDaysDe, formatFormDate } from './format';
import { emptyMapping } from './mapping';
import { MAX_FREE_RANGES, SOURCES, resolveBinding, sourcesFor } from './sources';
import type { FormMapping, RequestData } from './types';

const request: RequestData = {
	from: '2026-07-06',
	to: '2026-07-17',
	today: '2026-06-01',
	substitute: ' Erika Muster ',
	entitlementYearHalfDays: 60,
	entitlementTotalHalfDays: 70,
	carryOverHalfDays: 8,
	adjustmentHalfDays: 2,
	restBeforeHalfDays: 45,
	restAfterHalfDays: 25,
	workingDays: 10,
	freeRanges: [
		{ from: '2026-07-11', to: '2026-07-12' },
		{ from: '2026-07-18', to: '2026-07-18' }
	]
};
const mapping: FormMapping = { ...emptyMapping(), person: { lastName: 'Muster', firstName: 'Max', personnelNo: '4711', department: 'Technik', place: 'Magdeburg' } };
const value = (binding: Parameters<typeof resolveBinding>[0], m = mapping) => resolveBinding(binding, m, request);

describe('date and number formats', () => {
	it('formats the three date styles', () => {
		expect(formatFormDate('2026-07-06', 'dd.MM.yyyy')).toBe('06.07.2026');
		expect(formatFormDate('2026-07-06', 'd.M.yy')).toBe('6.7.26');
		expect(formatFormDate('2026-07-06', 'iso')).toBe('2026-07-06');
		expect(formatFormDate('garbage', 'iso')).toBe('garbage');
	});
	it('uses German decimals in half-day steps', () => {
		expect(formatDaysDe(30)).toBe('30');
		expect(formatDaysDe(4.5)).toBe('4,5');
		expect(formatDaysDe(4.4)).toBe('4,5');
	});
});

describe('source catalogue', () => {
	it('has unique ids, a German label for each and valid targets', () => {
		expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
		for (const source of SOURCES) {
			expect(de[source.label], source.id).toBeTruthy();
			expect(source.targets.length).toBeGreaterThan(0);
		}
	});
	it('offers checkbox sources only for checkboxes and text sources never for checkboxes', () => {
		expect(sourcesFor('checkbox').map((s) => s.id).sort()).toEqual(['fixedCheckbox', 'hasFreeDays']);
		expect(sourcesFor('text').some((s) => s.id === 'fixedCheckbox')).toBe(false);
		expect(sourcesFor('overlay').map((s) => s.id)).toEqual(sourcesFor('text').map((s) => s.id));
	});
	it('resolves person values and treats blanks as empty', () => {
		expect(value({ source: 'lastName' })).toBe('Muster');
		expect(value({ source: 'fullName' })).toBe('Max Muster');
		expect(value({ source: 'personnelNo' })).toBe('4711');
		expect(value({ source: 'department' })).toBe('Technik');
		expect(value({ source: 'place' })).toBe('Magdeburg');
		expect(value({ source: 'lastName' }, emptyMapping())).toBeNull();
		expect(value({ source: 'fullName' }, emptyMapping())).toBeNull();
	});
	it('resolves balance values as German day numbers', () => {
		expect(value({ source: 'entitlementYear' })).toBe('30');
		expect(value({ source: 'entitlementTotal' })).toBe('35');
		expect(value({ source: 'carryOver' })).toBe('4');
		expect(value({ source: 'additional' })).toBe('1');
		expect(value({ source: 'paidOut' })).toBe('0');
		expect(value({ source: 'restBefore' })).toBe('22,5');
		expect(value({ source: 'restAfter' })).toBe('12,5');
	});
	it('splits a negative correction into paid-out days', () => {
		expect(resolveBinding({ source: 'paidOut' }, mapping, { ...request, adjustmentHalfDays: -3 })).toBe('1,5');
		expect(resolveBinding({ source: 'additional' }, mapping, { ...request, adjustmentHalfDays: -3 })).toBe('0');
	});
	it('formats dates by profile format with per-binding override', () => {
		expect(value({ source: 'dateFrom' })).toBe('06.07.2026');
		expect(value({ source: 'dateTo' }, { ...mapping, dateFormat: 'd.M.yy' })).toBe('17.7.26');
		expect(value({ source: 'dateFrom', dateFormat: 'iso' })).toBe('2026-07-06');
		expect(value({ source: 'today' })).toBe('01.06.2026');
		expect(value({ source: 'dateRange' })).toBe('06.07.2026 - 17.07.2026');
		expect(resolveBinding({ source: 'dateRange' }, mapping, { ...request, to: request.from })).toBe('06.07.2026');
	});
	it('resolves working days, free ranges and the free-day checkbox', () => {
		expect(value({ source: 'workingDays' })).toBe('10');
		expect(value({ source: 'freeRangeFrom', index: 1 })).toBe('11.07.2026');
		expect(value({ source: 'freeRangeTo', index: 1 })).toBe('12.07.2026');
		expect(value({ source: 'freeRangeFrom', index: 2 })).toBe('18.07.2026');
		expect(value({ source: 'freeRange', index: 1 })).toBe('11.07.2026 - 12.07.2026');
		expect(value({ source: 'freeRange', index: 2 })).toBe('18.07.2026');
		expect(value({ source: 'freeRangeFrom', index: 3 })).toBeNull();
		expect(value({ source: 'freeDaysCount' })).toBe('3');
		expect(value({ source: 'hasFreeDays' })).toBe(true);
		expect(resolveBinding({ source: 'hasFreeDays' }, mapping, { ...request, freeRanges: [] })).toBe(false);
		expect(resolveBinding({ source: 'freeDaysCount' }, mapping, { ...request, freeRanges: [] })).toBe('0');
	});
	it('clamps the free range position', () => {
		expect(value({ source: 'freeRangeFrom', index: 0 })).toBe('11.07.2026');
		expect(value({ source: 'freeRangeFrom', index: MAX_FREE_RANGES + 5 })).toBeNull();
	});
	it('resolves the substitute, fixed text and fixed checkbox', () => {
		expect(value({ source: 'substitute' })).toBe('Erika Muster');
		expect(resolveBinding({ source: 'substitute' }, mapping, { ...request, substitute: '  ' })).toBeNull();
		expect(value({ source: 'fixedText', text: 'GmbH' })).toBe('GmbH');
		expect(value({ source: 'fixedText', text: '' })).toBeNull();
		expect(value({ source: 'fixedCheckbox', checked: true })).toBe(true);
		expect(value({ source: 'fixedCheckbox', checked: false })).toBe(false);
	});
});
