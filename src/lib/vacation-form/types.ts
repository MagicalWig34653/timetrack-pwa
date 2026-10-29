import type { DateRange } from './days';
import type { DateFormatId } from './format';
import type { VacationBlock } from './remaining';

/** What a PDF target can hold. `overlay` is a free text position on a flat PDF. */
export type TargetKind = 'text' | 'checkbox' | 'dropdown' | 'overlay';

export type SourceId =
	| 'lastName'
	| 'firstName'
	| 'fullName'
	| 'personnelNo'
	| 'department'
	| 'place'
	| 'entitlementTotal'
	| 'entitlementYear'
	| 'carryOver'
	| 'additional'
	| 'paidOut'
	| 'compensated'
	| 'restYearEnd'
	| 'restBefore'
	| 'restAfter'
	| 'dateFrom'
	| 'dateTo'
	| 'dateRange'
	| 'workingDays'
	| 'freeRangeFrom'
	| 'freeRangeTo'
	| 'freeRange'
	| 'freeDaysCount'
	| 'hasFreeDays'
	| 'substitute'
	| 'today'
	| 'fixedText'
	| 'fixedCheckbox';

/** One data source chosen for one PDF field or overlay position, with its options. */
export interface Binding {
	source: SourceId;
	/** fixedText: the text */
	text?: string;
	/** fixedCheckbox: ticked or not */
	checked?: boolean;
	/** freeRange*: 1-based position in the list of free-day ranges */
	index?: number;
	/** date sources: overrides the profile's date format */
	dateFormat?: DateFormatId;
	/** compensated: which earlier vacation counts as "davon abgegolten" (default `all`) */
	scope?: CompensatedScope;
}

/** `all`: everything deducted before the request (taken, approved, requested, planned), so total - compensated = rest before. `decided`: only taken and approved. */
export type CompensatedScope = 'all' | 'decided';

export interface PersonValues {
	lastName: string;
	firstName: string;
	personnelNo: string;
	department: string;
	place: string;
}

/** Text position on a flat PDF; x/y in PDF points from the bottom-left corner of the page (0-based page index). */
export interface OverlayItem {
	id: string;
	page: number;
	x: number;
	y: number;
	fontSize: number;
	binding: Binding;
}

/** The saved profile: stored as opaque JSON on the server (<= 64 KB) or in IndexedDB. */
export interface FormMapping {
	version: 1;
	/** Mapping semantics revision; absent (0) on mappings saved before the "davon abgegolten" fix (2). */
	revision?: number;
	person: PersonValues;
	dateFormat: DateFormatId;
	/** Flatten the generated PDF (no longer fillable) unless the dialog says otherwise. */
	flatten: boolean;
	/** AcroForm field name -> binding. Signature fields are never listed. */
	fields: Record<string, Binding>;
	overlays: OverlayItem[];
}

/** Vacation account figures around one request, in half days. */
export interface RequestBreakdown {
	entitlementTotalHalfDays: number;
	/** other vacation before the request's first day (all statuses that consume entitlement) */
	before: VacationBlock[];
	/** other vacation after the request's last day; does not reduce the rest at the request date */
	later: VacationBlock[];
	/** other vacation overlapping the request period (not counted twice) */
	overlapping: VacationBlock[];
	consumedBeforeHalfDays: number;
	laterHalfDays: number;
	requestHalfDays: number;
	restBeforeHalfDays: number;
	restAfterHalfDays: number;
	/** after every plan of the year */
	restYearEndHalfDays: number;
	/** false: the absence list was missing, so every other vacation is treated as earlier */
	blocksKnown: boolean;
}

/** Everything a request provides at generation time. */
export interface RequestData {
	from: string;
	to: string;
	today: string;
	substitute: string;
	entitlementYearHalfDays: number;
	entitlementTotalHalfDays: number;
	carryOverHalfDays: number;
	adjustmentHalfDays: number;
	restBeforeHalfDays: number;
	restAfterHalfDays: number;
	/** rest at the end of the year after all plans */
	restYearEndHalfDays: number;
	/** earlier vacation, all statuses ("davon abgegolten", default) */
	compensatedHalfDays: number;
	/** earlier vacation, only approved or taken */
	compensatedDecidedHalfDays: number;
	workingDays: number;
	freeRanges: DateRange[];
	breakdown?: RequestBreakdown;
}

export type ResolvedValue = string | boolean | null;
