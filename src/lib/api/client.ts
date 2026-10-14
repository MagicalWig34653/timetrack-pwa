import { ApiError } from './errors';
import type {
	Absence,
	AbsenceInput,
	AccountAdjustmentInput,
	CalendarDay,
	CustomDayInput,
	IncomingShare,
	PlanDay,
	PlanDayInput,
	Share,
	ShareScopes,
	SharedView,
	VacationBalance,
	VacationSettings,
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
	Invitation,
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

export function setCsrfToken(token: string | null): void {
	csrfToken = token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(
	method: Method,
	path: string,
	body?: unknown,
	extraHeaders: Record<string, string> = {}
): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
	if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	let response: Response;
	try {
		response = await fetch(BASE + path, {
			method,
			headers,
			credentials: 'include',
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new ApiError(0, 'network_error');
	}

	if (!response.ok) {
		let code = `http_${response.status}`;
		let message = response.statusText;
		try {
			const payload = await response.json();
			if (payload?.error?.code) code = String(payload.error.code);
			if (payload?.error?.message) message = String(payload.error.message);
		} catch {
			// non-JSON error body (e.g. proxy error page): keep the generic code
		}
		throw new ApiError(response.status, code, message);
	}
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

export const api = {
	// sessions
	currentSession: () => sessionRequest('GET', '/auth/session'),
	async logout(): Promise<void> {
		await request<void>('DELETE', '/auth/session');
		setCsrfToken(null);
	},
	revokeOtherSessions: () => request<void>('DELETE', '/me/sessions'),

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
	listDays: (from: string, to: string) =>
		request<DayEvaluation[]>('GET', `/time/days?from=${from}&to=${to}`),
	getDay: (date: string) => request<DayEvaluation>('GET', `/time/days/${date}`),
	setDayPreferences: (date: string, input: DayPreferences) =>
		request<DayEvaluation>('PUT', `/time/days/${date}`, input),
	getTimeAccount: (asOf?: string) => request<TimeAccount>('GET', `/time/account${asOf ? `?asOf=${asOf}` : ''}`),
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

	// vacation (contract v0.3.0); amounts are half days
	getVacationSettings: () => request<VacationSettings>('GET', '/vacation/settings'),
	putVacationSettings: (input: VacationSettings) => request<VacationSettings>('PUT', '/vacation/settings', input),
	getVacationBalance: (year: number) => request<VacationBalance>('GET', `/vacation/balance?year=${year}`),
	createVacationSnapshot: (input: { date: string; remainingHalfDays: number }) =>
		request<VacationBalance>('POST', '/vacation/snapshots', input),
	createVacationAdjustment: (input: { date: string; halfDays: number; reason: string }) =>
		request<VacationBalance>('POST', '/vacation/adjustments', input),

	// absences; `ifMatchVersion` becomes the If-Match header
	listAbsences: (from: string, to: string) => request<Absence[]>('GET', `/absences?from=${from}&to=${to}`),
	createAbsence: (input: AbsenceInput) => request<Absence>('POST', '/absences', input),
	updateAbsence: (id: string, input: AbsenceInput, ifMatchVersion: number) =>
		request<Absence>('PUT', `/absences/${id}`, input, { 'If-Match': String(ifMatchVersion) }),
	deleteAbsence: (id: string) => request<void>('DELETE', `/absences/${id}`),

	// calendar and plan
	listHolidays: (year: number, region?: string) =>
		request<CalendarDay[]>('GET', `/calendar/holidays?year=${year}${region ? `&region=${encodeURIComponent(region)}` : ''}`),
	createCustomDay: (input: CustomDayInput) => request<CalendarDay>('POST', '/calendar/custom-days', input),
	deleteCustomDay: (id: string) => request<void>('DELETE', `/calendar/custom-days/${id}`),
	listPlanDays: (from: string, to: string) => request<PlanDay[]>('GET', `/plan/days?from=${from}&to=${to}`),
	putPlanDay: (date: string, input: PlanDayInput) => request<PlanDay>('PUT', `/plan/days/${date}`, input),
	deletePlanDay: (date: string) => request<void>('DELETE', `/plan/days/${date}`),

	// shares
	listShares: () => request<Share[]>('GET', '/shares'),
	createShare: (input: { recipientHandle: string; scopes: ShareScopes }) => request<Share>('POST', '/shares', input),
	updateShare: (id: string, scopes: ShareScopes) => request<Share>('PATCH', `/shares/${id}`, { scopes }),
	revokeShare: (id: string) => request<void>('DELETE', `/shares/${id}`),
	listIncomingShares: () => request<IncomingShare[]>('GET', '/shares/incoming'),
	viewShared: (shareId: string, from: string, to: string) =>
		request<SharedView>('GET', `/shares/incoming/${shareId}/view?from=${from}&to=${to}`)
};
