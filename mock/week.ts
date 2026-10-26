// Mock of the week endpoints of contract v0.17.0 (package K1, ADR-0021): GET/PUT /plan/weeks/{isoWeek} and GET /time/weeks/{isoWeek}.
// They are composed from the time and planning mocks (day evaluations, account, absences, plan days), like the backend composes
// them from the day evaluation, so the numbers always agree with /time/days and /time/account.
import { addDays, DEFAULT_TIMEZONE, isoWeekday, isoWeekLabel, localMinutesOf, mondayOfIsoWeek, todayLocal } from '../src/lib/time/dates.ts';
import type { Absence, DayEvaluation, PlanBlock, PlanDay, PlanWeek, PlanWeekDay, Segment, TimeAccount, TimeWeek, TimeWeekDay, WeekMark } from '../src/lib/api/types.ts';
import { normalizePlanBody, plannedSecondsOf } from './planning.ts';

export interface WeekResponse {
	status: number;
	body?: unknown;
}
type Caller = (accountId: string, method: string, path: string, body?: unknown) => { status: number; body?: unknown } | null;

const fail = (status: number, code: string): WeekResponse => ({ status, body: { error: { code, message: code } } });
const ok = (body: unknown): WeekResponse => ({ status: 200, body });
const BLOCKING = ['holiday', 'vacation', 'sick', 'excused'];
const ACTIVE = ['planned', 'requested', 'approved', 'taken'];

