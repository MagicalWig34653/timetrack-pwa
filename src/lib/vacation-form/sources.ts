import type { MessageKey } from '../i18n/de';
import { formatDaysDe, formatFormDate, type DateFormatId } from './format';
import type { Binding, FormMapping, RequestData, ResolvedValue, SourceId, TargetKind } from './types';

/** Largest number of free-day range positions a binding may address. */
export const MAX_FREE_RANGES = 8;

export type SourceGroup = 'person' | 'balance' | 'request' | 'fixed';

export interface SourceDef {
	id: SourceId;
	label: MessageKey;
	group: SourceGroup;
	/** PDF target kinds the source can fill */
	targets: readonly TargetKind[];
	/** extra option the binding needs */
	option?: 'text' | 'checked' | 'index';
	/** The value is asked at request time and not stored in the profile. */
	askedAtRequest?: boolean;
	resolve: (binding: Binding, mapping: FormMapping, request: RequestData) => ResolvedValue;
}

const TEXT_TARGETS = ['text', 'dropdown', 'overlay'] as const;
const dateFormatOf = (binding: Binding, mapping: FormMapping): DateFormatId => binding.dateFormat ?? mapping.dateFormat;
const days = (halfDays: number) => formatDaysDe(halfDays / 2);
const nonEmpty = (value: string): ResolvedValue => (value.trim() === '' ? null : value.trim());

function rangeAt(binding: Binding, request: RequestData) {
	const index = Math.min(Math.max(Math.trunc(binding.index ?? 1), 1), MAX_FREE_RANGES);
	return request.freeRanges[index - 1] ?? null;
}

function textSource(id: SourceId, label: MessageKey, group: SourceGroup, resolve: SourceDef['resolve'], extra: Partial<SourceDef> = {}): SourceDef {
	return { id, label, group, targets: TEXT_TARGETS, resolve, ...extra };
}

/** The catalogue in display order. A fixed list in one place keeps the settings dropdown, the filler and the tests in step. */
export const SOURCES: readonly SourceDef[] = [
	textSource('lastName', 'vform.source.last_name', 'person', (_b, m) => nonEmpty(m.person.lastName)),
	textSource('firstName', 'vform.source.first_name', 'person', (_b, m) => nonEmpty(m.person.firstName)),
	textSource('fullName', 'vform.source.full_name', 'person', (_b, m) => nonEmpty(`${m.person.firstName} ${m.person.lastName}`)),
	textSource('personnelNo', 'vform.source.personnel_no', 'person', (_b, m) => nonEmpty(m.person.personnelNo)),
	textSource('department', 'vform.source.department', 'person', (_b, m) => nonEmpty(m.person.department)),
	textSource('place', 'vform.source.place', 'person', (_b, m) => nonEmpty(m.person.place)),

	textSource('entitlementTotal', 'vform.source.entitlement_total', 'balance', (_b, _m, r) => days(r.entitlementTotalHalfDays)),
	textSource('entitlementYear', 'vform.source.entitlement_year', 'balance', (_b, _m, r) => days(r.entitlementYearHalfDays)),
	textSource('carryOver', 'vform.source.carry_over', 'balance', (_b, _m, r) => days(r.carryOverHalfDays)),
	textSource('additional', 'vform.source.additional', 'balance', (_b, _m, r) => days(Math.max(r.adjustmentHalfDays, 0))),
	textSource('paidOut', 'vform.source.paid_out', 'balance', (_b, _m, r) => days(Math.max(-r.adjustmentHalfDays, 0))),
	textSource('restBefore', 'vform.source.rest_before', 'balance', (_b, _m, r) => days(r.restBeforeHalfDays)),
	textSource('restAfter', 'vform.source.rest_after', 'balance', (_b, _m, r) => days(r.restAfterHalfDays)),

	textSource('dateFrom', 'vform.source.date_from', 'request', (b, m, r) => formatFormDate(r.from, dateFormatOf(b, m))),
	textSource('dateTo', 'vform.source.date_to', 'request', (b, m, r) => formatFormDate(r.to, dateFormatOf(b, m))),
	textSource('dateRange', 'vform.source.date_range', 'request', (b, m, r) => {
		const format = dateFormatOf(b, m);
		return r.from === r.to ? formatFormDate(r.from, format) : `${formatFormDate(r.from, format)} - ${formatFormDate(r.to, format)}`;
	}),
	textSource('workingDays', 'vform.source.working_days', 'request', (_b, _m, r) => formatDaysDe(r.workingDays)),
	textSource(
		'freeRangeFrom',
		'vform.source.free_range_from',
		'request',
		(b, m, r) => {
			const range = rangeAt(b, r);
			return range ? formatFormDate(range.from, dateFormatOf(b, m)) : null;
		},
		{ option: 'index' }
	),
	textSource(
		'freeRangeTo',
		'vform.source.free_range_to',
		'request',
		(b, m, r) => {
			const range = rangeAt(b, r);
			return range ? formatFormDate(range.to, dateFormatOf(b, m)) : null;
		},
		{ option: 'index' }
	),
	textSource(
		'freeRange',
		'vform.source.free_range',
		'request',
		(b, m, r) => {
			const range = rangeAt(b, r);
			if (!range) return null;
			const format = dateFormatOf(b, m);
			return range.from === range.to ? formatFormDate(range.from, format) : `${formatFormDate(range.from, format)} - ${formatFormDate(range.to, format)}`;
		},
		{ option: 'index' }
	),
	textSource('freeDaysCount', 'vform.source.free_days_count', 'request', (_b, _m, r) => String(r.freeRanges.length === 0 ? 0 : countRangeDays(r.freeRanges))),
	{ id: 'hasFreeDays', label: 'vform.source.has_free_days', group: 'request', targets: ['checkbox'], resolve: (_b, _m, r) => r.freeRanges.length > 0 },
	textSource('substitute', 'vform.source.substitute', 'request', (_b, _m, r) => nonEmpty(r.substitute), { askedAtRequest: true }),
	textSource('today', 'vform.source.today', 'request', (b, m, r) => formatFormDate(r.today, dateFormatOf(b, m))),

	textSource('fixedText', 'vform.source.fixed_text', 'fixed', (b) => nonEmpty(b.text ?? ''), { option: 'text' }),
	{ id: 'fixedCheckbox', label: 'vform.source.fixed_checkbox', group: 'fixed', targets: ['checkbox'], option: 'checked', resolve: (b) => b.checked === true }
];

function countRangeDays(ranges: { from: string; to: string }[]): number {
	let total = 0;
	for (const range of ranges) total += Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
	return total;
}

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

export const isSourceId = (value: unknown): value is SourceId => typeof value === 'string' && BY_ID.has(value as SourceId);

export function sourceDef(id: SourceId): SourceDef {
	return BY_ID.get(id)!;
}

/** Sources that may fill a field of the given kind. */
export function sourcesFor(kind: TargetKind): SourceDef[] {
	return SOURCES.filter((source) => source.targets.includes(kind));
}

/** Value a binding produces, or null for "leave the field empty". */
export function resolveBinding(binding: Binding, mapping: FormMapping, request: RequestData): ResolvedValue {
	const def = BY_ID.get(binding.source);
	return def ? def.resolve(binding, mapping, request) : null;
}
