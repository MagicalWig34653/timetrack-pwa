// Export mock for format=worktime-xlsx (ADR-0013, C22). Produces a small valid workbook in the yearly-sheet layout with the same
// day rows the mock import reads (so export -> import round-trips in the mock), but only approximates the real layout: no styles,
// widths or freeze panes, formulas only on the standard columns. The real backend writes the full template.
import type { DayEvaluation } from '../src/lib/api/types.ts';
import { localTimeOf } from '../src/lib/time/dates.ts';
import { buildWorktimeWorkbook } from './worktime-xlsx.ts';

const MARK_TEXT: Record<string, string> = { holiday: 'Feiertag', vacation: 'Urlaub', sick: 'Krank', excused: 'Freigestellt', school_credit: 'Berufsschule' };

const hm = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
const toSeconds = (clock: string) => Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3, 5)) * 60;

export interface WorktimeExportParams {
	times: 'evaluated' | 'actual';
	standardStart: string;
	dateSystem: '1900' | '1904';
	pauseMinutes: number | null;
}

export function buildWorktimeExport(days: DayEvaluation[], from: string, to: string, params: WorktimeExportParams): Uint8Array {
	const pause = params.pauseMinutes ?? 30;
	const targets = days.map((d) => d.targetSeconds).filter((s) => s > 0);
	const typicalTarget = targets.length > 0 ? targets.sort((a, b) => a - b)[Math.floor(targets.length / 2)] : 27_720;
	const byYear = new Map<number, { date: string; start?: string; end?: string; remark?: string }[]>();
	for (const day of days) {
		if (day.date < from || day.date > to) continue;
		const year = Number(day.date.slice(0, 4));
		const list = byYear.get(year) ?? [];
		byYear.set(year, list);
		const markText = day.mark && day.mark !== 'none' ? MARK_TEXT[day.mark] : undefined;
		if (markText) {
			const start = toSeconds(params.standardStart);
			list.push({ date: day.date, start: hm(start), end: hm(start + typicalTarget + pause * 60), remark: markText });
			continue;
		}
		const segments = (day.segments ?? []).filter((s) => !s.voided);
		const first = params.times === 'actual' ? segments[0]?.rawStartedAt : day.evaluatedStart;
		const last = params.times === 'actual' ? [...segments].reverse().find((s) => s.rawEndedAt)?.rawEndedAt : day.evaluatedEnd;
		if (first) list.push({ date: day.date, start: localTimeOf(first), end: last ? localTimeOf(last) : undefined });
	}
	const years = [...byYear.keys()].sort();
	for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) if (!years.includes(y)) years.push(y);
	years.sort();
	return buildWorktimeWorkbook({
		date1904: params.dateSystem === '1904',
		pause: hm(pause * 60),
		sheets: years.map((year) => ({ year, days: byYear.get(year) ?? [] }))
	});
}
