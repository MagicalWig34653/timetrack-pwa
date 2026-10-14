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
