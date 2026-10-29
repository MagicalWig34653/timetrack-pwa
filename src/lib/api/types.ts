// Hand-written types mirroring contracts/openapi.yaml in the backend repository (API v0.1.0).

import type { PresetId } from '#lib/theme/accent.js';
import type { GlowId } from '#lib/theme/glow.js';

export type Role = 'admin' | 'member';

export interface Account {
	id: string;
	handle: string;
	displayName: string;
	role: Role;
	/** Guided setup flag (contract v0.13.0); missing on older servers, which counts as done. */
	onboardingState?: OnboardingState;
	/** Appearance preferences of the account (contract v0.14.0); missing on older servers. */
	preferences?: Preferences;
}

/** Account-wide appearance (contract v0.14.0, ADR-0020). App icon and transparency stay device-local. */
export interface Preferences {
	accent: PresetId | 'custom';
	/** `#RRGGBB` (upper case) exactly when accent is `custom`. */
	accentCustomHex?: string | null;
	colorScheme: 'system' | 'light' | 'dark';
	/** Glow level (contract v0.15.0); missing on older servers. */
	glow?: GlowId;
	/** Missing while the defaults apply (never changed). */
	updatedAt?: string | null;
}

export type PreferencesPatch = Partial<Pick<Preferences, 'accent' | 'colorScheme' | 'glow'>> & { accentCustomHex?: string | null };

export type OnboardingState = 'pending' | 'completed' | 'skipped';

/** Own profile (contract v0.13.0, ADR-0019). The handle is read-only. */
export interface Profile {
	handle: string;
	displayName: string;
	email?: string | null;
	emailVerified: boolean;
	/** address that still waits for its confirmation code */
	pendingEmail?: string | null;
	/** false when the server has no SMTP: the address cannot be verified then */
	mailAvailable: boolean;
	onboarding: { state: OnboardingState; updatedAt?: string | null };
}

export interface Session {
	account: Account;
	csrfToken: string;
	/** true = restricted recovery session (only passkey setup and session revocation allowed) */
	recovery: boolean;
	expiresAt?: string;
}

/** Row of the admin account list (contract v0.11.0, ADR-0016): identity and state only, never private data. */
export interface AdminAccount {
	id: string;
	handle: string;
	displayName: string;
	email?: string | null;
	role: Role;
	state: 'active' | 'disabled';
	createdAt: string;
	disabledAt?: string | null;
	lastActivityAt?: string | null;
	passkeyCount: number;
}

export interface AdminAccountPage {
	items: AdminAccount[];
	total: number;
	limit: number;
	offset: number;
}

export interface AdminAccountPatch {
	role?: Role;
	state?: 'active' | 'disabled';
}

export interface Passkey {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt?: string | null;
}

export interface CreationOptions {
	challengeId: string;
	publicKey: PublicKeyCredentialCreationOptionsJSON;
}

export interface RequestOptions {
	challengeId: string;
	publicKey: PublicKeyCredentialRequestOptionsJSON;
}

export interface RecoveryStatus {
	recoveryCodes: { active: boolean; remaining?: number };
	fallbackPassword: { active: boolean };
	/**
	 * Contract 0.36.0: the account e-mail is the only recovery address. `verified` means that address is confirmed;
	 * `accountEmail` is null without one. Both are absent on older servers.
	 */
	email: { available: boolean; active: boolean; verified?: boolean; accountEmail?: string | null; usesAccountEmail?: boolean };
}

export type RecoveryMethod = 'email' | 'recovery-code' | 'fallback-password';

export type InvitationStatus = 'open' | 'used' | 'expired' | 'revoked';

export interface Invitation {
	id: string;
	note?: string | null;
	createdAt: string;
	expiresAt: string;
	status: InvitationStatus;
}

export interface InvitationCreated extends Invitation {
	token: string;
}

export interface RegisterInput {
	inviteToken: string;
	handle: string;
	displayName: string;
	email?: string;
}

// --- Time tracking (contracts/openapi.yaml v0.2.0) ---

export type SegmentKind = 'work' | 'travel' | 'school';
export type SegmentSource = 'timer' | 'manual' | 'automation' | 'suggestion' | 'import';
export type DayMarkKind = 'none' | 'holiday' | 'vacation' | 'sick' | 'excused' | 'school_credit';
export type PlaceKind = 'office' | 'home' | 'customer' | 'school' | 'other';
export type AutomationMode = 'direct' | 'suggest' | 'off';
export type BreakHintCode = 'break_missing_30' | 'break_missing_45' | 'break_missing_60' | 'break_part_too_short' | 'work_over_6h_without_break' | 'work_over_4h30_without_break';
export type LegalProfileId = 'arbzg-adult-de' | 'jarbschg-minor-de';
export type LegalWarningCode = 'daily_limit' | 'weekly_limit' | 'five_day_week' | 'rest_period' | 'weekend_work' | 'work_after_full_school_day' | 'work_before_school';
export interface LegalProfile {
	id: LegalProfileId;
	name: string;
	maxDailySeconds: number | null;
	maxWeeklySeconds: number | null;
	maxWorkdaysPerWeek: number | null;
	breakRules: { afterSeconds: number; requiredSeconds: number }[];
	minimumBreakPartSeconds: number;
	maximumContinuousSeconds: number;
	minimumRestSeconds: number | null;
	restrictedWeekdays: number[];
	school?: { noWorkBeforeMinutes: number; fullDayLessons?: number; fullDayCreditSeconds?: number; fullDaysPerWeek?: number; blockWeekLessons?: number; blockWeekDays?: number; blockWeekCreditSeconds?: number } | null;
	sources: string[];
	informationalOnly: true;
}

