import { t } from '#lib/i18n/index.js';
import type { AutomationMode, BreakHintCode, DayMarkKind, PlaceKind, Segment, SegmentKind, SegmentSource } from '#lib/api/types.js';

export const SEGMENT_KINDS: SegmentKind[] = ['work', 'travel', 'school'];
export const DAY_MARKS: DayMarkKind[] = ['none', 'holiday', 'vacation', 'sick', 'school_credit'];
export const PLACE_KINDS: PlaceKind[] = ['office', 'home', 'customer', 'school', 'other'];
export const AUTOMATION_MODES: AutomationMode[] = ['direct', 'suggest', 'off'];

export const kindLabel = (kind: SegmentKind) => t(`kind.${kind}`);
export const markLabel = (mark: DayMarkKind) => t(`mark.${mark}`);
export const placeKindLabel = (kind: PlaceKind) => t(`place_kind.${kind}`);
export const automationLabel = (mode: AutomationMode) => t(`automation.${mode}`);
export const sourceLabel = (source: SegmentSource) => t(`source.${source}`);
export const hintLabel = (code: BreakHintCode) => t(`hint.${code}`);

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const weekdayLabel = (isoWeekday: number) => t(`weekday.${WEEKDAY_KEYS[isoWeekday - 1]}`);

/** A segment's effective times differ from the raw capture (it was corrected). */
export const isCorrected = (s: Segment) => s.startedAt !== s.rawStartedAt || s.endedAt !== s.rawEndedAt;
