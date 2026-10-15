// Mock of the worktime workbook import/export profile (ADR-0013). All workbooks are synthetic, built by buildWorktimeWorkbook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setCsrfToken } from '../src/lib/api/client.ts';
import type { ImportMapping, WorktimeOptions } from '../src/lib/api/types.ts';
import { sessionStore } from '../src/lib/session.svelte.ts';
import { createMockFetch } from './fetch.ts';
import { buildSimpleWorkbook, buildWorktimeWorkbook, detectWorktimeWorkbook, parseWorktimeWorkbook, readWorkbook, type WorktimeWorkbookInput } from './worktime-xlsx.ts';

const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	mock = createMockFetch({ now: () => NOW.getTime() });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => vi.unstubAllGlobals());

const file = (bytes: Uint8Array, name = 'Arbeitszeit.xlsx') => new File([bytes as BlobPart], name);
const profile = (worktime: WorktimeOptions = {}): ImportMapping => ({
	profile: 'worktime_workbook',
	worktime,
	sheet: '2026',
	headerRow: 0,
	dateFormat: 'dd.MM.yyyy',
	timeFormat: 'HH:mm',
	columns: { date: 0 }
});

const day = (date: string, start: string | null, end: string | null, remark?: string) => ({ date, start, end, remark });
const SAMPLE: WorktimeWorkbookInput = {
	sheets: [
		{
			year: 2026,
			days: [
				day('2026-03-02', '8:00:20', '16:12:00'),
				day('2026-03-03', '8:00', '16:12', 'Urlaub'),
				day('2026-03-04', '8:00', '16:12', 'urlaub'),
				day('2026-03-05', '8:00', '16:12', 'Urlaub (Freigestellt)'),
				day('2026-03-06', '8:00', '12:00', 'BS'),
				day('2026-03-09', '8:00', '16:12', 'Krank'),
				day('2026-03-10', '8:00', '16:12', 'Krank'),
				day('2026-03-16', '8:00', '16:12', 'Urlaub'),
				day('2026-03-17', '8:00', '16:12', 'Urlaub'),
				day('2026-03-18', '8:00', '16:12', 'Urlaub'),
				day('2026-03-19', '8:00', '16:12', 'Urlaub'),
				day('2026-03-20', '8:00', '16:12', 'Urlaub'),
				day('2026-03-23', '8:00', '16:12', 'Urlaub'),
				day('2026-03-24', '9:00', '13:00', 'Arzttermin'),
				day('2026-03-25', '8:00', '16:12', 'Feiertag Betriebsfeier'),
				day('2026-03-26', '9:00', '9:20'),
				day('2026-04-03', '8:00', '16:12', 'Feiertag')
			]
		}
	]
};

async function preview(bytes: Uint8Array, worktime?: WorktimeOptions) {
	const job = await api.uploadImport(file(bytes));
	return { job, preview: await api.putImportMapping(job.id, profile(worktime)) };
}

describe('xlsx helpers', () => {
	it('round-trips a synthetic workbook and detects the profile (1900 and 1904)', () => {
		expect(detectWorktimeWorkbook(buildWorktimeWorkbook(SAMPLE))).toBe(true);
		expect(detectWorktimeWorkbook(buildSimpleWorkbook('Tabelle1', [['Datum', 'Beginn'], ['03.03.2026', '8:00']]))).toBe(false);
		const parsed = parseWorktimeWorkbook(buildWorktimeWorkbook(SAMPLE));
		expect(parsed.dateSystem).toBe('1900');
		expect(parsed.tablePauseMinutes).toBe(30);
		const first = parsed.rows.find((r) => r.date === '2026-03-02')!;
		expect(Math.round(first.start! / 60)).toBe(480);
		expect(parsed.rows.find((r) => r.date === '2026-03-03')!.remark).toBe('Urlaub');
		const book1904 = parseWorktimeWorkbook(buildWorktimeWorkbook({ ...SAMPLE, date1904: true }));
		expect(book1904.dateSystem).toBe('1904');
		expect(book1904.rows.map((r) => r.date)).toEqual(parsed.rows.map((r) => r.date));
		expect(readWorkbook(buildWorktimeWorkbook(SAMPLE)).sheets.map((s) => s.name)).toEqual(['2026']);
	});
});