export interface FixedBreak {
	start: string;
	end: string;
}

export interface WorkModelInput {
	legalProfileId?: LegalProfileId;
	validFrom: string;
	validTo?: string | null;
	timezone?: string;
	weeklyTargetSeconds: number;
	/** 1 = Monday .. 7 = Sunday */
	workdays: number[];
	dailyTargetSeconds?: Record<string, number>;
	travelCountsAsWork?: boolean;
	roundingEnabled?: boolean;
	roundingMinutes?: number;
	schoolFullDayThresholdSeconds?: number;
	schoolCreditSeconds?: number | null;
	dayBoundaryMinutes?: number;
	fixedBreaks?: FixedBreak[];
}

export interface WorkModel extends WorkModelInput {
	id: string;
	createdAt: string;
	/** Correction counter (contract v0.16.0); absent on older backends, which cannot correct a version in place. */
	version?: number;
}

/** Effect of a correction on the time account, computed by the server without saving (POST /work-models/{id}/preview). */
export interface WorkModelPreview {
	affectedFrom: string | null;
	/** null = the version is open-ended */
	affectedTo?: string | null;
	affectedDays: number;
	balanceBeforeSeconds: number;
	balanceAfterSeconds: number;
	differenceSeconds: number;
	changedFields: string[];
	/** New end of the previous version when it has to be adjusted. */
	previousValidTo?: string | null;
}

export interface PlaceInput {
	name: string;
	kind: PlaceKind;
	automationMode: AutomationMode;
	latitude?: number | null;
	longitude?: number | null;
	radiusMeters?: number | null;
	confirmAfterSeconds?: number;
	defaultSegmentKind?: SegmentKind;
}

export interface Place extends PlaceInput {
	id: string;
	archived: boolean;
}

export interface SegmentInput {
	kind: SegmentKind;
	placeId?: string | null;
	startedAt: string;
	endedAt?: string | null;
	note?: string | null;
}

export interface SegmentCorrection {
	needsReview?: false;
	startedAt?: string;
	endedAt?: string | null;
	kind?: SegmentKind;
	placeId?: string | null;
	note?: string | null;
	reason: string;
}

export interface Segment {
	id: string;
	kind: SegmentKind;
	placeId?: string | null;
	startedAt: string;
	endedAt: string | null;
	rawStartedAt: string;
	rawEndedAt: string | null;
	source: SegmentSource;
	note?: string | null;
	version: number;
	voided: boolean;
	needsReview: boolean;
	revisions?: number;
}

/** Contract v0.28.0 (W3): cancelled segments and their permanent removal. */
export interface CancelledSegment {
	segment: Segment;
	cancelledAt: string | null;
	cancelReason: string | null;
}

export interface CancelledSegmentPage {
	items: CancelledSegment[];
	total: number;
	limit: number;
	offset: number;
}

export interface PurgeSummary {
	dryRun: boolean;
	segments: number;
	revisions: number;
	suggestions: number;
	timerEvents: number;
	automationEvents: number;
}

/** Selection of `DELETE /time/segments/cancelled`; at least one of ids/from/to/all is required. */
export interface PurgeSelection {
	ids?: string[];
	from?: string;
	to?: string;
	all?: boolean;
	dryRun?: boolean;
}

export type StatisticsGranularity = 'day' | 'week' | 'month';

export interface StatisticsKinds {
	work: number;
	school: number;
	travel: number;
}

export interface StatisticsBucket {
	label: string;
	from: string;
	to: string;
	days: number;
	targetSeconds: number;
	targetToDateSeconds: number;
	actualSeconds: number;
	creditSeconds: number;
	evaluatedWorkSeconds: number;
	rawWorkSeconds: number;
	roundingSeconds: number;
	deltaSeconds: number;
	overtimeSeconds: number;
	undertimeSeconds: number;
	balanceSeconds?: number | null;
	balanceAsOf?: string | null;
	kindSeconds: StatisticsKinds;
	absences: { vacation: number; sick: number; excused: number; holiday: number; school: number };
	absenceDays: number;
	breakSeconds: number;
	breakDeductionSeconds: number;
	workDays: number;
	provisional: boolean;
}

/** Contract v0.28.0: `GET /time/statistics`. */
export interface TimeStatistics {
	from: string;
	to: string;
	granularity: StatisticsGranularity;
	basis: 'evaluated' | 'raw';
	timezone: string;
	accountStart?: string | null;
	openingBalanceSeconds?: number | null;
	includesToday?: boolean;
	/** Difference of the running day; null when today is outside from..to. */
	todayDeltaSeconds?: number | null;
	buckets: StatisticsBucket[];
	totals: {
		targetSeconds: number;
		targetToDateSeconds: number;
		actualSeconds: number;
		creditSeconds: number;
		deltaSeconds: number;
		overtimeSeconds: number;
		undertimeSeconds: number;
		breakSeconds: number;
		breakDeductionSeconds: number;
		kindSeconds: StatisticsKinds;
		absenceDays: number;
	};
}

