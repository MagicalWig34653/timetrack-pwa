// Hand-written types mirroring contracts/openapi.yaml in the backend repository (API v0.1.0).

export type Role = 'admin' | 'member';

export interface Account {
	id: string;
	handle: string;
	displayName: string;
	role: Role;
}

export interface Session {
	account: Account;
	csrfToken: string;
	/** true = restricted recovery session (only passkey setup and session revocation allowed) */
	recovery: boolean;
	expiresAt?: string;
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
	email: { available: boolean; active: boolean; verified?: boolean };
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
export type DayMarkKind = 'none' | 'holiday' | 'vacation' | 'sick' | 'school_credit';
export type PlaceKind = 'office' | 'home' | 'customer' | 'school' | 'other';
export type AutomationMode = 'direct' | 'suggest' | 'off';
export type BreakHintCode = 'break_missing_30' | 'break_missing_45' | 'break_part_too_short' | 'work_over_6h_without_break';

export interface FixedBreak {
	start: string;
	end: string;
}

export interface WorkModelInput {
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
	note?: string | null;
	breakHints: { code: BreakHintCode }[];
}

export interface DayPreferences {
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
}

export interface AccountAdjustmentInput {
	kind: 'opening' | 'correction';
	date: string;
	seconds: number;
	reason: string;
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

// --- Planning and vacation (contracts/openapi.yaml v0.3.1) ---

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

export type AbsenceKind = 'vacation' | 'sick' | 'other';
export type AbsenceStatus = 'planned' | 'requested' | 'approved' | 'rejected' | 'cancelled' | 'taken';
export type DocumentStatus = 'not_needed' | 'pending' | 'submitted';

export interface AbsenceInput {
	kind: AbsenceKind;
	startDate: string;
	endDate: string;
	halfDayStart?: boolean;
	halfDayEnd?: boolean;
	status: AbsenceStatus;
	note?: string | null;
	documentStatus?: DocumentStatus;
	documentSubmittedOn?: string | null;
	documentReferenceStart?: string | null;
	documentReferenceEnd?: string | null;
}

export interface Absence extends AbsenceInput {
	id: string;
	version: number;
	countedHalfDays: number;
}

export type CalendarDayKind = 'holiday' | 'school_holiday';

export interface CalendarDay {
	id?: string | null;
	startDate: string;
	endDate: string;
	name: string;
	kind: CalendarDayKind;
	source: 'builtin' | 'custom';
}

export interface CustomDayInput {
	kind: CalendarDayKind;
	startDate: string;
	endDate: string;
	name: string;
}

export type PlanMode = 'office' | 'home' | 'customer' | 'school' | 'off';

export interface PlanDayInput {
	mode: PlanMode;
	placeId?: string | null;
	note?: string | null;
}

export interface PlanDay extends PlanDayInput {
	date: string;
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
	plan?: { date: string; mode: PlanMode }[];
	actual?: { date: string; evaluatedStart?: string | null; evaluatedEnd?: string | null; evaluatedWorkSeconds: number }[];
	vacation?: { startDate: string; endDate: string }[];
}