describe('worktime import profile', () => {
	it('detects the profile on upload and serves the default rules', async () => {
		const job = await api.uploadImport(file(buildWorktimeWorkbook(SAMPLE)));
		expect(job).toMatchObject({ kind: 'xlsx', detectedProfile: 'worktime_workbook', sheets: ['2026'] });
		const generic = await api.uploadImport(file(buildSimpleWorkbook('Tabelle1', [['Datum', 'Beginn', 'Ende'], ['03.03.2026', '8:00', '9:00']]), 'zeiten.xlsx'));
		expect(generic.detectedProfile).toBe('generic');
		const rules = await api.worktimeDefaultRules();
		expect(rules.map((r) => r.action).slice(0, 3)).toEqual(['sick', 'excused', 'vacation']);
	});

	it('applies the rules: excused before vacation, merged absences, pause split, school, custom and skipped holidays', async () => {
		const { preview: p } = await preview(buildWorktimeWorkbook(SAMPLE));
		expect(p.profile).toBe('worktime_workbook');
		const w = p.worktime!;
		expect(w).toMatchObject({ segments: 7, absences: 4, customDays: 1, skippedHolidays: 1, firstDate: '2026-03-02', lastDate: '2026-04-03', dateSystem: '1900' });
		expect(w.byAction).toMatchObject({ vacation: 8, sick: 2, excused: 1, school: 1, holiday: 2 });
		// "Arzttermin" matches no rule: reported for review
		expect(w.unmappedRemarks).toEqual([{ text: 'Arzttermin', count: 1 }]);
		expect(p.errors).toEqual([]);
		expect(p.warnings).toEqual([{ code: 'pause_exceeds_day', row: expect.any(Number) }]);
		expect(p.valid).toBe(12);
	});

	it('commits segments (split around the pause), absences with taken status, custom days; re-import is idempotent; rollback restores', async () => {
		const bytes = buildWorktimeWorkbook(SAMPLE);
		const { job } = await preview(bytes);
		const result = await api.commitImport(job.id);
		expect(result).toMatchObject({ created: 7, absencesCreated: 4, customDaysCreated: 1 });
		const segments = await api.listSegments('2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z');
		expect(segments).toHaveLength(2);
		expect(segments.map((s) => s.startedAt)).toEqual(['2026-03-02T07:00:00.000Z', '2026-03-02T11:30:00.000Z']);
		expect(segments.map((s) => s.endedAt)).toEqual(['2026-03-02T11:00:00.000Z', '2026-03-02T15:12:00.000Z']);
		const absences = await api.listAbsences('2026-03-01', '2026-03-31');
		expect(absences.map((a) => [a.kind, a.startDate, a.endDate, a.status, a.countedHalfDays])).toEqual([
			['vacation', '2026-03-03', '2026-03-04', 'taken', 4],
			['excused', '2026-03-05', '2026-03-05', 'taken', 0],
			['sick', '2026-03-09', '2026-03-10', 'taken', 0],
			['vacation', '2026-03-16', '2026-03-23', 'taken', 12]
		]);
		expect(absences[1].note).toBe('Urlaub (Freigestellt)');
		expect((await api.listHolidays(2026)).some((h) => h.name === 'Feiertag Betriebsfeier')).toBe(true);

		// the same file again: everything is a duplicate
		const again = await api.uploadImport(file(bytes));
		const p2 = await api.putImportMapping(again.id, profile());
		expect(p2.valid).toBe(0);
		expect(p2.duplicates).toBeGreaterThan(0);

		await api.rollbackImport(job.id);
		expect(await api.listAbsences('2026-03-01', '2026-03-31')).toEqual([]);
		expect((await api.listHolidays(2026)).some((h) => h.name === 'Feiertag Betriebsfeier')).toBe(false);
		expect(await api.listSegments('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z')).toEqual([]);
	});

	it('reports a typed conflict list when an imported absence was edited', async () => {
		const { job } = await preview(buildWorktimeWorkbook(SAMPLE));
		await api.commitImport(job.id);
		const [first] = await api.listAbsences('2026-03-01', '2026-03-31');
		await api.updateAbsence(first.id, { kind: first.kind, startDate: first.startDate, endDate: first.endDate, status: first.status, note: 'geändert' }, first.version);
		await expect(api.rollbackImport(job.id)).rejects.toMatchObject({ status: 409, code: 'rollback_conflict', body: { conflicts: [{ id: first.id, type: 'absence' }] } });
	});

	it('honours options: pause none, override minutes, pause start, user rules (first match wins), skip', async () => {
		const bytes = buildWorktimeWorkbook(SAMPLE);
		const none = (await preview(bytes, { pauseMode: 'none', partialCredit: 'absence' })).preview;
		expect(none.worktime!.segments).toBe(4);
		expect(none.errors).toEqual([]);
		const rules = [
			{ pattern: 'arzttermin', action: 'skip' as const },
			{ pattern: 'urlaub', action: 'sick' as const },
			{ pattern: '^bs$', action: 'school' as const }
		];
		const custom = (await preview(bytes, { rules })).preview.worktime!;
		expect(custom.byAction).toMatchObject({ skip: 1, sick: 9, school: 1 });
		expect(custom.unmappedRemarks!.map((r) => r.text)).toEqual(['Krank', 'Feiertag', 'Feiertag Betriebsfeier']);
		// pause override longer than the 20 min day
		const long = (await preview(bytes, { pauseMinutes: 25 })).preview;
		expect(long.warnings).toEqual([{ code: 'pause_exceeds_day', row: expect.any(Number) }]);
	});

	it('reports conflicting duplicate dates across sheets and merges identical ones', async () => {
		const sheets = [
			{ year: 2026, days: [day('2026-12-30', '8:00', '16:12'), day('2026-12-31', '8:00', '12:00')] },
			{ year: 2027, days: [day('2027-01-01', '8:00', '12:00')] }
		];
		const ok = (await preview(buildWorktimeWorkbook({ sheets }))).preview;
		expect(ok.errors).toEqual([]);
		// the ISO week 53 appears in two sheets: the second sheet only repeats the date cells, never data
		expect(ok.worktime!.days).toBe(2);
	});

	it('flags planning_disabled for absences when the planning module is off and refuses a bad profile', async () => {
		await api.putMyModules({ planning: false });
		const p = (await preview(buildWorktimeWorkbook(SAMPLE))).preview;
		expect(p.errors.filter((e) => e.code === 'planning_disabled').length).toBeGreaterThan(0);
		const generic = await api.uploadImport(file(buildSimpleWorkbook('Tabelle1', [['Datum'], ['03.03.2026']]), 'x.xlsx'));
		await expect(api.putImportMapping(generic.id, profile())).rejects.toMatchObject({ status: 400 });
		await expect(api.putImportMapping((await api.uploadImport(file(buildWorktimeWorkbook(SAMPLE)))).id, profile({ rules: [{ pattern: '', action: 'work' }] }))).rejects.toMatchObject({ status: 400 });
	});

	it('refuses commit with blocking errors unless ignored; warnings do not block', async () => {
		const sheets = [{ year: 2026, days: [day('2026-03-02', '8:00', '9:00'), day('2026-03-03', '8:00', null, 'Termin')] }];
		const job = (await preview(buildWorktimeWorkbook({ sheets }))).job;
		await expect(api.commitImport(job.id)).rejects.toMatchObject({ code: 'import_has_errors' });
		expect(await api.commitImport(job.id, true)).toMatchObject({ created: 2, skipped: 1 });
	});
});