export type DayMarkSource = 'none' | 'explicit' | 'absence' | 'holiday';

export interface DayEvaluation {
	date: string;
	modelId?: string | null;
	mark?: DayMarkKind;
	skipFixedBreaks?: boolean;
	targetSeconds: number;
	rawWorkSeconds: number;
	breakDeductionSeconds: number;
	startAdjustSeconds: number;
	endAdjustSeconds: number;
	evaluatedWorkSeconds: number;
	creditSeconds: number;
	deltaSeconds: number;
	evaluatedStart?: string | null;
	evaluatedEnd?: string | null;
	provisional: boolean;
	segmentIds: string[];
	/** Contract v0.2.1: segments of this working day (without voided ones). */
	segments?: Segment[];
	/** Contract v0.2.1: credit set on the day mark and the day note, so the form can be pre-filled. */
	markCreditSeconds?: number | null;
	/** Contract v0.3.2: origin of the effective mark (explicit = set manually). */
	markSource?: DayMarkSource;
	/** Contract v0.3.2: deviating target, e.g. half vacation day. */
	targetOverrideSeconds?: number | null;
	note?: string | null;
	breakHints: { code: BreakHintCode }[];
	legalProfileId?: LegalProfileId;
	legalWarnings?: { code: LegalWarningCode }[];
	schoolLessonCount?: number | null;
}

export interface DayPreferences {
	schoolLessonCount?: number | null;
	mark?: DayMarkKind;
	creditSeconds?: number | null;
	skipFixedBreaks?: boolean;
	note?: string | null;
	/** Contract v0.3.0: half vacation days halve the target. */
	targetOverrideSeconds?: number | null;
}

export interface TimeAccount {
	asOf: string;
	accountStart?: string | null;
	balanceSeconds: number;
	openingSeconds: number;
	adjustmentSeconds: number;
	provisional: boolean;
	/** Contract 0.36.0: always false, the running day is not in the balance. Absent on older servers (balance then includes today). */
	includesToday?: boolean;
	/** Difference of the running day (actual + credit - target); null when asOf is before today or the account has not started. */
	todayDeltaSeconds?: number | null;
}

export interface AccountAdjustmentInput {
	kind: 'opening' | 'correction';
	date: string;
	seconds: number;
	reason: string;
}

export interface AccountAdjustment extends AccountAdjustmentInput {
	id: string;
	createdAt: string;
}

export interface AccountAdjustmentPage {
	items: AccountAdjustment[];
	total: number;
	limit: number;
	offset: number;
}

export interface Suggestion {
	id: string;
	type: 'start' | 'end';
	placeId?: string | null;
	proposedStartedAt?: string | null;
	proposedEndedAt?: string | null;
	segmentId?: string | null;
	createdAt: string;
}

export interface DeviceToken {
	id: string;
	name: string;
	createdAt: string;
	expiresAt?: string | null;
	lastUsedAt?: string | null;
}

export interface DeviceTokenCreated extends DeviceToken {
	token: string;
}

export type TriggerAction = 'start' | 'stop' | 'toggle';

/** Trigger link (contract 0.26.0, ADR-0027). `token` and `path` only exist in the POST response. */
export interface TriggerLink {
	id: string;
	label: string;
	actions: TriggerAction[];
	placeId?: string | null;
	kind: SegmentKind;
	createdAt: string;
	expiresAt?: string | null;
	lastUsedAt?: string | null;
	lastAction?: TriggerAction | null;
	token?: string;
	path?: string;
}

export type CalendarFeedPart = 'absences' | 'holidays' | 'plan' | 'tracked';

/** ICS subscription (contract 0.31.0). `token` and `path` (`/ics/<token>.ics`) only exist in the POST response. */
export interface CalendarFeed {
	id: string;
	label: string;
	include: CalendarFeedPart[];
	createdAt: string;
	expiresAt?: string | null;
	lastUsedAt?: string | null;
	token?: string;
	path?: string;
}

export interface CalendarFeedInput {
	label: string;
	include?: CalendarFeedPart[];
	expiresInDays?: number;
}

export interface TriggerLinkInput {
	label: string;
	actions: TriggerAction[];
	placeId?: string | null;
	kind?: SegmentKind;
	expiresInDays?: number;
}

// --- Planning and vacation (contracts/openapi.yaml v0.3.1) ---

/** Contract 0.32.0 (N4, ADR-0029): none = work day, half = half target, full = like a public holiday. */
export type CompanyDayTreatment = 'none' | 'half' | 'full';

export interface CompanyDay {
	month: number;
	day: number;
	treatment: CompanyDayTreatment;
	/** null/empty: the server uses Heiligabend (24.12.), Silvester (31.12.) or "Betriebsfreier Tag" */
	name?: string | null;
}

