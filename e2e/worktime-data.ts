import { buildWorktimeWorkbook, type WorktimeWorkbookInput } from '../mock/worktime-xlsx';

// Synthetic data for the worktime workbook E2E (ADR-0013). Nothing here comes from a real spreadsheet.
// The window 2026-08-03 .. 2026-08-28 lies in the past (status `taken`), the December rows lie in the future (status `approved`).

export interface Row {
	date: string;
	start: string | null;
	end: string | null;
	remark?: string;
}
export const row = (date: string, start: string | null, end: string | null, remark?: string): Row => ({ date, start, end, remark });

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const book = (input: WorktimeWorkbookInput, name = 'Arbeitszeit.xlsx') => ({ name, mimeType: XLSX_MIME, buffer: Buffer.from(buildWorktimeWorkbook(input)) });

/** The credited standard day: target 7:42 plus 0:30 pause. */
const CREDIT: [string, string] = ['08:00', '16:12'];

export const MAIN_2026: Row[] = [
	// week 1: vacation, vacation with 1 s noise, sick, "school / sick" (first matching rule = sick), a normal day with second noise
	row('2026-08-03', ...CREDIT, 'Urlaub'),
	row('2026-08-04', '8:00:01', '16:11:59', 'Urlaub'),
	row('2026-08-05', ...CREDIT, 'Krank'),
	row('2026-08-06', ...CREDIT, 'Berufsschule / Krank'),
	row('2026-08-07', '7:59:40', '16:30:20'),
	// week 2: school, "BS", custom holiday (not in the built-in calendar), free text, vacation before a weekend
	row('2026-08-10', ...CREDIT, 'Berufsschule'),
	row('2026-08-11', ...CREDIT, 'BS'),
	row('2026-08-12', ...CREDIT, 'Feiertag'),
	row('2026-08-13', '9:00:10', '13:00:10', 'Arzttermin'),
	row('2026-08-14', ...CREDIT, 'Urlaub'),
	// week 3: vacation continues after the weekend, work, excused, free text
	row('2026-08-17', ...CREDIT, 'Urlaub'),
	row('2026-08-18', '7:45', '16:00'),
	row('2026-08-19', '8:15:29', '17:00:29'),
	row('2026-08-20', ...CREDIT, 'Urlaub (Freigestellt)'),
	row('2026-08-21', '8:30', '15:00', 'Kundentermin'),
	// week 4: only work days
	row('2026-08-24', '8:00', '16:30'),
	row('2026-08-25', '8:00:20', '16:42:10'),
	row('2026-08-26', '7:30', '15:30', 'Homeoffice'),
	row('2026-08-27', '8:00', '17:00'),
	row('2026-08-28', '9:00', '13:30'),
	// future: vacation 21.-24.12., built-in holiday 25.12., vacation 28.-31.12., built-in holiday 1.1.2027 (same ISO week 53 of 2026)
	row('2026-12-21', ...CREDIT, 'Urlaub'),
	row('2026-12-22', ...CREDIT, 'Urlaub'),
	row('2026-12-23', ...CREDIT, 'Urlaub'),
	row('2026-12-24', ...CREDIT, 'Urlaub'),
	row('2026-12-25', ...CREDIT, 'Feiertag'),
	row('2026-12-28', ...CREDIT, 'Urlaub'),
	row('2026-12-29', ...CREDIT, 'Urlaub'),
	row('2026-12-30', ...CREDIT, 'Urlaub'),
	row('2026-12-31', ...CREDIT, 'Urlaub'),
	row('2027-01-01', ...CREDIT, 'Feiertag')
];
export const MAIN_2027: Row[] = [row('2027-01-04', '8:00', '16:30')];

export const mainWorkbook = (date1904: boolean) =>
	book(
		{
			date1904,
			sheets: [
				{ year: 2026, days: MAIN_2026 },
				{ year: 2027, days: MAIN_2027 }
			]
		},
		date1904 ? 'Arbeitszeit-1904.xlsx' : 'Arbeitszeit.xlsx'
	);

// ---------------------------------------------------------------------------------------------------- independent expectations

export type Action = 'work' | 'school' | 'vacation' | 'sick' | 'excused' | 'holiday';

/** Default rules of ADR-0013, implemented again here (first match wins, case-insensitive substring, "^bs$" exact). */
export function classify(remark: string | undefined): Action {
	const text = (remark ?? '').replace(/ /g, ' ').trim().toLowerCase();
	if (text.includes('krank')) return 'sick';
	if (text.includes('freigestellt')) return 'excused';
	if (text.includes('urlaub')) return 'vacation';
	if (text.includes('feiertag')) return 'holiday';
	if (text.includes('berufsschule') || text === 'bs') return 'school';
	return 'work';
}

const seconds = (hms: string) => {
	const [h, m = 0, s = 0] = hms.split(':').map(Number);
	return h * 3600 + m * 60 + s;
};
/** whole minutes, nearest */
const minute = (hms: string) => Math.round(seconds(hms) / 60);
export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export interface ExpectedSegment {
	date: string;
	kind: 'work' | 'school';
	start: string;
	end: string;
	note: string | null;
}

/** Expected import segments of the work/school rows: split around a 30 minute pause starting at 12:00. */
export function expectedSegments(rows: Row[]): ExpectedSegment[] {
	const out: ExpectedSegment[] = [];
	for (const r of rows) {
		const action = classify(r.remark);
		if (action !== 'work' && action !== 'school') continue;
		if (!r.start || !r.end) continue;
		const s = minute(r.start);
		const e = minute(r.end);
		const note = r.remark ? r.remark : null;
		const pauseStart = 12 * 60;
		// the pause window starts at 12:00 when it fits into the interval, otherwise it is centred; the duration stays end - start - pause
		const gapStart = s <= pauseStart && pauseStart + 30 <= e ? pauseStart : Math.round((s + e) / 2 - 15);
		out.push({ date: r.date, kind: action, start: hhmm(s), end: hhmm(gapStart), note }, { date: r.date, kind: action, start: hhmm(gapStart + 30), end: hhmm(e), note });
	}
	return out;
}

/** Time-account expectation (rounding off, no fixed pause, 7:42 target): work rows count worked - target, credited days are 0. */
export function expectedBalance(rows: Row[], upTo: string): number {
	let total = 0;
	for (const r of rows) {
		if (r.date > upTo) continue;
		if (classify(r.remark) !== 'work' || !r.start || !r.end) continue;
		total += (minute(r.end) - minute(r.start) - 30) * 60 - 27_720;
	}
	return total;
}

/** Sum of the cached E column the builder writes (seconds): worked time minus pause minus the 7:42 day target, only rows with both times. */
export function sheetBalance(rows: Row[]): number {
	let total = 0;
	for (const r of rows) {
		if (!r.start || !r.end) continue;
		total += seconds(r.end) - seconds(r.start) - 1800 - 27_720;
	}
	return total;
}
