import { splitRange } from '../time/dates';
import { ApiError } from './errors';
import type {
	DownloadedFile,
	ExportFormat,
	FileMeta,
	ImportJob,
	ImportMapping,
	ImportPreview,
	ImportResult,
	ImportTemplate,
	RawPreview,
	StorageSettings,
	StorageSettingsInput,
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
	VacationEntries,
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
		response = await fetch(BASE + path, { method: 'GET', credentials: 'include' });
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
		response = await fetch(BASE + path, { method: 'POST', headers, credentials: 'include', body: form });
	} catch {
		throw new ApiError(0, 'network_error');
	}
	if (!response.ok) throw await toApiError(response);
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
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

	if (!response.ok) throw await toApiError(response);
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
	/** time/days allows at most 93 days per request (range_too_large); longer ranges are loaded in chunks. */
	listDays: async (from: string, to: string) =>
		(await Promise.all(splitRange(from, to, MAX_DAYS_EVALUATIONS).map((r) => request<DayEvaluation[]>('GET', `/time/days?from=${r.from}&to=${r.to}`)))).flat(),
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
	exportTime: (from: string, to: string, format: ExportFormat) =>
		download(`/export/time?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${format}`),

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

	// file storage (admin) and files
	getStorageSettings: () => request<StorageSettings>('GET', '/admin/storage'),
	putStorageSettings: (input: StorageSettingsInput) => request<StorageSettings>('PUT', '/admin/storage', input),
	uploadFile: (file: File) => upload<FileMeta>('/files', file),
	downloadFile: (id: string) => download(`/files/${id}`),
	deleteFile: (id: string) => request<void>('DELETE', `/files/${id}`),
	listAbsenceAttachments: (absenceId: string) => request<FileMeta[]>('GET', `/absences/${absenceId}/attachments`),
	attachFile: (absenceId: string, fileId: string) => request<FileMeta>('POST', `/absences/${absenceId}/attachments`, { fileId }),
	detachFile: (absenceId: string, fileId: string) => request<void>('DELETE', `/absences/${absenceId}/attachments/${fileId}`)
};