export interface VacationSettings {
	/** Read-only: false while nothing is stored; GET then returns the defaults (200). */
	configured?: boolean;
	/** ISO 3166-2, e.g. DE-ST */
	region: string;
	/** half days: 30 days = 60 */
	annualEntitlementHalfDays: number;
	/** Carry-over per vacation year in half days, e.g. {"2026": 8}; missing = 0. */
	carryOverByYear?: Record<string, number>;
	/** MM-DD or null */
	carryOverExpiry?: string | null;
	/** Contract 0.32.0: GET always lists 24.12. and 31.12.; PUT without the field keeps the stored rules, with it replaces the list (max 12). */
	companyDays?: CompanyDay[];
}

export interface VacationBalance {
	year: number;
	snapshotDate?: string | null;
	/** Stored remaining days of the snapshot; entitlement and carry-over of the year are 0 then. */
	snapshotRemainingHalfDays?: number | null;
	entitlementHalfDays: number;
	carryOverHalfDays: number;
	adjustmentHalfDays: number;
	bookedHalfDays: number;
	plannedHalfDays: number;
	availableHalfDays: number;
	availableAfterPlannedHalfDays: number;
}

/** Stored vacation request form template (contract 0.25.0, B7, ADR-0026): exactly one private template per account. `mapping` is opaque JSON of at most 64 KB; without a template `exists` is false and the rest null. */
export interface VacationRequestFormInfo {
	exists: boolean;
	fileName: string | null;
	sizeBytes: number | null;
	mapping: Record<string, unknown> | null;
	updatedAt: string | null;
}

export interface VacationSnapshotEntry {
	id: string;
	date: string;
	remainingHalfDays: number;
}

export interface VacationAdjustmentEntry {
	id: string;
	date: string;
	halfDays: number;
	reason: string;
}

export interface VacationEntries {
	snapshots: VacationSnapshotEntry[];
	adjustments: VacationAdjustmentEntry[];
}

export type VacationSuggestionKind = 'bridge' | 'holiday_cluster' | 'school_holiday_extension' | 'long_break';
export type VacationConflictType = 'absence' | 'school_day' | 'plan' | 'already_vacation';

export interface VacationSuggestionConflict {
	date: string;
	type: VacationConflictType;
}

/** One ranked vacation proposal (contract 0.22.0, ADR-0025). Day amounts are whole or half days (numbers, not half-day integers). */
export interface VacationSuggestion {
	id: string;
	kind: VacationSuggestionKind;
	start: string;
	end: string;
	/** work days that cost vacation (whole days), not necessarily contiguous */
	vacationDates: string[];
	vacationDaysNeeded: number;
	totalDaysOff: number;
	efficiency: number;
	holidays: { date: string; name: string }[];
	schoolHolidays: { startDate: string; endDate: string; name: string }[];
	conflicts: VacationSuggestionConflict[];
	fitsBudget: boolean;
	remainingAfter: number;
}

export interface VacationSuggestions {
	from: string;
	to: string;
	budget: { entitlementDays: number; takenDays: number; plannedDays: number; remainingDays: number };
	suggestions: VacationSuggestion[];
}

export interface VacationSuggestionQuery {
	from?: string;
	to?: string;
	maxVacationDays?: number;
	minDaysOff?: number;
	limit?: number;
}

export type AbsenceKind = 'vacation' | 'sick' | 'excused' | 'other';
export type KnownAbsenceStatus = 'planned' | 'requested' | 'approved' | 'rejected' | 'cancelled' | 'taken' | 'recorded';
/** Contract 0.36.0 adds `recorded`; later servers may add more, so unknown strings must never break a view. */
export type AbsenceStatus = KnownAbsenceStatus | (string & {});
export type DocumentStatus = 'not_needed' | 'pending' | 'submitted';

export interface AbsenceInput {
	kind: AbsenceKind;
	startDate: string;
	endDate: string;
	halfDayStart?: boolean;
	halfDayEnd?: boolean;
	/** Optional since contract 0.36.0: the server defaults to planned (vacation) or recorded (other kinds). */
	status?: AbsenceStatus;
	note?: string | null;
	documentStatus?: DocumentStatus;
	documentSubmittedOn?: string | null;
	documentReferenceStart?: string | null;
	documentReferenceEnd?: string | null;
}

export interface Absence extends Omit<AbsenceInput, 'status'> {
	id: string;
	/** Always present on responses; unknown strings are possible (see AbsenceStatus). */
	status: AbsenceStatus;
	version: number;
	countedHalfDays: number;
	/** Stored attachments of this absence (contract 0.24.0). Absent on older servers, which the UI then counts per absence. */
	attachmentCount?: number;
}

export type CalendarDayKind = 'holiday' | 'school_holiday';

export interface CalendarDay {
	id?: string | null;
	startDate: string;
	endDate: string;
	name: string;
	kind: CalendarDayKind;
	source: 'builtin' | 'custom';
	/** Contract 0.32.0: set for company days (kind stays holiday, source builtin); older servers omit it. */
	companyTreatment?: 'half' | 'full' | null;
}

export interface CustomDayInput {
	kind: CalendarDayKind;
	startDate: string;
	endDate: string;
	name: string;
}

export type PlanMode = 'office' | 'home' | 'customer' | 'school' | 'off';

