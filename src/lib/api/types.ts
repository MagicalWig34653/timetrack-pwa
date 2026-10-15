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

// --- Export, import, file storage (contract v0.4.0, ADR-0006) ---

export type ExportFormat = 'xlsx' | 'pdf' | 'csv';

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

export interface ImportMapping {
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
	| 'unknown_place';

export interface ImportPreview {
	rows: number;
	valid: number;
	duplicates: number;
	errors: { row: number; code: ImportErrorCode }[];
	sample: { date?: string; startedAt?: string; endedAt?: string; kind?: SegmentKind }[];
}

export interface ImportResult {
	batchId: string;
	created: number;
	skipped: number;
	conflicts?: string[];
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
