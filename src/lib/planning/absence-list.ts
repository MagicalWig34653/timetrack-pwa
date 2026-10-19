// Pure helpers of the absences list: filters, sorting, URL query and per-viewer persistence (P5).
import type { Absence, AbsenceKind, AbsenceStatus } from '#lib/api/types.js';
import { isValidDate } from '#lib/time/dates.js';
import { ABSENCE_KINDS, ABSENCE_STATUSES } from './labels.js';

export const ABSENCE_FILTER_STORAGE_KEY = 'timetrack.absences.filters';

export type AbsenceSort = 'date_asc' | 'date_desc' | 'kind' | 'status';
export const ABSENCE_SORTS: AbsenceSort[] = ['date_asc', 'date_desc', 'kind', 'status'];
export type AttachmentFilter = 'any' | 'with' | 'without';
export const ATTACHMENT_FILTERS: AttachmentFilter[] = ['any', 'with', 'without'];

export interface AbsenceFilters {
	sort: AbsenceSort;
	kind: 'all' | AbsenceKind;
	status: 'all' | AbsenceStatus;
	attachment: AttachmentFilter;
	/** Inclusive date range; an absence matches when it overlaps it. Empty = open. */
	from: string;
	to: string;
	/** Case-insensitive text search in the note. */
	q: string;
}

export const DEFAULT_ABSENCE_FILTERS: AbsenceFilters = { sort: 'date_asc', kind: 'all', status: 'all', attachment: 'any', from: '', to: '', q: '' };

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null);
const dateOrEmpty = (value: unknown) => (typeof value === 'string' && isValidDate(value) ? value : '');

/** Sanitises untrusted input (URL or storage): unknown values fall back to the defaults. */
export function normalizeFilters(raw: Partial<Record<keyof AbsenceFilters, unknown>>): AbsenceFilters {
	const d = DEFAULT_ABSENCE_FILTERS;
	return {
		sort: oneOf(raw.sort, ABSENCE_SORTS) ?? d.sort,
		kind: oneOf(raw.kind, ABSENCE_KINDS) ?? d.kind,
		status: oneOf(raw.status, ABSENCE_STATUSES) ?? d.status,
		attachment: oneOf(raw.attachment, ATTACHMENT_FILTERS) ?? d.attachment,
		from: dateOrEmpty(raw.from),
		to: dateOrEmpty(raw.to),
		q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : ''
	};
}

export const filtersEqual = (a: AbsenceFilters, b: AbsenceFilters) => (Object.keys(a) as (keyof AbsenceFilters)[]).every((k) => a[k] === b[k]);
export const hasActiveFilters = (f: AbsenceFilters) => !filtersEqual({ ...f, sort: DEFAULT_ABSENCE_FILTERS.sort }, { ...DEFAULT_ABSENCE_FILTERS });

/** Whether the query string carries any filter parameter (then it wins over the remembered filters). */
export function queryHasFilters(params: Pick<URLSearchParams, 'get' | 'has'>): boolean {
	return ['sort', 'kind', 'status', 'attachment', 'from', 'to', 'q'].some((k) => params.has(k));
}

export function filtersFromQuery(params: Pick<URLSearchParams, 'get' | 'has'>): AbsenceFilters {
	return normalizeFilters({
		sort: params.get('sort'),
		kind: params.get('kind') ?? 'all',
		status: params.get('status') ?? 'all',
		attachment: params.get('attachment') ?? 'any',
		from: params.get('from'),
		to: params.get('to'),
		q: params.get('q') ?? ''
	});
}

/** Only non-default values are written, so the plain page keeps a clean URL. */
export function filtersToQuery(filters: AbsenceFilters, year: number, currentYear: number): URLSearchParams {
	const params = new URLSearchParams();
	if (year !== currentYear) params.set('year', String(year));
	for (const key of Object.keys(DEFAULT_ABSENCE_FILTERS) as (keyof AbsenceFilters)[]) {
		if (filters[key] !== DEFAULT_ABSENCE_FILTERS[key]) params.set(key, filters[key]);
	}
	return params;
}

export function yearFromQuery(params: Pick<URLSearchParams, 'get' | 'has'>, fallback: number): number {
	const year = Number(params.get('year'));
	return Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : fallback;
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

export function loadFilters(storage: Pick<Storage, 'getItem'> | null = safeStorage()): AbsenceFilters {
	try {
		const raw = storage?.getItem(ABSENCE_FILTER_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_ABSENCE_FILTERS };
		const parsed: unknown = JSON.parse(raw);
		return normalizeFilters(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
	} catch {
		return { ...DEFAULT_ABSENCE_FILTERS };
	}
}

export function saveFilters(filters: AbsenceFilters, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
	try {
		if (filtersEqual(filters, DEFAULT_ABSENCE_FILTERS)) storage?.removeItem(ABSENCE_FILTER_STORAGE_KEY);
		else storage?.setItem(ABSENCE_FILTER_STORAGE_KEY, JSON.stringify(filters));
	} catch {
		/* private mode or blocked storage: filters just are not remembered */
	}
}

/** Attachment counts by absence id; absent = not loaded yet. */
export type AttachmentCounts = Record<string, number | undefined>;

export function matches(absence: Absence, f: AbsenceFilters, counts: AttachmentCounts = {}): boolean {
	if (f.kind !== 'all' && absence.kind !== f.kind) return false;
	if (f.status !== 'all' && absence.status !== f.status) return false;
	if (f.from && absence.endDate < f.from) return false;
	if (f.to && absence.startDate > f.to) return false;
	const query = f.q.trim().toLowerCase();
	if (query && !(absence.note ?? '').toLowerCase().includes(query)) return false;
	if (f.attachment !== 'any') {
		const n = counts[absence.id];
		if (n === undefined) return false;
		if (f.attachment === 'with' ? n === 0 : n > 0) return false;
	}
	return true;
}

export function sortAbsences(list: Absence[], sort: AbsenceSort): Absence[] {
	const byDate = (a: Absence, b: Absence) => (a.startDate === b.startDate ? (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0) : a.startDate < b.startDate ? -1 : 1);
	const sorted = [...list];
	if (sort === 'date_desc') return sorted.sort((a, b) => byDate(b, a));
	if (sort === 'kind') return sorted.sort((a, b) => ABSENCE_KINDS.indexOf(a.kind) - ABSENCE_KINDS.indexOf(b.kind) || byDate(a, b));
	if (sort === 'status') return sorted.sort((a, b) => ABSENCE_STATUSES.indexOf(a.status) - ABSENCE_STATUSES.indexOf(b.status) || byDate(a, b));
	return sorted.sort(byDate);
}

export function applyFilters(list: Absence[], f: AbsenceFilters, counts: AttachmentCounts = {}): Absence[] {
	return sortAbsences(list.filter((a) => matches(a, f, counts)), f.sort);
}

/** Per-kind counts of the list as filtered by everything except the kind (for the kind select). */
export function countBy<K extends string>(list: Absence[], key: (a: Absence) => K): Partial<Record<K, number>> {
	const out: Partial<Record<K, number>> = {};
	for (const a of list) out[key(a)] = (out[key(a)] ?? 0) + 1;
	return out;
}
