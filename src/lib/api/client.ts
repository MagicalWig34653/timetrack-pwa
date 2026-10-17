import { splitRange } from '../time/dates';
import { pwa } from '../pwa/pwa.svelte';
import { ApiError } from './errors';
import type {
	MailCheckResult,
	MailStatus,
	MailTestResult,
	AdminAccount,
	AdminAccountPage,
	AdminAccountPatch,
	NotificationList,
	NotificationSettings,
	PushConfig,
	PushSubscriptionInfo,
	PushSubscriptionInput,
	DownloadedFile,
	ExportFormat,
	WorktimeExportOptions,
	WorktimeRemarkRule,
	FileMeta,
	ImportJob,
	ImportMapping,
	ImportPreview,
	ImportResult,
	ImportTemplate,
	RawPreview,
	StorageSettings,
	StorageSettingsInput,
	LearningField,
	LearningFieldInput,
	ReportEntry,
	ReportEntryInput,
	ReportSource,
	ReportSourceInput,
	ReportStatus,
	ReportWeek,
	Absence,
	AbsenceInput,
	AccountAdjustmentInput,
	CalendarDay,
	CustomDayInput,
	IncomingShare,
	PlanDay,
	PlanDayInput,
	PlanWeek,
	PlanWeekInput,
	TimeWeek,
	Share,
	ShareScopes,
	SharedView,
	VacationBalance,
	VacationEntries,
	VacationSettings,
	OnboardingState,
	Preferences,
	PreferencesPatch,
	Profile,
	CreationOptions,
	DayEvaluation,
	DayPreferences,
	DeviceToken,
	DeviceTokenCreated,
	Place,
	PlaceInput,
	Segment,
	SegmentCorrection,
	SegmentInput,
	SegmentKind,
	Suggestion,
	TimeAccount,
	WorkModel,
	WorkModelInput,
	WorkModelPreview,
	Invitation,
	ModuleKey,
	ModuleStatus,
	ServerModule,
	ExternalIdentity,
	ApiToken,
	ApiTokenCreated,
	ApiTokenInput,
	McpScope,
	OAuthGrant,
	OAuthRequest,
	OidcConfig,
	OidcPurpose,
	OidcRegisterInput,
	InvitationCreated,
	Passkey,
	RecoveryMethod,
	RecoveryStatus,
	RegisterInput,
	RequestOptions,
	Session
} from './types';

export { ApiError } from './errors';

const BASE = '/api/v1';

let csrfToken: string | null = null;

/** fetch that tells the offline banner whether the network is reachable (any HTTP response counts as reachable). */
async function netFetch(input: string, init: RequestInit): Promise<Response> {
	try {
		const response = await fetch(input, init);
		pwa.reportNetwork(true);
		return response;
	} catch (error) {
		pwa.reportNetwork(false);
		throw error;
	}
}

let moduleDisabledHandler: (() => void) | null = null;

/** Registers the callback that runs when any call answers 404 module_disabled (the module store refreshes itself). */
export function setModuleDisabledHandler(handler: (() => void) | null): void {
	moduleDisabledHandler = handler;
}