/** Contract 0.35.0 (P13, ADR-0031): kind of one plan block. */
export type PlanBlockKind = 'work' | 'school' | 'travel' | 'office' | 'home' | 'customer';

/** Contract 0.35.0: one time block of a plan day; local wall-clock "HH:mm", start < end, no overlap, max 32 per day. */
export interface PlanTimeBlock {
	start: string;
	end: string;
	kind: PlanBlockKind;
	placeId?: string | null;
	note?: string | null;
}

/** Contract 0.35.0: non-binding planning hints derived from the plan blocks (German texts in the UI). */
export type PlanHint = 'planned_break_short' | 'planned_work_stretch_long' | 'planned_break_part_short';

export interface PlanDayInput {
	mode: PlanMode;
	/** Contract 0.35.0: complete, chronological block list; wins over plannedStart/plannedEnd/plannedBreakMinutes. */
	blocks?: PlanTimeBlock[];
	placeId?: string | null;
	note?: string | null;
	/** Contract v0.17.0 (K1): rough planned window as local wall-clock "HH:mm"; both or neither, start < end. */
	plannedStart?: string | null;
	plannedEnd?: string | null;
	/** 0..600, only together with times. */
	plannedBreakMinutes?: number | null;
}

export interface PlanDay extends PlanDayInput {
	date: string;
	/** Derived by the server: end - start - break, never negative; null without times. With blocks: the sum of the block durations. */
	plannedSeconds?: number | null;
	/** Contract 0.35.0: absent on older servers. */
	planHints?: PlanHint[];
}

/** Contract v0.17.0 (K1): why a day cannot take a plan. */
export type PlanBlock = 'holiday' | 'vacation' | 'sick' | 'excused';

export interface PlanWeekDay {
	date: string;
	weekday: number;
	targetSeconds: number;
	/** Effective: 0 for a blocked day, null without a plan or times. */
	plannedSeconds: number | null;
	blockedBy: PlanBlock | null;
	plan: PlanDay | null;
}

export interface PlanWeek {
	week: string;
	from: string;
	to: string;
	days: PlanWeekDay[];
	totals: { targetSeconds: number; plannedSeconds: number; differenceSeconds: number };
}

export interface PlanWeekEntry extends PlanDayInput {
	date: string;
}

export interface PlanWeekInput {
	replace?: boolean;
	days: PlanWeekEntry[];
}

export type WeekMark = 'work' | 'school' | 'vacation' | 'sick' | 'holiday' | 'excused' | 'off';

export interface TimeWeekDay {
	date: string;
	legalProfileId?: LegalProfileId;
	legalWarnings?: { code: LegalWarningCode }[];
	breakHints?: { code: BreakHintCode }[];
	schoolLessonCount?: number | null;
	weekday: number;
	mark: WeekMark;
	/** Contract 0.31.0/0.32.0: name of a public, custom or company holiday on this date (also on free days); null without one. */
	holidayName?: string | null;
	/** Contract 0.32.0: half = mark stays work, target halved; full = mark holiday; null otherwise. */
	companyDayTreatment?: 'half' | 'full' | null;
	markSource: DayMarkSource;
	targetSeconds: number;
	plannedSeconds: number | null;
	planMode: PlanMode | null;
	/** Contract 0.35.0: the plan blocks of the day (null without a plan); absent on older servers. */
	planBlocks?: PlanTimeBlock[] | null;
	planHints?: PlanHint[];
	/** Contract 0.35.0: evaluated work + credit - effective planned seconds; null for future or blocked days or without a planned duration. */
	planActualDifferenceSeconds?: number | null;
	workSeconds: number;
	creditSeconds: number;
	rawWorkSeconds: number;
	breakSeconds: number;
	breakDeductionSeconds: number;
	travelSeconds: number;
	schoolSeconds: number;
	/** work + credit - target; null for days after today. */
	balanceSeconds: number | null;
	firstStart: string | null;
	lastEnd: string | null;
	segmentsCount: number;
	absences: { kind: AbsenceKind; status: AbsenceStatus; halfDay: boolean }[];
	provisional: boolean;
	isToday: boolean;
	isFuture: boolean;
}

export interface TimeWeekSummary {
	targetSeconds: number;
	/** Contract 0.36.0: target of the completed days (through yesterday). */
	targetToDateSeconds: number;
	workSeconds: number;
	creditSeconds: number;
	/** Contract 0.36.0: sum of the daily balances of the completed days (through yesterday). */
	balanceSeconds: number;
	includesToday?: boolean;
	/** Balance of the running day; null when the week does not contain today. */
	todayDeltaSeconds?: number | null;
	plannedSeconds: number | null;
	accountBalanceBeforeSeconds: number;
	accountBalanceAfterSeconds: number;
	accountBalanceAsOf: string;
	/** Half days count 0.5. */
	vacationDays: number;
	sickDays: number;
	schoolDays: number;
	holidayDays: number;
	workDays: number;
	travelSeconds: number;
	breakSeconds: number;
	averageStart: string | null;
	averageEnd: string | null;
	longestDay: { date: string; seconds: number } | null;
	provisional: boolean;
}