describe('excused type (mock)', () => {
	it('evaluates like sick leave without consuming vacation and is never shared', async () => {
		const before = await api.getVacationBalance(2026);
		const created = await api.createAbsence({ kind: 'excused', startDate: '2026-08-18', endDate: '2026-08-19', status: 'approved' });
		expect(created).toMatchObject({ kind: 'excused', countedHalfDays: 0 });
		expect(await api.getDay('2026-08-18')).toMatchObject({ mark: 'excused', markSource: 'absence', targetSeconds: 0 });
		await api.setDayPreferences('2026-08-20', { mark: 'excused' });
		expect(await api.getDay('2026-08-20')).toMatchObject({ mark: 'excused', targetSeconds: 0 });
		expect(await api.getVacationBalance(2026)).toEqual(before);
	});
});

describe('worktime export profile (mock)', () => {
	it('downloads a valid workbook that the import profile can read back', async () => {
		await api.createSegment({ kind: 'work', startedAt: '2026-08-17T07:00:00Z', endedAt: '2026-08-17T15:12:00Z' });
		await api.createAbsence({ kind: 'excused', startDate: '2026-08-18', endDate: '2026-08-18', status: 'approved' });
		const download = await api.exportTime('2026-08-01', '2026-08-31', 'worktime-xlsx', { times: 'actual', standardStart: '08:00', pauseMinutes: 30, dateSystem: '1904' });
		expect(download.filename).toMatch(/\.xlsx$/);
		const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as ArrayBuffer);
			reader.onerror = () => reject(reader.error);
			reader.readAsArrayBuffer(download.blob);
		}));
		expect(detectWorktimeWorkbook(bytes)).toBe(true);
		const parsed = parseWorktimeWorkbook(bytes);
		expect(parsed.dateSystem).toBe('1904');
		expect(parsed.rows.find((r) => r.date === '2026-08-18')).toMatchObject({ remark: 'Freigestellt' });
		expect(parsed.rows.find((r) => r.date === '2026-08-17')).toMatchObject({ remark: '' });
		await expect(api.exportTime('2026-03-01', '2026-03-31', 'worktime-xlsx', { dateSystem: '1910' as '1900' })).rejects.toMatchObject({ status: 400 });
	});
});

