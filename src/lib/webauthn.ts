export type WebAuthnErrorKind = 'unsupported' | 'cancelled' | 'already_registered' | 'failed';

export class WebAuthnError extends Error {
	readonly kind: WebAuthnErrorKind;

	constructor(kind: WebAuthnErrorKind, cause?: unknown) {
		super(kind, { cause });
		this.name = 'WebAuthnError';
		this.kind = kind;
	}
}

export function isWebAuthnSupported(): boolean {
	return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

// --- base64url helpers (fallback when parse*FromJSON / toJSON are missing) ---

export function base64urlToBuffer(value: string): ArrayBuffer {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

export function bufferToBase64url(buffer: ArrayBuffer | ArrayBufferView | null | undefined): string {
	if (!buffer) return '';
	const bytes =
		buffer instanceof ArrayBuffer
			? new Uint8Array(buffer)
			: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type CreationJSON = PublicKeyCredentialCreationOptionsJSON;
type RequestJSON = PublicKeyCredentialRequestOptionsJSON;

export function creationOptionsFromJSON(json: CreationJSON): PublicKeyCredentialCreationOptions {
	if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function') {
		return PublicKeyCredential.parseCreationOptionsFromJSON(json);
	}
	return {
		...json,
		challenge: base64urlToBuffer(json.challenge),
		user: { ...json.user, id: base64urlToBuffer(json.user.id) },
		excludeCredentials: json.excludeCredentials?.map((c) => ({
			...c,
			id: base64urlToBuffer(c.id)
		}))
	} as PublicKeyCredentialCreationOptions;
}

export function requestOptionsFromJSON(json: RequestJSON): PublicKeyCredentialRequestOptions {
	if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function') {
		return PublicKeyCredential.parseRequestOptionsFromJSON(json);
	}
	return {
		...json,
		challenge: base64urlToBuffer(json.challenge),
		allowCredentials: json.allowCredentials?.map((c) => ({ ...c, id: base64urlToBuffer(c.id) }))
	} as PublicKeyCredentialRequestOptions;
}

function registrationToJSON(credential: PublicKeyCredential): RegistrationResponseJSON {
	if (typeof credential.toJSON === 'function') return credential.toJSON() as RegistrationResponseJSON;
	const response = credential.response as AuthenticatorAttestationResponse;
	return {
		id: credential.id,
		rawId: bufferToBase64url(credential.rawId),
		type: 'public-key',
		authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
		clientExtensionResults: credential.getClientExtensionResults(),
		response: {
			clientDataJSON: bufferToBase64url(response.clientDataJSON),
			attestationObject: bufferToBase64url(response.attestationObject),
			transports: response.getTransports?.()
		}
	} as RegistrationResponseJSON;
}

function authenticationToJSON(credential: PublicKeyCredential): AuthenticationResponseJSON {
	if (typeof credential.toJSON === 'function') return credential.toJSON() as AuthenticationResponseJSON;
	const response = credential.response as AuthenticatorAssertionResponse;
	return {
		id: credential.id,
		rawId: bufferToBase64url(credential.rawId),
		type: 'public-key',
		authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
		clientExtensionResults: credential.getClientExtensionResults(),
		response: {
			clientDataJSON: bufferToBase64url(response.clientDataJSON),
			authenticatorData: bufferToBase64url(response.authenticatorData),
			signature: bufferToBase64url(response.signature),
			userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined
		}
	} as AuthenticationResponseJSON;
}

function toWebAuthnError(error: unknown): WebAuthnError {
	if (error instanceof WebAuthnError) return error;
	const name = error instanceof DOMException ? error.name : '';
	if (name === 'NotAllowedError' || name === 'AbortError') return new WebAuthnError('cancelled', error);
	if (name === 'InvalidStateError') return new WebAuthnError('already_registered', error);
	if (name === 'NotSupportedError' || name === 'SecurityError') return new WebAuthnError('unsupported', error);
	return new WebAuthnError('failed', error);
}

/** Dev mock mode has no authenticator; return a syntactically valid fake credential. */
const MOCK_AUTHENTICATOR = import.meta.env.VITE_MOCK === '1';

function fakeCredential(id: string, kind: 'create' | 'get') {
	const base = { id, rawId: id, type: 'public-key', clientExtensionResults: {} };
	return kind === 'create'
		? { ...base, response: { clientDataJSON: 'mock', attestationObject: 'mock' } }
		: { ...base, response: { clientDataJSON: 'mock', authenticatorData: 'mock', signature: 'mock' } };
}

export async function createPasskey(options: CreationJSON): Promise<RegistrationResponseJSON> {
	if (MOCK_AUTHENTICATOR) {
		return fakeCredential(`mock-${Math.random().toString(36).slice(2)}`, 'create') as unknown as RegistrationResponseJSON;
	}
	if (!isWebAuthnSupported()) throw new WebAuthnError('unsupported');
	try {
		const credential = await navigator.credentials.create({ publicKey: creationOptionsFromJSON(options) });
		if (!(credential instanceof PublicKeyCredential)) throw new WebAuthnError('failed');
		return registrationToJSON(credential);
	} catch (error) {
		throw toWebAuthnError(error);
	}
}

export async function getPasskey(
	options: RequestJSON,
	signal?: AbortSignal
): Promise<AuthenticationResponseJSON> {
	if (MOCK_AUTHENTICATOR) {
		return fakeCredential('mock-login', 'get') as unknown as AuthenticationResponseJSON;
	}
	if (!isWebAuthnSupported()) throw new WebAuthnError('unsupported');
	try {
		const credential = await navigator.credentials.get({ publicKey: requestOptionsFromJSON(options), signal });
		if (!(credential instanceof PublicKeyCredential)) throw new WebAuthnError('failed');
		return authenticationToJSON(credential);
	} catch (error) {
		throw toWebAuthnError(error);
	}
}