export interface TimeWeek {
	week: string;
	from: string;
	to: string;
	days: TimeWeekDay[];
	summary: TimeWeekSummary;
}

export interface ShareScopes {
	plan?: boolean;
	actual?: boolean;
	vacation?: boolean;
}

export interface Share {
	id: string;
	recipientHandle: string;
	scopes: ShareScopes;
	createdAt: string;
}

export interface IncomingShare {
	id: string;
	ownerDisplayName: string;
	scopes: ShareScopes;
}

export interface SharedView {
	/** `blocks` (contract 0.35.0) carry start, end and kind only: places and notes never reach a share view. */
	plan?: { date: string; mode: PlanMode; plannedStart?: string; plannedEnd?: string; plannedBreakMinutes?: number; plannedSeconds?: number; blocks?: { start: string; end: string; kind: PlanBlockKind }[] }[];
	actual?: { date: string; evaluatedStart?: string | null; evaluatedEnd?: string | null; evaluatedWorkSeconds: number }[];
	vacation?: { startDate: string; endDate: string }[];
}

// --- Export, import, file storage (contract v0.4.0, ADR-0006) ---

export type ExportFormat = 'xlsx' | 'pdf' | 'csv' | 'worktime-xlsx';

/** Options of the worktime workbook export (contract v0.10.0, ADR-0013); all optional, the server has defaults. */
export interface WorktimeExportOptions {
	times?: 'evaluated' | 'actual';
	pauseMinutes?: number;
	standardStart?: string;
	dateSystem?: '1900' | '1904';
}

export type ImportKind = 'csv' | 'xlsx';
export type ImportStatus = 'uploaded' | 'mapped' | 'committed' | 'rolled_back';
export type ImportDateFormat = 'dd.MM.yyyy' | 'yyyy-MM-dd' | 'excel_serial';
export type ImportTimeFormat = 'HH:mm' | 'excel_fraction' | 'decimal_hours';

export interface ImportJob {
	id: string;
	filename: string;
	kind: ImportKind;
	status: ImportStatus;
	sheets: string[];
	/** worktime_workbook when the upload looks like the yearly-sheet workbook of ADR-0013 */
	detectedProfile?: ImportProfile;
	sha256?: string;
	createdAt: string;
}

export interface ImportColumns {
	date: number;
	start?: number | null;
	end?: number | null;
	duration?: number | null;
	kind?: number | null;
	place?: number | null;
	note?: number | null;
}

export type ImportProfile = 'generic' | 'worktime_workbook';
export type WorktimeAction = 'work' | 'school' | 'vacation' | 'sick' | 'excused' | 'holiday' | 'skip';

export interface WorktimeRemarkRule {
	/** substring (case-insensitive); with ^ and $ an exact text */
	pattern: string;
	action: WorktimeAction;
}

export type HolidayTimes = 'discard' | 'keep';
export type PartialCredit = 'work' | 'absence';

export interface WorktimeOptions {
	pauseMode?: 'split' | 'none';
	/** null = value from the table (H1) */
	pauseMinutes?: number | null;
	pauseStart?: string;
	roundToMinutes?: boolean;
	/** contract v0.10.2: rows with times on public/custom holidays; discard (default) = no segments, keep = work/school (overtime) */
	holidayTimes?: HolidayTimes;
	/** contract v0.10.2: vacation/sick/excused rows whose net time differs > 5 min from the day target; work (default) = work with note */
	partialCredit?: PartialCredit;
	/** empty/missing = default rules */
	rules?: WorktimeRemarkRule[];
}

export interface WorktimePreview {
	days?: number;
	segments?: number;
	absences?: number;
	customDays?: number;
	skippedHolidays?: number;
	firstDate?: string | null;
	lastDate?: string | null;
	dateSystem?: '1900' | '1904';
	/** sum of the cached differences of the table (hint only) */
	sheetBalanceSeconds?: number | null;
	/** contract v0.10.2: only rows up to and including today (comparable with the app's time account) */
	sheetBalanceUpToTodaySeconds?: number | null;
	/** contract v0.10.2: share of the rows after today */
	sheetBalanceFutureSeconds?: number | null;
	/** contract v0.10.2: first day with times or a remark; suggestion for the start of the work model */
	firstContentDate?: string | null;
	unmappedRemarks?: { text: string; count: number }[];
	byAction?: Record<string, number>;
}

export interface ImportMapping {
	/** worktime_workbook: sheet/headerRow/columns/formats are placeholders and `worktime` is evaluated */
	profile?: ImportProfile;
	worktime?: WorktimeOptions;
	sheet: string;
	/** 1-based row number of the header row; 0 = no header row */
	headerRow: number;
	timezone?: string;
	dateFormat: ImportDateFormat;
	timeFormat: ImportTimeFormat;
	defaultKind?: SegmentKind;
	columns: ImportColumns;
	skipSummaryRows?: boolean;
}

export type ImportErrorCode =
	| 'date_invalid'
	| 'time_invalid'
	| 'end_before_start'
	| 'missing_value'
	| 'overlap'
	| 'formula_without_value'
	| 'summary_row'
	| 'unknown_place'
	| 'unknown_kind'
	| 'note_too_long'
	| 'too_many_rows'
	| 'duplicate_date_conflict'
	| 'pause_exceeds_day'
	| 'planning_disabled';