export function createWeekMock(deps: { clock: () => number; time: Caller; planning: Caller; planningEnabled: (accountId: string) => boolean }) {
	const get = <T>(caller: Caller, accountId: string, path: string, fallback: T): T => {
		const response = caller(accountId, 'GET', `/api/v1/${path}`);
		return response && response.status === 200 ? (response.body as T) : fallback;
	};

	function planWeek(accountId: string, monday: string): PlanWeek {
		const sunday = addDays(monday, 6);
		const evaluations = get<DayEvaluation[]>(deps.time, accountId, `time/days?from=${monday}&to=${sunday}`, []);
		const plans = new Map(get<PlanDay[]>(deps.planning, accountId, `plan/days?from=${monday}&to=${sunday}`, []).map((p) => [p.date, p]));
		const days: PlanWeekDay[] = evaluations.map((ev) => {
			const plan = plans.get(ev.date) ?? null;
			const half = ev.mark === 'vacation' && ev.targetOverrideSeconds != null;
			const blockedBy = BLOCKING.includes(ev.mark ?? 'none') && !half ? (ev.mark as PlanBlock) : null;
			return {
				date: ev.date,
				weekday: isoWeekday(ev.date),
				targetSeconds: ev.targetSeconds,
				plannedSeconds: blockedBy && plan ? 0 : (plan?.plannedSeconds ?? null),
				blockedBy,
				plan
			};
		});
		const target = days.reduce((sum, d) => sum + d.targetSeconds, 0);
		const planned = days.reduce((sum, d) => sum + (d.plannedSeconds ?? 0), 0);
		return { week: isoWeekLabel(monday), from: monday, to: sunday, days, totals: { targetSeconds: target, plannedSeconds: planned, differenceSeconds: planned - target } };
	}

	function putPlanWeek(accountId: string, monday: string, body: any): WeekResponse {
		const sunday = addDays(monday, 6);
		const entries: any[] = Array.isArray(body?.days) ? body.days : [];
		if (!Array.isArray(body?.days) || entries.length > 7) return fail(400, 'week_day_invalid');
		const dates = entries.map((e) => e?.date);
		const valid = dates.every((d) => typeof d === 'string' && d >= monday && d <= sunday) && new Set(dates).size === dates.length;
		if (!valid) return fail(400, 'week_day_invalid');
		// Validate everything first: the real endpoint is all or nothing.
		for (const entry of entries) {
			const normalized = normalizePlanBody(entry);
			if ('error' in normalized) return fail(400, normalized.error);
		}
		if (body.replace === true) {
			for (let i = 0; i < 7; i++) {
				const date = addDays(monday, i);
				if (!dates.includes(date)) deps.planning(accountId, 'DELETE', `/api/v1/plan/days/${date}`);
			}
		}
		for (const entry of entries) deps.planning(accountId, 'PUT', `/api/v1/plan/days/${entry.date}`, entry);
		return ok(planWeek(accountId, monday));
	}

	function markOf(ev: DayEvaluation, schoolSeconds: number): WeekMark {
		const mark = ev.mark ?? 'none';
		if (BLOCKING.includes(mark)) return mark as WeekMark;
		if (mark === 'school_credit') return 'school';
		const hasWork = ev.rawWorkSeconds > 0 || ev.evaluatedWorkSeconds > 0;
		if (schoolSeconds > 0 && ev.evaluatedWorkSeconds === 0 && ev.creditSeconds > 0) return 'school';
		if (hasWork || schoolSeconds > 0 || ev.targetSeconds > 0) return 'work';
		return 'off';
	}

	function timeWeek(accountId: string, monday: string): TimeWeek {
		const sunday = addDays(monday, 6);
		const now = deps.clock();
		const today = todayLocal(DEFAULT_TIMEZONE, new Date(now));
		const evaluations = get<DayEvaluation[]>(deps.time, accountId, `time/days?from=${monday}&to=${sunday}`, []);
		const segmentsResponse = deps.time(accountId, 'GET', `/api/v1/time/segments?from=${encodeURIComponent(new Date(Date.parse(`${addDays(monday, -1)}T00:00:00Z`)).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(`${addDays(sunday, 2)}T00:00:00Z`)).toISOString())}`);
		const segments = segmentsResponse && segmentsResponse.status === 200 ? (segmentsResponse.body as Segment[]) : [];
		const planning = deps.planningEnabled(accountId);
		const plans = new Map(planning ? get<PlanDay[]>(deps.planning, accountId, `plan/days?from=${monday}&to=${sunday}`, []).map((p) => [p.date, p]) : []);
		const absences = planning ? get<Absence[]>(deps.planning, accountId, `absences?from=${monday}&to=${sunday}`, []) : [];

		const days: TimeWeekDay[] = evaluations.map((ev) => {
			const own = segments.filter((s) => ev.segmentIds.includes(s.id)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
			let travel = 0;
			let school = 0;
			let gaps = 0;
			let previousEnd: number | null = null;
			for (const s of own) {
				const start = Date.parse(s.startedAt);
				const end = s.endedAt ? Date.parse(s.endedAt) : now;
				const length = Math.max(0, Math.floor((end - start) / 1000));
				if (s.kind === 'travel') travel += length;
				else if (s.kind === 'school') school += length;
				if (previousEnd !== null && start > previousEnd) gaps += Math.floor((start - previousEnd) / 1000);
				previousEnd = Math.max(previousEnd ?? end, end);
			}
			const plan = plans.get(ev.date) ?? null;
			const half = ev.mark === 'vacation' && ev.targetOverrideSeconds != null;
			const blocked = BLOCKING.includes(ev.mark ?? 'none') && !half;
			const future = ev.date > today;
			const mark = markOf(ev, school);
			return {
				date: ev.date,
				weekday: isoWeekday(ev.date),
				mark,
				legalProfileId: ev.legalProfileId,
				legalWarnings: ev.legalWarnings,
				breakHints: ev.breakHints,
				schoolLessonCount: ev.schoolLessonCount,
				markSource: ev.markSource ?? 'none',
				targetSeconds: ev.targetSeconds,
				plannedSeconds: blocked ? (plan ? 0 : null) : (plan?.plannedSeconds ?? null),
				planMode: plan?.mode ?? null,
				workSeconds: ev.evaluatedWorkSeconds,
				creditSeconds: ev.creditSeconds,
				rawWorkSeconds: ev.rawWorkSeconds,
				breakSeconds: gaps,
				breakDeductionSeconds: ev.breakDeductionSeconds,
				travelSeconds: travel,
				schoolSeconds: school,
				balanceSeconds: future ? null : ev.deltaSeconds,
				firstStart: ev.evaluatedStart ?? null,
				lastEnd: ev.evaluatedEnd ?? null,
				segmentsCount: own.length,
				absences: absences
					.filter((a) => ACTIVE.includes(a.status) && a.startDate <= ev.date && a.endDate >= ev.date)
					.map((a) => ({ kind: a.kind, status: a.status, halfDay: (ev.date === a.startDate && !!a.halfDayStart) || (ev.date === a.endDate && !!a.halfDayEnd) })),
				provisional: ev.provisional,
				isToday: ev.date === today,
				isFuture: future
			};
		});

		const accountAt = (asOf: string) => get<TimeAccount>(deps.time, accountId, `time/account?asOf=${asOf}`, { asOf, balanceSeconds: 0, openingSeconds: 0, adjustmentSeconds: 0, provisional: false });
		const before = accountAt(addDays(monday, -1));
		const after = accountAt(sunday);
		const worked = days.filter((d) => d.workSeconds > 0);
		const longest = worked.reduce<TimeWeekDay | null>((best, d) => (!best || d.workSeconds > best.workSeconds ? d : best), null);
		const mean = (values: number[]) => {
			if (values.length === 0) return null;
			const minutes = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
			return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
		};
		const hasPlan = days.some((d) => d.plannedSeconds !== null);
		return {
			week: isoWeekLabel(monday),
			from: monday,
			to: sunday,
			days,
			summary: {
				targetSeconds: days.reduce((s, d) => s + d.targetSeconds, 0),
				targetToDateSeconds: days.filter((d) => !d.isFuture).reduce((s, d) => s + d.targetSeconds, 0),
				workSeconds: days.reduce((s, d) => s + d.workSeconds, 0),
				creditSeconds: days.reduce((s, d) => s + d.creditSeconds, 0),
				balanceSeconds: days.reduce((s, d) => s + (d.balanceSeconds ?? 0), 0),
				plannedSeconds: hasPlan ? days.reduce((s, d) => s + (d.plannedSeconds ?? 0), 0) : null,
				accountBalanceBeforeSeconds: before.balanceSeconds,
				accountBalanceAfterSeconds: after.balanceSeconds,
				accountBalanceAsOf: sunday < today ? sunday : today,
				vacationDays: days.filter((d) => d.mark === 'vacation').reduce((s, d) => s + (d.absences.some((a) => a.kind === 'vacation' && a.halfDay) ? 0.5 : 1), 0),
				sickDays: days.filter((d) => d.mark === 'sick').length,
				schoolDays: days.filter((d) => d.mark === 'school').length,
				holidayDays: days.filter((d) => d.mark === 'holiday').length,
				workDays: worked.length,
				travelSeconds: days.reduce((s, d) => s + d.travelSeconds, 0),
				breakSeconds: days.reduce((s, d) => s + d.breakSeconds, 0),
				averageStart: mean(days.filter((d) => d.firstStart).map((d) => localMinutesOf(d.firstStart!, DEFAULT_TIMEZONE))),
				averageEnd: mean(days.filter((d) => d.lastEnd).map((d) => localMinutesOf(d.lastEnd!, DEFAULT_TIMEZONE))),
				longestDay: longest ? { date: longest.date, seconds: longest.workSeconds } : null,
				provisional: days.some((d) => d.provisional)
			}
		};
	}

	/** Returns null for paths this module does not own. */
	function handle(accountId: string, req: { method: string; path: string; body?: any }): WeekResponse | null {
		const route = req.path.split('?')[0].replace(/^\/api\/v1\//, '').replace(/\/+$/, '');
		const match = /^(plan|time)\/weeks\/([^/]+)$/.exec(route);
		if (!match) return null;
		const monday = mondayOfIsoWeek(match[2]);
		const method = req.method.toUpperCase();
		if (match[1] === 'plan') {
			if (method === 'GET') return monday ? ok(planWeek(accountId, monday)) : fail(400, 'invalid_week');
			if (method === 'PUT') return monday ? putPlanWeek(accountId, monday, req.body ?? {}) : fail(400, 'invalid_week');
			return null;
		}
		if (method === 'GET') return monday ? ok(timeWeek(accountId, monday)) : fail(400, 'invalid_week');
		return null;
	}

	return { handle };
}