describe('worktime import profile: C23 semantics over the API', () => {
	const C23: WorktimeWorkbookInput = {
		sheets: [
			{
				year: 2026,
				days: [
					day('2026-09-17', '8:00', '16:12'),
					day('2026-09-18', '8:00', '11:00', 'Freigestellt'),
					day('2026-09-21', '8:00', '16:12', 'Freigestellt'),
					day('2026-12-25', '8:00', '16:12'),
					day('2026-12-26', '8:00', '12:00', 'BS')
				]
			}
		]
	};

	it('discards holiday times by default (work and school separately) and keeps them on request', async () => {
		const bytes = buildWorktimeWorkbook(C23);
		const w = await preview(bytes);
		expect(w.preview.warnings).toEqual(
			expect.arrayContaining([
				{ code: 'holiday_times_discarded', count: 1 },
				{ code: 'school_on_holiday', count: 1 }
			])
		);
		const days = (p: typeof w.preview) => p.sample.map((s) => s.date);
		expect(days(w.preview)).not.toContain('2026-12-25');
		const kept = (await preview(bytes, { holidayTimes: 'keep' })).preview;
		expect(kept.warnings!.map((x) => x.code)).not.toContain('holiday_times_discarded');
		expect(kept.worktime!.segments).toBeGreaterThan(w.preview.worktime!.segments!);
	});

	it('treats partial Freigestellt as work with note, a full one as absence, and honours partialCredit=absence', async () => {
		const bytes = buildWorktimeWorkbook(C23);
		const asWork = (await preview(bytes)).preview;
		expect(asWork.warnings).toContainEqual({ code: 'credit_partial_as_work', count: 1 });
		expect(asWork.worktime!.absences).toBe(1);
		const asAbsence = (await preview(bytes, { partialCredit: 'absence' })).preview;
		expect(asAbsence.warnings!.map((x) => x.code)).not.toContain('credit_partial_as_work');
		// 18.9. (Fri) and 21.9. (Mon) are consecutive working days of the same kind: one merged absence
		expect(asAbsence.worktime!.absences).toBe(1);
		expect(asAbsence.worktime!.byAction).toMatchObject({ excused: 2 });
		expect(asWork.worktime!.byAction).toMatchObject({ excused: 1, work: 3 });
		const { job } = await preview(bytes);
		const result = await api.commitImport(job.id);
		expect(result.warnings).toContainEqual({ code: 'credit_partial_as_work', count: 1 });
		const notes = (await api.listSegments('2026-09-18T00:00:00Z', '2026-09-19T00:00:00Z')).map((s) => s.note);
		expect(new Set(notes)).toEqual(new Set(['Freigestellt']));
	});

	it('uses the work model target of the day: a 4 h model makes a 4 h Freigestellt row a plain absence', async () => {
		await api.createWorkModel({ validFrom: '2026-09-01', weeklyTargetSeconds: 20 * 3600, workdays: [1, 2, 3, 4, 5], timezone: 'Europe/Berlin' } as never);
		const four = buildWorktimeWorkbook({ sheets: [{ year: 2026, days: [day('2026-09-18', '8:00', '12:30', 'Freigestellt')] }] });
		const p = (await preview(four)).preview;
		expect(p.warnings!.map((x) => x.code)).not.toContain('credit_partial_as_work');
		expect(p.worktime!.absences).toBe(1);
	});

	it('splits the sheet balance by today and reports the first content day', async () => {
		const w = (await preview(buildWorktimeWorkbook(C23))).preview.worktime!;
		expect(w.firstContentDate).toBe('2026-09-17');
		// today is 14.10.2026: the rows in September are due, the December rows lie in the future
		expect(w.sheetBalanceUpToTodaySeconds).toBe(-(5 * 3600 + 12 * 60));
		expect(w.sheetBalanceFutureSeconds).toBe(-(4 * 3600 + 12 * 60));
		expect(w.sheetBalanceSeconds).toBe(w.sheetBalanceUpToTodaySeconds! + w.sheetBalanceFutureSeconds!);
	});

	it('rejects unknown option values', async () => {
		const job = await api.uploadImport(file(buildWorktimeWorkbook(C23)));
		await expect(api.putImportMapping(job.id, profile({ holidayTimes: 'maybe' as never }))).rejects.toMatchObject({ status: 400 });
		await expect(api.putImportMapping(job.id, profile({ partialCredit: 'x' as never }))).rejects.toMatchObject({ status: 400 });
	});
});
