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