/** Warnings never block the commit (contract v0.10.2). */
export type ImportWarningCode = 'pause_exceeds_day' | 'holiday_times_discarded' | 'credit_partial_as_work' | 'school_on_holiday';
export interface ImportWarning {
	code: ImportWarningCode | ImportErrorCode;
	row?: number | null;
	/** aggregated warnings: number of affected days */
	count?: number;
}

export interface ImportPreview {
	profile?: ImportProfile;
	worktime?: WorktimePreview;
	errorCount?: number;
	rows: number;
	valid: number;
	duplicates: number;
	errors: { row: number; code: ImportErrorCode }[];
	/** contract v0.10.1: hints without commit obstacle (pause_exceeds_day); older mocks report the same code in `errors` */
	warnings?: ImportWarning[];
	sample: { date?: string; startedAt?: string; endedAt?: string; kind?: SegmentKind }[];
}

export interface ImportResult {
	batchId: string;
	created: number;
	skipped: number;
	rolledBack?: number;
	absencesCreated?: number;
	customDaysCreated?: number;
	/** rollback_conflict: plain ids (older contract) or typed entries (ADR-0013) */
	conflicts?: (string | { id: string; type?: string })[];
	/** contract v0.10.1: typed conflict list next to `conflicts` (UUIDs) */
	conflictItems?: { type: 'segment' | 'absence' | 'custom_day'; id: string }[];
	/** C23 (not yet in the contract): aggregated warnings of the commit, same shape as in the preview */
	warnings?: ImportWarning[];
}

export interface ImportTemplate {
	id: string;
	name: string;
	mapping: ImportMapping;
}

export interface RawPreview {
	sheet: string;
	rows: (string | null)[][];
}

export type StorageBackend = 'db' | 's3' | 'local';

export interface StorageRule {
	/** upper bound (inclusive); null = everything above / the rest */
	maxBytes?: number | null;
	backend: StorageBackend;
}

export interface StorageS3 {
	endpoint?: string;
	region?: string;
	bucket?: string;
	pathStyle?: boolean;
	accessKeyId?: string;
}

export interface StorageSettings {
	rules: StorageRule[];
	maxUploadBytes: number;
	localPath?: string | null;
	s3?: StorageS3 | null;
	hasSecret: boolean;
}

export interface StorageSettingsInput {
	rules: StorageRule[];
	maxUploadBytes?: number;
	localPath?: string | null;
	s3?: (StorageS3 & { secretAccessKey?: string }) | null;
}

export interface FileMeta {
	id: string;
	name: string;
	size: number;
	sha256: string;
	contentType: string;
	backend: StorageBackend;
	createdAt: string;
}

export interface DownloadedFile {
	blob: Blob;
	/** filename from Content-Disposition, if the server sent one */
	filename: string | null;
}

/** GET /auth/oidc/config (contract v0.5.0). `name` is the provider display name. */
export interface OidcConfig {
	enabled: boolean;
	name?: string;
}

export type OidcPurpose = 'login' | 'link' | 'register';

/** Error codes the callback puts into `/login?oidc_error=<code>`. */
export const OIDC_ERROR_CODES = [
	'oidc_not_linked',
	'oidc_state_invalid',
	'oidc_token_invalid',
	'oidc_identity_taken',
	'oidc_invite_invalid',
	'oidc_reauth_required',
	'oidc_failed'
] as const;
export type OidcErrorCode = (typeof OIDC_ERROR_CODES)[number];

export interface OidcRegisterInput {
	pendingId: string;
	handle: string;
	displayName: string;
}

export interface ExternalIdentity {
	id: string;
	providerName: string;
	/** Provider e-mail, display hint only, never a linking criterion. */
	emailHint?: string | null;
	linkedAt: string;
	lastUsedAt?: string | null;
}

// Berichtsheft (contract v0.6.0, ADR-0008)
export interface LearningFieldInput {
	number?: number | null;
	name: string;
	sortOrder?: number;
}

export interface LearningField extends LearningFieldInput {
	id: string;
}

export interface ReportEntryInput {
	date: string;
	learningFieldId?: string | null;
	/** name snapshot; with learningFieldId the server takes over the current name */
	learningField: string;
	durationSeconds?: number;
	notes?: string;
}

export interface ReportEntry extends ReportEntryInput {
	id: string;
	version: number;
	createdAt: string;
	/** true for later AI-created, not yet confirmed drafts */
	draft?: boolean;
}

export type ReportStatus = 'draft' | 'done';

export interface ReportWeek {
	year: number;
	week: number;
	startDate: string;
	endDate: string;
	status: ReportStatus;
	entries: ReportEntry[];
	totalSeconds: number;
	byLearningField: { learningField: string; seconds: number }[];
	/** evaluated working time of the week from time tracking; a hint only */
	trackedWorkSeconds?: number;
	sourceCount: number;
}

export interface ReportSourceInput {
	year: number;
	week: number;
	date?: string | null;
	note?: string | null;
	fileId?: string | null;
}

