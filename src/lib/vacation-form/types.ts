import type { DateRange } from './days';
import type { DateFormatId } from './format';

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
}

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
	person: PersonValues;
	dateFormat: DateFormatId;
	/** Flatten the generated PDF (no longer fillable) unless the dialog says otherwise. */
	flatten: boolean;
	/** AcroForm field name -> binding. Signature fields are never listed. */
	fields: Record<string, Binding>;
	overlays: OverlayItem[];
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
	workingDays: number;
	freeRanges: DateRange[];
}

export type ResolvedValue = string | boolean | null;
