import { ApiError } from './errors';
import type {
	CreationOptions,
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

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json' };
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
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
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
	revokeInvitation: (id: string) => request<void>('DELETE', `/admin/invitations/${id}`)
};