export interface ReportSource extends ReportSourceInput {
	id: string;
	createdAt: string;
	file?: FileMeta | null;
}

/** Scopes of the MCP server (ADR-0009). */
export type McpScope = 'time:read' | 'time:write' | 'schedule:read' | 'schedule:write' | 'reports:read' | 'reports:write' | 'documents:read';

/** GET oauth/requests/{id} (contract v0.7.0): consent data for the signed-in person. */
export interface OAuthRequest {
	id: string;
	clientName: string;
	redirectHost: string;
	scopes: McpScope[];
	expiresAt: string;
}

export interface OAuthGrant {
	id: string;
	clientName: string;
	scopes: McpScope[];
	createdAt: string;
	lastUsedAt?: string | null;
}

export interface ApiToken {
	id: string;
	name: string;
	scopes: McpScope[];
	createdAt: string;
	expiresAt: string;
	lastUsedAt?: string | null;
}

/** POST me/api-tokens: the plaintext `token` is only in this response. */
export interface ApiTokenCreated extends ApiToken {
	token: string;
}

export interface ApiTokenInput {
	name: string;
	scopes: McpScope[];
	expiresInDays: number;
}

// Notifications and Web Push, contract v0.8.0 (ADR-0010)
export const NOTIFICATION_CATEGORIES = ['running_timer', 'pending_suggestions', 'report_gap', 'document_submission'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationKind = NotificationCategory | 'system';

export interface AppNotification {
	id: string;
	kind: NotificationKind;
	title: string;
	body: string;
	/** relative PWA path (`/`, `/reports`, `/absences`) */
	url?: string | null;
	createdAt: string;
	read: boolean;
}

export interface NotificationList {
	items: AppNotification[];
	unreadCount: number;
}

export interface NotificationCategorySettings {
	inApp: boolean;
	push: boolean;
	/** running_timer only: 30..1440 */
	thresholdMinutes?: number;
	/** report_gap only: ISO weekday 1 (Monday) .. 7 */
	weekday?: number;
	/** report_gap only: local HH:mm */
	time?: string;
}

export interface NotificationSettings {
	categories: Partial<Record<NotificationCategory, NotificationCategorySettings>>;
	quietStart?: string | null;
	quietEnd?: string | null;
}

export interface PushConfig {
	available: boolean;
	/** base64url uncompressed P-256 public key */
	vapidPublicKey?: string;
}

export interface PushSubscriptionInfo {
	id: string;
	host?: string;
	userAgent?: string | null;
	createdAt: string;
	lastSuccessAt?: string | null;
}

export interface PushSubscriptionInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string;
}

// --- Module switches (contract v0.9.0, ADR-0012) ---

export const MODULE_KEYS = ['reports', 'planning', 'transfer', 'automation', 'mcp'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleStatus {
	key: ModuleKey;
	serverEnabled: boolean;
	accountEnabled: boolean;
	/** serverEnabled && accountEnabled: the only flag that decides whether the module is visible */
	effective: boolean;
	/** switched off by the operator via environment; cannot be changed in the UI */
	lockedByOperator: boolean;
}

export interface ServerModule {
	key: ModuleKey;
	enabled: boolean;
	lockedByOperator: boolean;
}

/** E-mail diagnosis (contract v0.18.0, ADR-0022). The settings come from the server environment and are read-only. */
export interface MailHint {
	severity: 'info' | 'warning';
	code: string;
	message: string;
}

export interface MailStatus {
	configured: boolean;
	host?: string;
	port?: number;
	tls?: 'starttls' | 'implicit' | 'off';
	fromAddress?: string;
	fromName?: string;
	/** user name and password are set; the values are never returned */
	authConfigured: boolean;
	source: 'environment';
	hints: MailHint[];
}

export interface MailCheckCertificate {
	subject?: string;
	issuer?: string;
	validFrom: string;
	validUntil: string;
	daysLeft: number;
	hostnameMatches: boolean;
}

export type MailStepId = 'dns' | 'tcp' | 'tls' | 'ehlo' | 'auth' | 'mailFrom';

export interface MailCheckStep {
	id: MailStepId;
	title: string;
	status: 'ok' | 'failed' | 'skipped';
	durationMs: number;
	details: string[];
	warnings: string[];
	certificate?: MailCheckCertificate;
	problem?: { code: string; message: string; advice: string };
}

export interface MailCheckResult {
	ok: boolean;
	summary: string;
	checkedAt: string;
	totalMs: number;
	steps: MailCheckStep[];
}

export interface MailTestResult {
	sent: boolean;
	to: string;
	durationMs: number;
}

/** GET /system/info (contract v0.19.0, ADR-0023): version and build data of server and the PWA it serves. */
export interface SystemInfo {
	backend: {
		version: string;
		revision: string;
		revisionShort: string;
		buildDate: string | null;
		apiVersion: string;
		/** Operator details (contract v0.23.0): present for admins only, absent for normal members. */
		database?: 'mariadb' | 'sqlite';
		schemaMigrations?: number;
		migrationsPending?: boolean;
		uptimeSeconds?: number;
		replicaId?: string;
	};
	pwa: { version: string | null; revision: string | null; buildDate: string | null } | null;
}
