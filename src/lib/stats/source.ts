import { api, ApiError } from '#lib/api/client.js';
import type { Absence, Segment, StatisticsBucket, TimeStatistics } from '#lib/api/types.js';
import { addDays } from '#lib/time/dates.js';
import { aggregate, bucketKey, bucketLabel, type Granularity, type StatsData, type StatsPoint } from './aggregate.js';

/**
 * Data layer of the statistics page. The page only talks to a `StatsSource`, so a backend statistics series endpoint
 * (package W3) can replace the day-based implementation without touching the page or the charts.
 */
export interface StatsQuery {
	from: string;
	to: string;
	granularity: Granularity;
	rounded: boolean;
	today: string;
	timeZone: string;
}

export interface StatsSource {
	load(query: StatsQuery): Promise<StatsData>;
}

const isMissingEndpoint = (error: unknown) => {
	const status = (error as { status?: number }).status;
	return status === 404 || status === 405 || status === 501;
};

/**
 * Computes the series from existing endpoints: time/days (chunks of 93 days), absences and the time account.
 * Days and segments (when the days do not embed them) are required, absences too except for a disabled planning module (404 `module_disabled`, `absencesAvailable: false`): a failure surfaces as an error instead of
 * a plausible but wrong chart. Only the account balance is optional: a server without the account endpoint yields
 * `balanceAvailable: false` (the balance is then not shown), never a line starting at zero.
 */
export const daySource: StatsSource = {
	async load(query) {
		const rawDays = await api.listDays(query.from, query.to);
		const needsSegments = rawDays.some((d) => !d.segments && d.segmentIds.length > 0);
		const [segments, absenceResult, opening] = await Promise.all([
			// not every server embeds `segments` into the day evaluations: load them once for the whole range as fallback
			needsSegments ? api.listSegments(`${addDays(query.from, -1)}T00:00:00Z`, `${addDays(query.to, 2)}T00:00:00Z`) : Promise.resolve([] as Segment[]),
			// the planning module may be disabled: then the absences are unavailable (empty), every other error stays visible
			api.listAbsences(query.from, query.to).then(
				(list) => ({ list, available: true }),
				(error) => {
					if (error instanceof ApiError && error.status === 404 && error.code === 'module_disabled') return { list: [] as Absence[], available: false };
					throw error;
				}
			),
			// balance before the first day
			api.getTimeAccount(addDays(query.from, -1)).then(
				(a) => a.balanceSeconds as number | null,
				(error) => {
					if (isMissingEndpoint(error)) return null;
					throw error;
				}
			)
		]);
		const byId = new Map(segments.map((seg) => [seg.id, seg]));
		const days = rawDays.map((d) => (d.segments ? d : { ...d, segments: d.segmentIds.map((id) => byId.get(id)).filter((seg): seg is Segment => !!seg) }));
		const data = aggregate({ days, absences: absenceResult.list, openingBalanceSeconds: opening ?? 0, granularity: query.granularity, rounded: query.rounded, today: query.today, timeZone: query.timeZone });
		return { ...data, balanceAvailable: opening !== null, absencesAvailable: absenceResult.available };
	}
};

/** Maps the backend series (contract v0.28.0) to the page's data shape. */
export function fromStatistics(stats: TimeStatistics, monthly: TimeStatistics, today: string, times?: StatsData | null): StatsData {
	const point = (b: StatisticsBucket, granularity: Granularity, previous: number): StatsPoint => {
		const key = bucketKey(b.from, granularity);
		const match = times?.points.find((p) => p.key === key);
		return {
			key,
			end: b.to,
			label: bucketLabel(key, granularity),
			days: b.days,
			targetSeconds: b.targetToDateSeconds,
			actualSeconds: b.actualSeconds + b.creditSeconds,
			deltaSeconds: b.deltaSeconds,
			balanceSeconds: b.balanceSeconds ?? previous,
			workSeconds: b.kindSeconds.work,
			travelSeconds: b.kindSeconds.travel,
			schoolSeconds: b.kindSeconds.school,
			breakSeconds: b.breakSeconds,
			vacationDays: b.absences.vacation,
			sickDays: b.absences.sick,
			otherAbsenceDays: b.absences.excused,
			avgStartMinutes: match?.avgStartMinutes ?? null,
			avgEndMinutes: match?.avgEndMinutes ?? null
		};
	};
	const build = (s: TimeStatistics) => {
		let previous = s.openingBalanceSeconds ?? 0;
		return s.buckets
			.filter((b) => b.from <= today)
			.map((b) => {
				const p = point(b, s.granularity, previous);
				previous = p.balanceSeconds;
				return p;
			});
	};
	const points = build(stats);
	const t = stats.totals;
	return {
		from: stats.from,
		to: stats.to,
		granularity: stats.granularity,
		rounded: stats.basis === 'evaluated',
		points,
		monthly: build(monthly),
		totals: {
			targetSeconds: t.targetToDateSeconds,
			actualSeconds: t.actualSeconds + t.creditSeconds,
			deltaSeconds: t.deltaSeconds,
			breakSeconds: t.breakSeconds,
			workSeconds: t.kindSeconds.work,
			travelSeconds: t.kindSeconds.travel,
			schoolSeconds: t.kindSeconds.school,
			absenceDays: t.absenceDays,
			avgStartMinutes: times?.totals.avgStartMinutes ?? null,
			avgEndMinutes: times?.totals.avgEndMinutes ?? null,
			days: stats.buckets.reduce((sum, b) => sum + (b.targetToDateSeconds > 0 || b.actualSeconds > 0 ? b.days : 0), 0)
		},
		openingBalanceSeconds: stats.openingBalanceSeconds ?? 0,
		balanceAvailable: stats.openingBalanceSeconds != null || stats.buckets.some((b) => b.balanceSeconds != null),
		empty: t.targetToDateSeconds === 0 && t.actualSeconds + t.creditSeconds === 0
	};
}

/**
 * Backend series `GET /time/statistics` (contract v0.28.0, at most 1100 days). The server has no average start/end, so
 * those come from the day-based source (best effort). Servers without the endpoint fall back to `daySource`.
 */
export const apiSource: StatsSource = {
	async load(query) {
		try {
			const basis = query.rounded ? 'evaluated' : 'raw';
			const [stats, monthly, times] = await Promise.all([
				api.getStatistics(query.from, query.to, query.granularity, basis),
				query.granularity === 'month' ? Promise.resolve(null) : api.getStatistics(query.from, query.to, 'month', basis),
				daySource.load(query).catch(() => null)
			]);
			return fromStatistics(stats, monthly ?? stats, query.today, times);
		} catch (error) {
			if (isMissingEndpoint(error)) return daySource.load(query);
			throw error;
		}
	}
};

/** The source in use. */
export let statsSource: StatsSource = apiSource;
export function useStatsSource(source: StatsSource) {
	statsSource = source;
}