export function setCsrfToken(token: string | null): void {
	csrfToken = token;
	invalidateReadCache();
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function toApiError(response: Response): Promise<ApiError> {
	let code = `http_${response.status}`;
	let message = response.statusText;
	let body: unknown;
	try {
		body = await response.json();
		const payload = body as { error?: { code?: unknown; message?: unknown } };
		if (payload?.error?.code) code = String(payload.error.code);
		if (payload?.error?.message) message = String(payload.error.message);
	} catch {
		// non-JSON error body (e.g. proxy error page): keep the generic code
	}
	if (response.status === 404 && code === 'module_disabled') moduleDisabledHandler?.();
	return new ApiError(response.status, code, message, body);
}

/** Extracts the filename from a Content-Disposition header (RFC 6266: filename* wins over filename). */
export function filenameFromDisposition(header: string | null): string | null {
	if (!header) return null;
	const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
	if (star) {
		try {
			return decodeURIComponent(star[1].trim());
		} catch {
			// fall through to the plain filename
		}
	}
	const plain = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(header) ?? /filename\s*=\s*([^;]+)/.exec(header);
	return plain ? plain[1].trim().replace(/\\(.)/g, '$1') : null;
}

/** Binary download (GET); errors are parsed like JSON errors. */
async function download(path: string): Promise<DownloadedFile> {
	let response: Response;
	try {
		response = await netFetch(BASE + path, { method: 'GET', credentials: 'include' });
	} catch {
		throw new ApiError(0, 'network_error');
	}
	if (!response.ok) throw await toApiError(response);
	return { blob: await response.blob(), filename: filenameFromDisposition(response.headers.get('Content-Disposition')) };
}

/** multipart/form-data upload with field `file`; the browser sets the boundary, so no Content-Type header here. */
async function upload<T>(path: string, file: File): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
	const form = new FormData();
	form.append('file', file, file.name);
	let response: Response;
	try {
		response = await netFetch(BASE + path, { method: 'POST', headers, credentials: 'include', body: form });
	} catch {
		throw new ApiError(0, 'network_error');
	}
	if (!response.ok) throw await toApiError(response);
	invalidateReadCache();
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

/** text/plain GET (report text output). */
async function requestText(path: string): Promise<string> {
	let response: Response;
	try {
		response = await netFetch(BASE + path, { method: 'GET', headers: { Accept: 'text/plain' }, credentials: 'include' });
	} catch {
		throw new ApiError(0, 'network_error');
	}
	if (!response.ok) throw await toApiError(response);
	return response.text();
}

/** Backoff before the 2nd and 3rd attempt of a GET. Tests set it to [] via setRetryDelays. */
let RETRY_DELAYS_MS: number[] = [400, 1200];
export function setRetryDelays(delays: number[]): void {
	RETRY_DELAYS_MS = delays;
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isTransientStatus = (status: number) => status === 502 || status === 503 || status === 504;

/** Short-lived cache for expensive, rarely changing reads (time account); any successful write clears it. */
const readCache = new Map<string, { at: number; value: Promise<unknown> }>();
const READ_CACHE_TTL_MS = 30_000;
export function invalidateReadCache(): void {
	readCache.clear();
}
function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
	const hit = readCache.get(key);
	if (hit && Date.now() - hit.at < READ_CACHE_TTL_MS) return hit.value as Promise<T>;
	const value = load();
	readCache.set(key, { at: Date.now(), value });
	value.catch(() => readCache.delete(key));
	return value;
}

async function request<T>(
	method: Method,
	path: string,
	body?: unknown,
	extraHeaders: Record<string, string> = {}
): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
	if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	// Idempotent reads are retried a bounded number of times on transient failures (network drop, 502/503/504 from the
	// proxy or a replacing container, or a 500 `not_ready` while the server is busy), so a hiccup is invisible to the user.
	const attempts = method === 'GET' ? RETRY_DELAYS_MS.length + 1 : 1;
	let response: Response | undefined;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const last = attempt === attempts - 1;
		try {
			response = await netFetch(BASE + path, {
				method,
				headers,
				credentials: 'include',
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		} catch {
			if (last) throw new ApiError(0, 'network_error');
			await sleep(RETRY_DELAYS_MS[attempt]);
			continue;
		}
		if (!last && isTransientStatus(response.status)) {
			await sleep(RETRY_DELAYS_MS[attempt]);
			continue;
		}
		break;
	}
	if (!response) throw new ApiError(0, 'network_error');

	if (!response.ok) throw await toApiError(response);
	if (method !== 'GET') invalidateReadCache();
	// 204 and bodyless 202 (e.g. PUT /me/recovery/email) carry no JSON.
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

/** Session-returning calls refresh the CSRF token held by the client. */
async function sessionRequest(method: Method, path: string, body?: unknown): Promise<Session> {
	const session = await request<Session>(method, path, body);
	setCsrfToken(session.csrfToken);
	return session;
}

/** Contract v0.3.1: absences, plan/days and shared views take at most 366 days, time/days at most 93 (else 400 range_too_large). */
export const MAX_DAYS_RANGE = 366;
export const MAX_DAYS_EVALUATIONS = 93;

/** Concatenates the scopes of chunked shared views; a scope missing in all parts stays missing. */
export function mergeSharedViews(parts: SharedView[]): SharedView {
	const merged: SharedView = {};
	for (const part of parts) {
		if (part.plan) merged.plan = [...(merged.plan ?? []), ...part.plan];
		if (part.actual) merged.actual = [...(merged.actual ?? []), ...part.actual];
		if (part.vacation) {
			// A vacation spanning a chunk border may arrive in both parts; merge overlapping periods.
			const all = [...(merged.vacation ?? []), ...part.vacation].sort((a, b) => a.startDate.localeCompare(b.startDate));
			merged.vacation = [];
			for (const v of all) {
				const last = merged.vacation.at(-1);
				if (last && v.startDate <= last.endDate) last.endDate = v.endDate > last.endDate ? v.endDate : last.endDate;
				else merged.vacation.push({ ...v });
			}
		}
	}
	return merged;
}

export const api = {
	// sessions
	currentSession: () => sessionRequest('GET', '/auth/session'),
	async logout(): Promise<void> {
		await request<void>('DELETE', '/auth/session');
		setCsrfToken(null);
	},
	revokeOtherSessions: () => request<void>('DELETE', '/me/sessions'),

	// account administration and privacy (contract v0.11.0, ADR-0016)
	listAccounts: (limit: number, offset: number) => request<AdminAccountPage>('GET', `/admin/accounts?limit=${limit}&offset=${offset}`),
	updateAccount: (id: string, patch: AdminAccountPatch) => request<AdminAccount>('PATCH', `/admin/accounts/${id}`, patch),
	revokeAccountSessions: (id: string) => request<void>('DELETE', `/admin/accounts/${id}/sessions`),
	deleteAccount: (id: string, confirmHandle: string) => request<void>('DELETE', `/admin/accounts/${id}`, { confirmHandle }),
	exportMyData: () => download('/me/export'),
	/** Self-deletion; the server clears the cookie, so the client forgets its CSRF token afterwards. */
	async deleteMyAccount(confirmHandle: string): Promise<void> {
		try {
			await request<void>('DELETE', '/me', { confirmHandle });
		} catch (error) {
			// 503 account_deletion_incomplete: the session is revoked as well
			if (error instanceof ApiError && error.status === 503) setCsrfToken(null);
			throw error;
		}
		setCsrfToken(null);
	},

	// profile and guided setup (contract v0.13.0, ADR-0019)
	getProfile: () => request<Profile>('GET', '/me/profile'),
	updateProfile: (displayName: string) => request<Profile>('PATCH', '/me/profile', { displayName }),
	requestEmailChange: (email: string) => request<void>('PUT', '/me/profile/email', { email }),
	verifyEmailChange: (code: string) => request<Profile>('POST', '/me/profile/email/verify', { code }),
	removeProfileEmail: () => request<void>('DELETE', '/me/profile/email'),
	setOnboarding: (state: OnboardingState) => request<Profile>('PUT', '/me/onboarding', { state }),

	// appearance preferences per account (contract v0.14.0, ADR-0020)
	getPreferences: () => request<Preferences>('GET', '/me/preferences'),
	updatePreferences: (patch: PreferencesPatch) => request<Preferences>('PATCH', '/me/preferences', patch),

	// invitations and registration
	inspectInvitation: (token: string) =>
		request<{ valid: true; expiresAt?: string }>('GET', `/invitations/${encodeURIComponent(token)}`),
	registerOptions: (input: RegisterInput) =>
		request<CreationOptions>('POST', '/auth/register/options', input),
	registerVerify: (challengeId: string, credential: unknown, passkeyName?: string) =>
		sessionRequest('POST', '/auth/register/verify', { challengeId, credential, passkeyName }),

	// login
	loginOptions: () => request<RequestOptions>('POST', '/auth/login/options'),
	loginVerify: (challengeId: string, credential: unknown) =>
		sessionRequest('POST', '/auth/login/verify', { challengeId, credential }),

	// optional OpenID Connect (contract v0.5.0)
	oidcConfig: () => request<OidcConfig>('GET', '/auth/oidc/config'),
	oidcStart: (purpose: OidcPurpose, inviteToken?: string) =>
		request<{ authorizationUrl: string }>('POST', '/auth/oidc/start', { purpose, inviteToken }),
	oidcRegister: (input: OidcRegisterInput) => sessionRequest('POST', '/auth/oidc/register', input),
	listIdentities: () => request<ExternalIdentity[]>('GET', '/me/identities'),
	unlinkIdentity: (id: string) => request<void>('DELETE', `/me/identities/${id}`),
	// MCP/OAuth (contract v0.7.0, ADR-0009)
	getOAuthRequest: (id: string) => request<OAuthRequest>('GET', `/oauth/requests/${encodeURIComponent(id)}`),
	decideOAuthRequest: (id: string, approve: boolean, scopes?: McpScope[]) =>
		request<{ redirectUrl: string }>('POST', `/oauth/requests/${encodeURIComponent(id)}/decision`, approve ? { approve, scopes } : { approve }),
	listOAuthGrants: () => request<OAuthGrant[]>('GET', '/me/oauth-grants'),
	revokeOAuthGrant: (id: string) => request<void>('DELETE', `/me/oauth-grants/${id}`),
	listApiTokens: () => request<ApiToken[]>('GET', '/me/api-tokens'),
	createApiToken: (input: ApiTokenInput) => request<ApiTokenCreated>('POST', '/me/api-tokens', input),
	revokeApiToken: (id: string) => request<void>('DELETE', `/me/api-tokens/${id}`),

	// passkeys
	listPasskeys: () => request<Passkey[]>('GET', '/me/passkeys'),
	addPasskeyOptions: () => request<CreationOptions>('POST', '/me/passkeys/options'),
	addPasskeyVerify: (challengeId: string, credential: unknown, passkeyName?: string) =>
		request<Passkey>('POST', '/me/passkeys/verify', { challengeId, credential, passkeyName }),
	renamePasskey: (id: string, name: string) =>
		request<Passkey>('PATCH', `/me/passkeys/${id}`, { name }),
	revokePasskey: (id: string) => request<void>('DELETE', `/me/passkeys/${id}`),

	// recovery setup
	recoveryStatus: () => request<RecoveryStatus>('GET', '/me/recovery'),
	generateRecoveryCodes: () =>
		request<{ codes: string[] }>('POST', '/me/recovery/recovery-codes'),
	disableRecoveryCodes: () => request<void>('DELETE', '/me/recovery/recovery-codes'),
	setFallbackPassword: (password: string) =>
		request<void>('PUT', '/me/recovery/fallback-password', { password }),
	removeFallbackPassword: () => request<void>('DELETE', '/me/recovery/fallback-password'),
	enableEmailRecovery: (email: string) => request<void>('PUT', '/me/recovery/email', { email }),
	disableEmailRecovery: () => request<void>('DELETE', '/me/recovery/email'),
	verifyRecoveryEmail: (code: string) =>
		request<void>('POST', '/me/recovery/email/verify', { code }),

	// recovery flow (unauthenticated)
	recoveryStart: (method: RecoveryMethod, identifier: string) =>
		request<{ recoveryId: string }>('POST', '/auth/recovery/start', { method, identifier }),
	recoveryComplete: (recoveryId: string, proof: string) =>
		sessionRequest('POST', '/auth/recovery/complete', { recoveryId, proof }),

	// admin
	listInvitations: () => request<Invitation[]>('GET', '/admin/invitations'),
	createInvitation: (input: { expiresInHours?: number; note?: string }) =>
		request<InvitationCreated>('POST', '/admin/invitations', input),
	revokeInvitation: (id: string) => request<void>('DELETE', `/admin/invitations/${id}`),

	// work models
	listWorkModels: () => request<WorkModel[]>('GET', '/work-models'),
	createWorkModel: (input: WorkModelInput) => request<WorkModel>('POST', '/work-models', input),
	/** Contract v0.16.0: replaces every editable field of one version (the evaluation of its days changes). */
	correctWorkModel: (id: string, input: WorkModelInput, version?: number) =>
		request<WorkModel>('PUT', `/work-models/${id}`, input, version === undefined ? undefined : { 'If-Match': String(version) }),
	previewWorkModel: (id: string, input: WorkModelInput) => request<WorkModelPreview>('POST', `/work-models/${id}/preview`, input),
	endWorkModel: (id: string, validTo: string) => request<WorkModel>('PATCH', `/work-models/${id}`, { validTo }),

	// places
	listPlaces: () => request<Place[]>('GET', '/places'),
	createPlace: (input: PlaceInput) => request<Place>('POST', '/places', input),
	updatePlace: (id: string, input: PlaceInput) => request<Place>('PUT', `/places/${id}`, input),
	archivePlace: (id: string) => request<void>('DELETE', `/places/${id}`),

	// segments and timer; `ifMatchVersion` becomes the If-Match header
	listSegments: (from: string, to: string, includeVoided = false) =>
		request<Segment[]>(
			'GET',
			`/time/segments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${includeVoided ? '&includeVoided=true' : ''}`
		),
	createSegment: (input: SegmentInput) => request<Segment>('POST', '/time/segments', input),
	correctSegment: (id: string, input: SegmentCorrection, ifMatchVersion: number) =>
		request<Segment>('PATCH', `/time/segments/${id}`, input, { 'If-Match': String(ifMatchVersion) }),
	voidSegment: (id: string, reason: string) =>
		request<void>('DELETE', `/time/segments/${id}?reason=${encodeURIComponent(reason)}`),
	currentTimer: () => request<Segment | null>('GET', '/time/timer'),
	startTimer: (input: { clientEventId: string; kind?: SegmentKind; placeId?: string | null }) =>
		request<Segment>('POST', '/time/timer/start', input),
	stopTimer: (input: { clientEventId: string }) => request<Segment>('POST', '/time/timer/stop', input),

	// day evaluations and time account
	/** time/days allows at most 93 days per request (range_too_large); longer ranges are loaded in chunks. */
	listDays: async (from: string, to: string) =>
		(await Promise.all(splitRange(from, to, MAX_DAYS_EVALUATIONS).map((r) => request<DayEvaluation[]>('GET', `/time/days?from=${r.from}&to=${r.to}`)))).flat(),
	getDay: (date: string) => request<DayEvaluation>('GET', `/time/days/${date}`),
	setDayPreferences: (date: string, input: DayPreferences) =>
		request<DayEvaluation>('PUT', `/time/days/${date}`, input),
	getTimeAccount: (asOf?: string) =>
		cachedRead(`account:${asOf ?? ''}`, () => request<TimeAccount>('GET', `/time/account${asOf ? `?asOf=${asOf}` : ''}`)),
	createAccountAdjustment: (input: AccountAdjustmentInput) =>
		request<TimeAccount>('POST', '/time/account/adjustments', input),

	// suggestions
	listSuggestions: () => request<Suggestion[]>('GET', '/time/suggestions'),
	acceptSuggestion: (id: string, times: { startedAt?: string; endedAt?: string } = {}) =>
		request<Segment>('POST', `/time/suggestions/${id}/accept`, times),
	rejectSuggestion: (id: string) => request<void>('POST', `/time/suggestions/${id}/reject`),

	// device tokens
	listDeviceTokens: () => request<DeviceToken[]>('GET', '/me/device-tokens'),
	createDeviceToken: (input: { name: string; expiresInDays?: number }) =>
		request<DeviceTokenCreated>('POST', '/me/device-tokens', input),
	revokeDeviceToken: (id: string) => request<void>('DELETE', `/me/device-tokens/${id}`),

	// vacation (contract v0.3.1); amounts are half days; GET settings answers 200 with `configured: false` until saved
	getVacationSettings: () => request<VacationSettings>('GET', '/vacation/settings'),
	putVacationSettings: (input: VacationSettings) => request<VacationSettings>('PUT', '/vacation/settings', input),
	getVacationBalance: (year: number) => request<VacationBalance>('GET', `/vacation/balance?year=${year}`),
	createVacationSnapshot: (input: { date: string; remainingHalfDays: number }) =>
		request<VacationBalance>('POST', '/vacation/snapshots', input),
	createVacationAdjustment: (input: { date: string; halfDays: number; reason: string }) =>
		request<VacationBalance>('POST', '/vacation/adjustments', input),

	listVacationEntries: (year: number) => request<VacationEntries>('GET', `/vacation/entries?year=${year}`),
	deleteVacationEntry: (id: string) => request<void>('DELETE', `/vacation/entries/${id}`),

	// absences; `ifMatchVersion` becomes the If-Match header; ranges above 366 days are loaded in chunks
	listAbsences: async (from: string, to: string) =>
		(await Promise.all(splitRange(from, to, MAX_DAYS_RANGE).map((r) => request<Absence[]>('GET', `/absences?from=${r.from}&to=${r.to}`)))).flat(),
	getAbsence: (id: string) => request<Absence>('GET', `/absences/${id}`),
	createAbsence: (input: AbsenceInput) => request<Absence>('POST', '/absences', input),
	updateAbsence: (id: string, input: AbsenceInput, ifMatchVersion: number) =>
		request<Absence>('PUT', `/absences/${id}`, input, { 'If-Match': String(ifMatchVersion) }),
	deleteAbsence: (id: string) => request<void>('DELETE', `/absences/${id}`),

	// calendar and plan
	listHolidays: (year: number, region?: string) =>
		request<CalendarDay[]>('GET', `/calendar/holidays?year=${year}${region ? `&region=${encodeURIComponent(region)}` : ''}`),
	createCustomDay: (input: CustomDayInput) => request<CalendarDay>('POST', '/calendar/custom-days', input),
	deleteCustomDay: (id: string) => request<void>('DELETE', `/calendar/custom-days/${id}`),
	listPlanDays: async (from: string, to: string) =>
		(await Promise.all(splitRange(from, to, MAX_DAYS_RANGE).map((r) => request<PlanDay[]>('GET', `/plan/days?from=${r.from}&to=${r.to}`)))).flat(),
	putPlanDay: (date: string, input: PlanDayInput) => request<PlanDay>('PUT', `/plan/days/${date}`, input),
	deletePlanDay: (date: string) => request<void>('DELETE', `/plan/days/${date}`),
	/** Contract v0.17.0 (K1): `isoWeek` like 2026-W44. */
	getPlanWeek: (isoWeek: string) => request<PlanWeek>('GET', `/plan/weeks/${isoWeek}`),
	putPlanWeek: (isoWeek: string, input: PlanWeekInput) => request<PlanWeek>('PUT', `/plan/weeks/${isoWeek}`, input),
	getTimeWeek: (isoWeek: string) => cachedRead(`week:${isoWeek}`, () => request<TimeWeek>('GET', `/time/weeks/${isoWeek}`)),

	// shares
	listShares: () => request<Share[]>('GET', '/shares'),
	createShare: (input: { recipientHandle: string; scopes: ShareScopes }) => request<Share>('POST', '/shares', input),
	updateShare: (id: string, scopes: ShareScopes) => request<Share>('PATCH', `/shares/${id}`, { scopes }),
	revokeShare: (id: string) => request<void>('DELETE', `/shares/${id}`),
	listIncomingShares: () => request<IncomingShare[]>('GET', '/shares/incoming'),
	viewShared: async (shareId: string, from: string, to: string): Promise<SharedView> => {
		const parts = await Promise.all(splitRange(from, to, MAX_DAYS_RANGE).map((r) => request<SharedView>('GET', `/shares/incoming/${shareId}/view?from=${r.from}&to=${r.to}`)));
		return mergeSharedViews(parts);
	},

	// export, contract v0.4.0: the file comes as an attachment (blob); at most 366 days (else 400 range_too_large)
	exportTime: (from: string, to: string, format: ExportFormat, options: WorktimeExportOptions = {}) => {
		const query = new URLSearchParams({ from, to, format });
		if (format === 'worktime-xlsx') {
			if (options.times) query.set('times', options.times);
			if (options.pauseMinutes !== undefined) query.set('pauseMinutes', String(options.pauseMinutes));
			if (options.standardStart) query.set('standardStart', options.standardStart);
			if (options.dateSystem) query.set('dateSystem', options.dateSystem);
		}
		return download(`/export/time?${query.toString()}`);
	},
	worktimeDefaultRules: () => request<WorktimeRemarkRule[]>('GET', '/import-profiles/worktime/default-rules'),

	// import (CSV/XLSX -> segments); nothing is written before commitImport
	uploadImport: (file: File) => upload<ImportJob>('/imports', file),
	getImport: (id: string) => request<ImportJob>('GET', `/imports/${id}`),
	discardImport: (id: string) => request<void>('DELETE', `/imports/${id}`),
	previewImportRows: (id: string, sheet?: string) =>
		request<RawPreview>('GET', `/imports/${id}/preview${sheet ? `?sheet=${encodeURIComponent(sheet)}` : ''}`),
	putImportMapping: (id: string, mapping: ImportMapping) => request<ImportPreview>('PUT', `/imports/${id}/mapping`, mapping),
	commitImport: (id: string, ignoreErrors = false) => request<ImportResult>('POST', `/imports/${id}/commit`, { ignoreErrors }),
	rollbackImport: (id: string) => request<ImportResult>('POST', `/imports/${id}/rollback`),
	listImportTemplates: () => request<ImportTemplate[]>('GET', '/import-templates'),
	createImportTemplate: (name: string, mapping: ImportMapping) => request<ImportTemplate>('POST', '/import-templates', { name, mapping }),
	deleteImportTemplate: (id: string) => request<void>('DELETE', `/import-templates/${id}`),

	// e-mail diagnosis (admin, contract v0.18.0)
	getMailStatus: () => request<MailStatus>('GET', '/admin/mail'),
	checkMail: () => request<MailCheckResult>('POST', '/admin/mail/check'),
	sendMailTest: (to?: string) => request<MailTestResult>('POST', '/admin/mail/test', to ? { to } : {}),

	// file storage (admin) and files
	getStorageSettings: () => request<StorageSettings>('GET', '/admin/storage'),
	putStorageSettings: (input: StorageSettingsInput) => request<StorageSettings>('PUT', '/admin/storage', input),
	uploadFile: (file: File) => upload<FileMeta>('/files', file),
	downloadFile: (id: string) => download(`/files/${id}`),
	deleteFile: (id: string) => request<void>('DELETE', `/files/${id}`),
	listAbsenceAttachments: (absenceId: string) => request<FileMeta[]>('GET', `/absences/${absenceId}/attachments`),
	attachFile: (absenceId: string, fileId: string) => request<FileMeta>('POST', `/absences/${absenceId}/attachments`, { fileId }),
	detachFile: (absenceId: string, fileId: string) => request<void>('DELETE', `/absences/${absenceId}/attachments/${fileId}`),

	// Berichtsheft, contract v0.6.0; entry updates carry the version as If-Match (412 stale_version)
	listLearningFields: () => request<LearningField[]>('GET', '/reports/learning-fields'),
	createLearningField: (input: LearningFieldInput) => request<LearningField>('POST', '/reports/learning-fields', input),
	updateLearningField: (id: string, input: LearningFieldInput) => request<LearningField>('PUT', `/reports/learning-fields/${id}`, input),
	deleteLearningField: (id: string) => request<void>('DELETE', `/reports/learning-fields/${id}`),
	getReportWeek: (year: number, week: number) => request<ReportWeek>('GET', `/reports/weeks/${year}/${week}`),
	putReportWeekStatus: (year: number, week: number, status: ReportStatus) => request<ReportWeek>('PUT', `/reports/weeks/${year}/${week}`, { status }),
	getReportWeekText: (year: number, week: number) => requestText(`/reports/weeks/${year}/${week}/text`),
	createReportEntry: (input: ReportEntryInput) => request<ReportEntry>('POST', '/reports/entries', input),
	updateReportEntry: (id: string, input: ReportEntryInput, ifMatchVersion: number) =>
		request<ReportEntry>('PUT', `/reports/entries/${id}`, input, { 'If-Match': String(ifMatchVersion) }),
	deleteReportEntry: (id: string) => request<void>('DELETE', `/reports/entries/${id}`),
	listReportSources: (year: number, week: number) => request<ReportSource[]>('GET', `/reports/sources?year=${year}&week=${week}`),
	createReportSource: (input: ReportSourceInput) => request<ReportSource>('POST', '/reports/sources', input),
	deleteReportSource: (id: string) => request<void>('DELETE', `/reports/sources/${id}`),

	// notifications and Web Push, contract v0.8.0 (ADR-0010); `before` is the createdAt cursor of the last loaded item
	listNotifications: (options: { unreadOnly?: boolean; limit?: number; before?: string } = {}) => {
		const query = new URLSearchParams();
		if (options.unreadOnly) query.set('unreadOnly', 'true');
		if (options.limit) query.set('limit', String(options.limit));
		if (options.before) query.set('before', options.before);
		const text = query.toString();
		return request<NotificationList>('GET', `/notifications${text ? `?${text}` : ''}`);
	},
	markNotificationsRead: (selection: { ids: string[] } | { all: true }) =>
		request<{ unreadCount: number }>('POST', '/notifications/read', selection),
	deleteNotification: (id: string) => request<void>('DELETE', `/notifications/${id}`),
	getNotificationSettings: () => request<NotificationSettings>('GET', '/notifications/settings'),
	putNotificationSettings: (input: NotificationSettings) => request<NotificationSettings>('PUT', '/notifications/settings', input),
	pushConfig: () => request<PushConfig>('GET', '/push/config'),
	listPushSubscriptions: () => request<PushSubscriptionInfo[]>('GET', '/me/push-subscriptions'),
	createPushSubscription: (input: PushSubscriptionInput) => request<PushSubscriptionInfo>('POST', '/me/push-subscriptions', input),
	deletePushSubscription: (id: string) => request<void>('DELETE', `/me/push-subscriptions/${id}`),
	sendTestPush: (id: string) => request<void>('POST', `/me/push-subscriptions/${id}/test`),

	// module switches, contract v0.9.0 (ADR-0012); a PUT only needs the keys that change
	listModules: () => request<ModuleStatus[]>('GET', '/modules'),
	putMyModules: (modules: Partial<Record<ModuleKey, boolean>>) => request<ModuleStatus[]>('PUT', '/me/modules', { modules }),
	getServerModules: () => request<ServerModule[]>('GET', '/admin/modules'),
	putServerModules: (modules: Partial<Record<ModuleKey, boolean>>) => request<ServerModule[]>('PUT', '/admin/modules', { modules })
};
