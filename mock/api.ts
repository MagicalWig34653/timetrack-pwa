import { createMcpMock } from './mcp.ts';
import { createMailMock } from './mail.ts';
import { createModulesMock, type ModuleKey } from './modules.ts';
import { createNotificationsMock } from './notifications.ts';
import { createPlanningMock } from './planning.ts';
import { createVacationFormMock } from './vacation-form.ts';
import { createReportsMock } from './reports.ts';
import { createTimeMock } from './time.ts';
import { createWeekMock } from './week.ts';
import { samplePdf, samplePng } from './sample-files.ts';
import { createTransferMock, type UploadedFile } from './transfer.ts';
import { writeZip } from './worktime-xlsx.ts';

// In-memory mock of the happy paths in contracts/openapi.yaml (backend repo), API v0.1.0.
// Framework-free so it can back both the Vite dev middleware and vitest fetch stubs.
// Demo data: admin handle `admin`, valid invitation token `demo-invite`, recovery code
// `AAAA-BBBB-CCCC`, fallback password `correct-horse-battery`, e-mail code `123456`.

export interface MockRequest {
	method: string;
	path: string;
	body?: any;
	cookies: Record<string, string>;
	csrfToken?: string;
	/** value of the If-Match header */
	ifMatch?: string;
	/** value of the Authorization header (device tokens for /automation/events) */
	authorization?: string;
	/** multipart upload (field `file`) */
	file?: UploadedFile;
	/** raw binary body (PUT of the vacation form template) and its percent-encoded X-File-Name header */
	rawBody?: Uint8Array;
	fileName?: string;
	/** Content-Type header of the raw binary body */
	contentType?: string;
}

export interface MockResponse {
	status: number;
	body?: unknown;
	/** file download; replaces the JSON body */
	binary?: { bytes: Uint8Array; contentType: string; headers: Record<string, string> };
	/** Value for the tt_session cookie; null clears it; undefined leaves it untouched. */
	sessionCookie?: string | null;
	/** 302 target (OIDC callback); replaces the body */
	redirect?: string;
}

interface MockAccount {
	id: string;
	handle: string;
	displayName: string;
	role: 'admin' | 'member';
	email?: string;
	/** profile e-mail (P1, ADR-0019): only verified addresses count; a pending change waits for the code */
	emailVerified?: boolean;
	pendingEmail?: { address: string; attempts: number };
	/** guided setup flag; pre-existing demo accounts are `skipped`, new ones `pending` */
	onboarding?: { state: 'pending' | 'completed' | 'skipped'; updatedAt: string | null };
	/** appearance preferences (P2, ADR-0020); undefined = never set = defaults */
	preferences?: { accent: string; accentCustomHex: string | null; colorScheme: string; glow: string; updatedAt: string };
	recoveryCodes: string[] | null;
	fallbackPassword: string | null;
	emailRecovery: { active: boolean; verified: boolean };
	/** account administration (ADR-0016) */
	createdAt?: string;
	disabledAt?: string | null;
	lastActivityAt?: string | null;
}

interface MockSession {
	accountId: string;
	csrfToken: string;
	recovery: boolean;
	/** simulates a session too old for linking/unlinking (403 reauth_required) */
	stale?: boolean;
}

interface MockIdentity {
	id: string;
	accountId: string;
	/** subject at the mock provider; (issuer, sub) identifies the identity in the real contract */
	sub: string;
	providerName: string;
	emailHint: string | null;
	linkedAt: string;
	lastUsedAt: string | null;
}

interface MockPasskey {
	id: string;
	accountId: string;
	name: string;
	credentialId?: string;
	createdAt: string;
	lastUsedAt: string | null;
}

interface MockInvitation {
	id: string;
	token: string;
	note: string | null;
	createdAt: string;
	expiresAt: string;
	status: 'open' | 'used' | 'expired' | 'revoked';
}

export interface MockOptions {
	/** the PWA build the mock server reports under `pwa` in GET /system/info (the dev server passes the real build info); null = no PWA on the server */
	pwaBuild?: { version: string; revision: string; buildDate: string } | null;
	/** false mimics a server without mail delivery (email.available = false) */
	mailAvailable?: boolean;
	/** clock in epoch ms; defaults to Date.now. Lets tests freeze time for deterministic demo data. */
	now?: () => number;
	/** false skips the demo time-tracking data for the admin account */
	seedTime?: boolean;
	/** true adds a sample PDF and PNG to the demo sick absence of the admin (dev mock only; tests start without attachments) */
	seedAttachments?: boolean;
	/** false skips the demo vacation/plan data, the second demo account and the demo share */
	seedPlanning?: boolean;
	/** false mimics a server without STORAGE_SECRET_KEY: S3 storage settings are refused with 501 */
	storageSecretKey?: boolean;
	/** operator lock like MODULES_DISABLED (ADR-0012): these modules are off server-wide and cannot be switched on */
	modulesDisabled?: ModuleKey[];
	/** optional OIDC (ADR-0007): false/undefined = disabled like a default server; true or {name} enables the in-app mock IdP */
	oidc?: boolean | { name?: string };
}

/** Subjects the in-app mock IdP page (/mock-idp) can sign in as. `mock-user-2` is pre-linked to the demo account `lena`. */
export const MOCK_OIDC_SUBJECTS = {
	user1: { sub: 'mock-user-1', email: 'demo@mock-idp.example' },
	user2: { sub: 'mock-user-2', email: 'lena@mock-idp.example' }
} as const;

const uuid = () => crypto.randomUUID();
const randomToken = () => uuid().replace(/-/g, '');
const randomBase64url = () => btoa(randomToken()).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function publicPasskey({ credentialId: _credentialId, accountId: _accountId, ...rest }: MockPasskey) {
	return rest;
}

function error(status: number, code: string, message = code): MockResponse {
	return { status, body: { error: { code, message } } };
}

const DEMO_PWA_BUILD = { version: '0.0.1', revision: 'fedcba9876543210fedcba9876543210fedcba98', buildDate: '2026-10-18T08:00:00Z' };

export function createMockApi(options: MockOptions = {}) {
	const startedAt = Date.now();
	const mailAvailable = options.mailAvailable ?? true;
	const time = createTimeMock(options.now ?? Date.now);
	const accounts = new Map<string, MockAccount>();
	const vacationForm = createVacationFormMock(options.now ?? Date.now);
	const planning = createPlanningMock({
		clock: options.now ?? Date.now,
		modelsOf: time.modelsOf,
		evaluateFor: time.evaluateFor,
		findByHandle: (handle) => [...accounts.values()].find((a) => a.handle === handle),
		displayNameOf: (id) => accounts.get(id)?.displayName ?? '',
		attachmentCountOf: (accountId, absenceId) => transfer.attachmentCount(accountId, absenceId)
	});
	const mail = createMailMock({ configured: options.mailAvailable ?? true });
	const modules = createModulesMock({ disabledByOperator: options.modulesDisabled });
	// With planning switched off, absences and holidays do not act on the day evaluation (ADR-0012).
	time.setDayContext((accountId, date) => (modules.effective(accountId, 'planning') ? planning.dayContext(accountId, date) : null));
	const transfer = createTransferMock({
		clock: options.now ?? Date.now,
		displayNameOf: (id) => accounts.get(id)?.displayName ?? '',
		call: (accountId, method, path, body) => time.handle(accountId, { method, path, body }),
		planning: (accountId, method, path, body) => planning.handle(accountId, { method, path, body }),
		planningEnabled: (accountId) => modules.effective(accountId, 'planning'),
		absenceExists: (accountId, absenceId) => !!planning.states.get(accountId)?.absences.some((a) => a.id === absenceId),
		storageSecretKey: options.storageSecretKey ?? true
	});
	const week = createWeekMock({
		clock: options.now ?? Date.now,
		time: (accountId, method, path, body) => time.handle(accountId, { method, path, body }),
		planning: (accountId, method, path, body) => planning.handle(accountId, { method, path, body }),
		planningEnabled: (accountId) => modules.effective(accountId, 'planning')
	});
	const reports = createReportsMock({
		clock: options.now ?? Date.now,
		call: (accountId, method, path, body) => time.handle(accountId, { method, path, body }),
		fileOf: (accountId, fileId) => {
			const file = transfer.files.get(fileId);
			return file && file.ownerId === accountId ? file.meta : null;
		}
	});
	const mcp = createMcpMock({ clock: options.now ?? Date.now });
	const notifications = createNotificationsMock({ clock: options.now ?? Date.now });
	const oidc = {
		enabled: !!options.oidc,
		name: typeof options.oidc === 'object' ? (options.oidc.name ?? 'Mock-IdP') : 'Mock-IdP'
	};
	const identities: MockIdentity[] = [];
	const oidcFlows = new Map<string, { purpose: string; inviteToken?: string }>();
	const oidcPending = new Map<string, { sub: string; email: string; inviteToken: string }>();
	const passkeys: MockPasskey[] = [];
	const sessions = new Map<string, MockSession>();
	const invitations: MockInvitation[] = [];
	const challenges = new Map<string, { kind: string; data?: any }>();
	let lastAccountId = '';
	const recoveries = new Map<string, { method: string; accountId: string | null }>();

	function seedPasskey(accountId: string, name: string, credentialId?: string) {
		passkeys.push({ id: uuid(), accountId, name, credentialId, createdAt: new Date().toISOString(), lastUsedAt: null });
	}

	const admin: MockAccount = {
		id: uuid(),
		handle: 'admin',
		displayName: 'Admin Demo',
		role: 'admin',
		recoveryCodes: ['AAAA-BBBB-CCCC'],
		fallbackPassword: 'correct-horse-battery',
		emailRecovery: { active: false, verified: false },
		onboarding: { state: 'skipped', updatedAt: null },
		createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString()
	};
	accounts.set(admin.id, admin);
	lastAccountId = admin.id;
	seedPasskey(admin.id, 'Demo-Passkey');
	if (options.seedTime ?? true) time.seedDemo(admin.id);
	if (options.seedPlanning ?? true) {
		// Second demo account `lena` (no passkey, cannot sign in) shares plan and vacation (not actual time) with the admin.
		const lena: MockAccount = {
			id: uuid(),
			handle: 'lena',
			displayName: 'Lena Beispiel',
			role: 'member',
			recoveryCodes: null,
			fallbackPassword: null,
			emailRecovery: { active: false, verified: false },
			onboarding: { state: 'skipped', updatedAt: null },
			createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
			lastActivityAt: new Date(Date.now() - 2 * 86_400_000).toISOString()
		};
		accounts.set(lena.id, lena);
		time.seedDemo(lena.id);
		planning.seedDemo(admin.id);
		if (options.seedAttachments) {
			const sick = planning.states.get(admin.id)?.absences.find((a) => a.kind === 'sick');
			if (sick) {
				transfer.seedAttachment(admin.id, sick.id, 'Krankmeldung.pdf', samplePdf('Krankmeldung (Beispiel)'));
				transfer.seedAttachment(admin.id, sick.id, 'Attest-Scan.png', samplePng());
			}
		}
		planning.seedDemo(lena.id);
		planning.seedShare(lena.id, admin.id, 'admin', { plan: true, actual: false, vacation: true });
		identities.push({
			id: uuid(),
			accountId: lena.id,
			sub: MOCK_OIDC_SUBJECTS.user2.sub,
			providerName: oidc.name,
			emailHint: MOCK_OIDC_SUBJECTS.user2.email,
			linkedAt: new Date().toISOString(),
			lastUsedAt: null
		});
	}
	invitations.push({
		id: uuid(),
		token: 'demo-invite',
		note: 'Demo',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
		status: 'open'
	});

	function preferencesBody(account: MockAccount) {
		return account.preferences ?? { accent: 'blue', colorScheme: 'system', glow: 'subtle' };
	}

	function sessionBody(session: MockSession) {
		const account = accounts.get(session.accountId)!;
		return {
			account: { id: account.id, handle: account.handle, displayName: account.displayName, role: account.role, onboardingState: account.onboarding?.state ?? 'pending', preferences: preferencesBody(account) },
			csrfToken: session.csrfToken,
			recovery: session.recovery,
			expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString()
		};
	}

	function openSession(accountId: string, recovery = false, rememberAsLast = true): { id: string; session: MockSession } {
		const id = randomToken();
		const session = { accountId, csrfToken: randomToken(), recovery };
		// passkey sign-in with an unknown credential falls back to this account; OIDC sessions must not hijack that
		if (rememberAsLast) lastAccountId = accountId;
		sessions.set(id, session);
		const opener = accounts.get(accountId);
		if (opener) opener.lastActivityAt = new Date().toISOString();
		return { id, session };
	}

	function creationOptions(account: { handle: string; displayName: string; id: string }, kind: string, data?: any) {
		const challengeId = uuid();
		challenges.set(challengeId, { kind, data });
		return {
			challengeId,
			publicKey: {
				rp: { id: 'localhost', name: 'Timetrack' },
				user: { id: randomBase64url(), name: account.handle, displayName: account.displayName },
				challenge: randomBase64url(),
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
				authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
				timeout: 60000,
				attestation: 'none'
			}
		};
	}

	// --- account administration, export and deletion (contract v0.11.0, ADR-0016) ---
	/** test hook state: the next deletion fails like an unreachable storage backend (503 account_deletion_incomplete) */
	let failDeletion = false;
	const isDisabled = (accountId: string) => !!accounts.get(accountId)?.disabledAt;
	const activeAdmins = () => [...accounts.values()].filter((a) => a.role === 'admin' && !a.disabledAt);
	const revokeSessionsOf = (accountId: string) => {
		for (const [id, other] of sessions) if (other.accountId === accountId) sessions.delete(id);
	};
	const adminAccountView = (a: MockAccount) => ({
		id: a.id,
		handle: a.handle,
		displayName: a.displayName,
		email: a.email ?? null,
		role: a.role,
		state: a.disabledAt ? 'disabled' : 'active',
		createdAt: a.createdAt ?? new Date(0).toISOString(),
		disabledAt: a.disabledAt ?? null,
		lastActivityAt: a.lastActivityAt ?? null,
		passkeyCount: passkeys.filter((p) => p.accountId === a.id).length
	});
	function wipeAccount(accountId: string) {
		revokeSessionsOf(accountId);
		accounts.delete(accountId);
		for (let i = passkeys.length - 1; i >= 0; i--) if (passkeys[i].accountId === accountId) passkeys.splice(i, 1);
		for (let i = identities.length - 1; i >= 0; i--) if (identities[i].accountId === accountId) identities.splice(i, 1);
	}
	/** Shared rules of DELETE /admin/accounts/{id} and DELETE /me; `self` marks the self-service path. */
	function deleteAccountRules(actorSession: MockSession, target: MockAccount, confirmHandle: unknown, self: boolean): MockResponse {
		if (actorSession.stale) return error(403, 'reauth_required');
		if (confirmHandle !== target.handle) return error(400, 'confirmation_mismatch');
		if (!self && actorSession.accountId === target.id) return error(409, 'self_lockout');
		if (target.role === 'admin' && !target.disabledAt && activeAdmins().length <= 1) return error(409, 'last_admin');
		if (failDeletion) {
			failDeletion = false;
			target.disabledAt = target.disabledAt ?? new Date().toISOString();
			revokeSessionsOf(target.id);
			return { status: 503, body: { error: { code: 'account_deletion_incomplete', message: 'account_deletion_incomplete' } }, sessionCookie: self ? null : undefined };
		}
		wipeAccount(target.id);
		return { status: 204, sessionCookie: self ? null : undefined };
	}

	function handle(req: MockRequest): MockResponse {
		const path = req.path.split('?')[0].replace(/\/+$/, '');
		const method = req.method.toUpperCase();
		const body = req.body ?? {};
		const sessionId = req.cookies['tt_session'];
		const session = sessionId ? sessions.get(sessionId) : undefined;
		const account = session ? accounts.get(session.accountId)! : undefined;
		const mutating = method !== 'GET';

		if (path === '/health') return { status: 200, body: { status: 'ok' } };
		if (path === '/ready') return { status: 200, body: { status: 'ok' } };

		let m: RegExpMatchArray | null;

		// --- public endpoints ---
		if ((m = path.match(/^\/api\/v1\/invitations\/([^/]+)$/)) && method === 'GET') {
			const invitation = invitations.find((i) => i.token === decodeURIComponent(m![1]));
			if (!invitation || invitation.status !== 'open') return error(404, 'not_found');
			return { status: 200, body: { valid: true, expiresAt: invitation.expiresAt } };
		}
		if (path === '/api/v1/auth/register/options' && method === 'POST') {
			const invitation = invitations.find((i) => i.token === body.inviteToken);
			if (!invitation || invitation.status !== 'open') return error(404, 'not_found');
			if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(body.handle ?? '') || !body.displayName) {
				return error(400, 'bad_request');
			}
			if ([...accounts.values()].some((a) => a.handle === body.handle)) return error(409, 'handle_taken');
			return {
				status: 200,
				body: creationOptions({ id: uuid(), handle: body.handle, displayName: body.displayName }, 'register', {
					invitationId: invitation.id,
					handle: body.handle,
					displayName: body.displayName,
					email: body.email
				})
			};
		}
		if (path === '/api/v1/auth/register/verify' && method === 'POST') {
			const challenge = challenges.get(body.challengeId);
			if (!challenge || challenge.kind !== 'register' || !body.credential) return error(400, 'bad_request');
			const invitation = invitations.find((i) => i.id === challenge.data.invitationId);
			if (!invitation || invitation.status !== 'open') return error(409, 'conflict');
			challenges.delete(body.challengeId);
			invitation.status = 'used';
			const created: MockAccount = {
				id: uuid(),
				handle: challenge.data.handle,
				displayName: challenge.data.displayName,
				role: 'member',
				email: challenge.data.email,
				recoveryCodes: null,
				fallbackPassword: null,
				emailRecovery: { active: false, verified: false },
				onboarding: { state: 'pending', updatedAt: null }
			};
			created.createdAt = new Date().toISOString();
			accounts.set(created.id, created);
			seedPasskey(created.id, body.passkeyName || 'Passkey', body.credential.id);
			// like OIDC sign-ups: a fresh account must not become the fallback of later "unknown passkey" logins (specs sign in as the demo admin)
			const { id, session: opened } = openSession(created.id, false, false);
			return { status: 201, body: sessionBody(opened), sessionCookie: id };
		}
		if (path === '/api/v1/auth/login/options' && method === 'POST') {
			const challengeId = uuid();
			challenges.set(challengeId, { kind: 'login' });
			return {
				status: 200,
				body: {
					challengeId,
					publicKey: { challenge: randomBase64url(), rpId: 'localhost', userVerification: 'preferred', timeout: 60000 }
				}
			};
		}
		if (path === '/api/v1/auth/login/verify' && method === 'POST') {
			const challenge = challenges.get(body.challengeId);
			if (!challenge || challenge.kind !== 'login' || !body.credential) return error(401, 'unauthorized');
			challenges.delete(body.challengeId);
			// The mock does not verify signatures: a known credential id signs in its owner,
			// anything else signs in the most recently active account (admin by default).
			const known = passkeys.find((p) => p.credentialId === body.credential.id);
			const target = (known && accounts.get(known.accountId)) || accounts.get(lastAccountId) || admin;
			if (target.disabledAt) return error(401, 'unauthorized');
			const { id, session: opened } = openSession(target.id);
			return { status: 200, body: sessionBody(opened), sessionCookie: id };
		}
		if (path === '/api/v1/auth/recovery/start' && method === 'POST') {
			const target = [...accounts.values()].find((a) => a.handle === body.identifier) ?? null;
			const recoveryId = uuid();
			recoveries.set(recoveryId, { method: body.method, accountId: target?.id ?? null });
			return { status: 202, body: { recoveryId } };
		}
		if (path === '/api/v1/auth/recovery/complete' && method === 'POST') {
			const recovery = recoveries.get(body.recoveryId);
			const target = recovery?.accountId ? accounts.get(recovery.accountId) : undefined;
			const proof = String(body.proof ?? '');
			const ok =
				!!recovery &&
				!!target &&
				((recovery.method === 'recovery-code' && !!target.recoveryCodes?.includes(proof)) ||
					(recovery.method === 'fallback-password' && target.fallbackPassword === proof) ||
					(recovery.method === 'email' && target.emailRecovery.active && proof === '123456'));
			if (!ok) return error(401, 'unauthorized');
			recoveries.delete(body.recoveryId);
			if (recovery!.method === 'recovery-code') {
				target!.recoveryCodes = target!.recoveryCodes!.filter((c) => c !== proof);
			}
			if (target!.disabledAt) return error(401, 'unauthorized');
			const { id, session: opened } = openSession(target!.id, true);
			return { status: 200, body: sessionBody(opened), sessionCookie: id };
		}


		// --- optional OIDC (ADR-0007, contract v0.5.0); the provider is the in-app page /mock-idp ---
		if (path === '/api/v1/mock/oidc' && method === 'POST') {
			// test hook, not part of the contract: toggles the config and ages all existing sessions
			if (typeof body.enabled === 'boolean') oidc.enabled = body.enabled;
			if (typeof body.name === 'string') oidc.name = body.name;
			if (body.staleSessions === true) for (const other of sessions.values()) other.stale = true;
			return { status: 200, body: { enabled: oidc.enabled, name: oidc.name } };
		}
		if (path === '/api/v1/mock/mail' && method === 'POST') return mail.hook(body);
		if (path === '/api/v1/mock/trash' && method === 'POST') return time.hookTrash(body);
		if (path === '/api/v1/mock/review' && method === 'POST') return time.hookReview(admin.id, body.segmentId);
		if (path === '/api/v1/mock/accounts' && method === 'POST') {
			// test hook, not part of the contract: add accounts, fail the next deletion, age sessions (reauth_required)
			if (typeof body.failDeletion === 'boolean') failDeletion = body.failDeletion;
			if (body.staleSessions === true) for (const other of sessions.values()) other.stale = true;
			// idempotent per handle so a spec can run twice against the same server
			for (const input of (body.add ?? []) as { handle: string; displayName?: string; role?: 'admin' | 'member'; disabled?: boolean; passkeys?: number; email?: string; lastActivityAt?: string }[]) {
				if ([...accounts.values()].some((a) => a.handle === input.handle)) continue;
				const created: MockAccount = {
					id: uuid(),
					handle: input.handle,
					displayName: input.displayName ?? input.handle,
					role: input.role ?? 'member',
					email: input.email,
					emailVerified: !!input.email,
					onboarding: { state: 'skipped', updatedAt: null },
					recoveryCodes: null,
					fallbackPassword: null,
					emailRecovery: { active: false, verified: false },
					createdAt: new Date().toISOString(),
					disabledAt: input.disabled ? new Date().toISOString() : null,
					lastActivityAt: input.lastActivityAt ?? null
				};
				created.createdAt = new Date().toISOString();
			accounts.set(created.id, created);
				for (let i = 0; i < (input.passkeys ?? 0); i++) seedPasskey(created.id, `Passkey ${i + 1}`);
			}
			return { status: 200, body: { accounts: accounts.size, failDeletion } };
		}
		if (path === '/api/v1/auth/oidc/config' && method === 'GET') {
			return { status: 200, body: oidc.enabled ? { enabled: true, name: oidc.name } : { enabled: false } };
		}
		if (path === '/api/v1/auth/oidc/start' && method === 'POST') {
			if (!oidc.enabled) return error(404, 'not_found');
			if (!['login', 'link', 'register'].includes(body.purpose)) return error(400, 'bad_request');
			if (body.purpose === 'link') {
				if (!session || !account) return error(401, 'unauthorized');
				if (req.csrfToken !== session.csrfToken) return error(403, 'csrf_invalid');
				if (session.stale) return error(403, 'reauth_required');
			}
			if (body.purpose === 'register') {
				const invitation = invitations.find((i) => i.token === body.inviteToken);
				if (!invitation || invitation.status !== 'open') return error(404, 'not_found');
			}
			const flowId = randomToken();
			oidcFlows.set(flowId, { purpose: body.purpose, inviteToken: body.inviteToken });
			return { status: 200, body: { authorizationUrl: `/mock-idp?flow=${flowId}&purpose=${body.purpose}&name=${encodeURIComponent(oidc.name)}` } };
		}
		if (path === '/api/v1/auth/oidc/callback' && method === 'GET') {
			// `outcome` is a mock-only parameter chosen on /mock-idp: user1, user2 or error:<code>
			const query = new URLSearchParams(req.path.split('?')[1] ?? '');
			const fail = (code: string): MockResponse => ({ status: 302, redirect: `/login?oidc_error=${code}` });
			const flow = oidcFlows.get(query.get('flow') ?? '');
			if (!oidc.enabled || !flow) return fail('oidc_state_invalid');
			oidcFlows.delete(query.get('flow')!);
			const outcome = query.get('outcome') ?? '';
			if (outcome.startsWith('error:')) return fail(outcome.slice('error:'.length));
			const subject = outcome === 'user2' ? MOCK_OIDC_SUBJECTS.user2 : outcome === 'user1' ? MOCK_OIDC_SUBJECTS.user1 : null;
			if (!subject) return fail('oidc_failed');
			const known = identities.find((i) => i.sub === subject.sub);
			if (flow.purpose === 'login') {
				if (!known || isDisabled(known.accountId)) return fail('oidc_not_linked');
				known.lastUsedAt = new Date().toISOString();
				const { id } = openSession(known.accountId, false, false);
				return { status: 302, redirect: '/', sessionCookie: id };
			}
			if (flow.purpose === 'link') {
				if (!session || !account || session.stale) return fail('oidc_reauth_required');
				if (known && known.accountId !== account.id) return fail('oidc_identity_taken');
				if (!known) {
					identities.push({
						id: uuid(),
						accountId: account.id,
						sub: subject.sub,
						providerName: oidc.name,
						emailHint: subject.email,
						linkedAt: new Date().toISOString(),
						lastUsedAt: null
					});
				}
				return { status: 302, redirect: '/settings/identities?linked=1' };
			}
			const invitation = invitations.find((i) => i.token === flow.inviteToken);
			if (!invitation || invitation.status !== 'open') return fail('oidc_invite_invalid');
			if (known) return fail('oidc_identity_taken');
			const pendingId = randomToken();
			oidcPending.set(pendingId, { sub: subject.sub, email: subject.email, inviteToken: invitation.token });
			return { status: 302, redirect: `/invite/${encodeURIComponent(invitation.token)}?oidc=${pendingId}` };
		}
		if (path === '/api/v1/auth/oidc/register' && method === 'POST') {
			const pending = oidcPending.get(body.pendingId);
			if (!oidc.enabled || !pending) return error(404, 'not_found');
			const invitation = invitations.find((i) => i.token === pending.inviteToken);
			if (!invitation || invitation.status !== 'open') return error(404, 'not_found');
			if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(body.handle ?? '') || !body.displayName) return error(400, 'bad_request');
			if ([...accounts.values()].some((a) => a.handle === body.handle)) return error(409, 'handle_taken');
			if (identities.some((i) => i.sub === pending.sub)) return error(409, 'conflict');
			oidcPending.delete(body.pendingId);
			invitation.status = 'used';
			const created: MockAccount = {
				id: uuid(),
				handle: body.handle,
				displayName: body.displayName,
				role: 'member',
				recoveryCodes: null,
				fallbackPassword: null,
				emailRecovery: { active: false, verified: false },
				onboarding: { state: 'pending', updatedAt: null }
			};
			created.createdAt = new Date().toISOString();
			accounts.set(created.id, created);
			identities.push({
				id: uuid(),
				accountId: created.id,
				sub: pending.sub,
				providerName: oidc.name,
				emailHint: pending.email,
				linkedAt: new Date().toISOString(),
				lastUsedAt: new Date().toISOString()
			});
			const { id, session: opened } = openSession(created.id, false, false);
			return { status: 201, body: sessionBody(opened), sessionCookie: id };
		}

		// Shortcuts: device token instead of cookie/CSRF.
		if (path === '/api/v1/automation/events' && method === 'POST') {
			// the token's account is not known here; the server-wide switch is enough for the mock
			if (!modules.serverEnabled('automation')) return error(404, 'module_disabled');
			return time.automationEvent(req.authorization, body);
		}

		// --- MCP/OAuth entry points of the authorization server (public, ADR-0009) ---
		if (path === '/oauth/register' && method === 'POST') {
			if (!modules.serverEnabled('mcp')) return error(404, 'module_disabled');
			return mcp.register(req.body);
		}
		if (path === '/oauth/authorize' && method === 'GET') {
			if (!modules.serverEnabled('mcp')) return error(404, 'module_disabled');
			return mcp.authorize(req.path);
		}

		// --- authenticated endpoints ---
		if (!session || !account || account.disabledAt) return error(401, 'unauthorized');
		if (mutating && req.csrfToken !== session.csrfToken) return error(403, 'csrf_invalid');

		if (path === '/api/v1/auth/session' && method === 'GET') return { status: 200, body: sessionBody(session) };
		if (path === '/api/v1/system/info' && method === 'GET') {
			return {
				status: 200,
				body: {
					backend: {
						version: '0.19.0-mock',
						revision: '0123456789abcdef0123456789abcdef01234567',
						revisionShort: '0123456',
						buildDate: '2026-10-18T08:00:00Z',
						apiVersion: '0.35.0',
						// operator details are admin-only since contract v0.23.0: the keys are absent for members
						...(account.role === 'admin'
							? {
									database: 'sqlite',
									schemaMigrations: 42,
									migrationsPending: false,
									uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) + 93784,
									replicaId: 'mock-replica-1'
								}
							: {})
					},
					pwa: options.pwaBuild === undefined ? DEMO_PWA_BUILD : options.pwaBuild
				}
			};
		}
		if (path === '/api/v1/auth/session' && method === 'DELETE') {
			sessions.delete(sessionId!);
			return { status: 204, sessionCookie: null };
		}
		if (path === '/api/v1/me/sessions' && method === 'DELETE') {
			for (const [id, other] of sessions) {
				if (id !== sessionId && other.accountId === account.id) sessions.delete(id);
			}
			return { status: 204 };
		}

		// A recovery session may only set up passkeys and revoke sessions.
		const ownPasskeys = () => passkeys.filter((p) => p.accountId === account.id);
		const ownIdentities = () => identities.filter((i) => i.accountId === account.id);
		const recoveryAllowed = path.startsWith('/api/v1/me/passkeys') && (method === 'POST' || method === 'GET');
		if (session.recovery && !recoveryAllowed) return error(403, 'recovery_session_restricted');

		if (path === '/api/v1/me/export' && method === 'GET') {
			const stamp = new Date().toISOString();
			const zip = writeZip({
				'manifest.json': JSON.stringify({ format: 'timetrack-export', version: 1, generatedAt: stamp, accountId: account.id, mock: true }, null, 2),
				'account.json': JSON.stringify({ handle: account.handle, displayName: account.displayName, role: account.role }, null, 2),
				'files.json': '[]'
			});
			return {
				status: 200,
				binary: { bytes: zip, contentType: 'application/zip', headers: { 'Content-Disposition': `attachment; filename="timetrack-export-${account.handle}.zip"` } }
			};
		}
		if (path === '/api/v1/me' && method === 'DELETE') return deleteAccountRules(session, account, body.confirmHandle, true);

		if (path === '/api/v1/me/passkeys' && method === 'GET') return { status: 200, body: ownPasskeys().map(publicPasskey) };
		if (path === '/api/v1/me/passkeys/options' && method === 'POST') {
			return { status: 200, body: creationOptions(account, 'add-passkey') };
		}
		if (path === '/api/v1/me/passkeys/verify' && method === 'POST') {
			const challenge = challenges.get(body.challengeId);
			if (!challenge || challenge.kind !== 'add-passkey' || !body.credential) return error(400, 'bad_request');
			challenges.delete(body.challengeId);
			seedPasskey(account.id, body.passkeyName || 'Passkey', body.credential.id);
			if (session.recovery) session.recovery = false; // assumption: a new passkey lifts the restriction
			return { status: 201, body: publicPasskey(passkeys[passkeys.length - 1]) };
		}
		if ((m = path.match(/^\/api\/v1\/me\/passkeys\/([^/]+)$/))) {
			const passkey = ownPasskeys().find((p) => p.id === m![1]);
			if (!passkey) return error(404, 'not_found');
			if (method === 'PATCH') {
				passkey.name = String(body.name ?? passkey.name);
				return { status: 200, body: publicPasskey(passkey) };
			}
			if (method === 'DELETE') {
				const hasRecovery =
					!!account.recoveryCodes?.length || !!account.fallbackPassword || account.emailRecovery.active;
				if (ownPasskeys().length === 1 && !hasRecovery && ownIdentities().length === 0) return error(409, 'last_passkey');
				passkeys.splice(passkeys.indexOf(passkey), 1);
				return { status: 204 };
			}
		}


		if (path === '/api/v1/me/identities' && method === 'GET') {
			return {
				status: 200,
				body: ownIdentities().map(({ sub: _s, accountId: _a, ...publicIdentity }) => publicIdentity)
			};
		}
		if ((m = path.match(/^\/api\/v1\/me\/identities\/([^/]+)$/)) && method === 'DELETE') {
			const identity = ownIdentities().find((i) => i.id === m![1]);
			if (!identity) return error(404, 'not_found');
			if (session.stale) return error(403, 'reauth_required');
			if (ownPasskeys().length === 0 && ownIdentities().length === 1) return error(409, 'last_login_method');
			identities.splice(identities.indexOf(identity), 1);
			return { status: 204 };
		}

		// --- profile and guided setup (P1, ADR-0019) ---
		const profileBody = () => ({
			handle: account.handle,
			displayName: account.displayName,
			email: account.email ?? null,
			emailVerified: !!account.emailVerified && !!account.email,
			pendingEmail: account.pendingEmail?.address ?? null,
			mailAvailable,
			onboarding: account.onboarding ?? { state: 'pending', updatedAt: null }
		});
		if (path === '/api/v1/me/profile' && method === 'GET') return { status: 200, body: profileBody() };
		if (path === '/api/v1/me/profile' && method === 'PATCH') {
			const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
			if (name.length < 1 || name.length > 80) return error(400, 'bad_request');
			account.displayName = name;
			return { status: 200, body: profileBody() };
		}
		if (path === '/api/v1/me/profile/email') {
			if (method === 'PUT') {
				if (session.stale) return error(403, 'reauth_required');
				if (!mailAvailable) return error(501, 'not_implemented');
				const address = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return error(400, 'bad_request');
				if (account.emailVerified && account.email === address) return error(400, 'bad_request');
				account.pendingEmail = { address, attempts: 0 };
				return { status: 202 };
			}
			if (method === 'DELETE') {
				if (session.stale) return error(403, 'reauth_required');
				account.email = undefined;
				account.emailVerified = false;
				account.pendingEmail = undefined;
				return { status: 204 };
			}
		}
		if (path === '/api/v1/me/profile/email/verify' && method === 'POST') {
			if (session.stale) return error(403, 'reauth_required');
			if (!mailAvailable) return error(501, 'not_implemented');
			const pending = account.pendingEmail;
			if (!pending || pending.attempts >= 5) return error(400, 'invalid_code');
			pending.attempts += 1;
			if (body.code !== '123456') return error(400, 'invalid_code');
			account.pendingEmail = undefined;
			// another account that already holds the address wins; the request is consumed
			if ([...accounts.values()].some((a) => a.id !== account.id && a.emailVerified && a.email === pending.address)) return error(409, 'email_taken');
			account.email = pending.address;
			account.emailVerified = true;
			return { status: 200, body: profileBody() };
		}
		if (path === '/api/v1/me/preferences' && method === 'GET') return { status: 200, body: preferencesBody(account) };
		if (path === '/api/v1/me/preferences' && method === 'PATCH') {
			// same rules as the backend (ADR-0020): merge patch, whitelist of keys, strict values
			const accents = ['blue', 'teal', 'violet', 'green', 'orange', 'pink', 'graphite', 'indigo', 'navy', 'purple', 'magenta', 'crimson', 'forest', 'petrol', 'bronze', 'wine', 'slate', 'cocoa', 'olive', 'ocean', 'ink', 'custom'];
			const glows = ['off', 'subtle', 'medium', 'strong'];
			const schemes = ['system', 'light', 'dark'];
			if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 1024) return error(400, 'bad_request');
			const keys = Object.keys(body);
			if (keys.length === 0 || keys.some((key) => !['accent', 'accentCustomHex', 'colorScheme', 'glow'].includes(key))) return error(400, 'bad_request');
			const next = { accent: 'blue', accentCustomHex: null as string | null, colorScheme: 'system', glow: 'subtle', ...account.preferences };
			if ('accent' in body) {
				if (!accents.includes(body.accent)) return error(400, 'bad_request');
				next.accent = body.accent;
				if (body.accent !== 'custom' && !('accentCustomHex' in body)) next.accentCustomHex = null;
			}
			if ('colorScheme' in body) {
				if (!schemes.includes(body.colorScheme)) return error(400, 'bad_request');
				next.colorScheme = body.colorScheme;
			}
			if ('glow' in body) {
				if (!glows.includes(body.glow)) return error(400, 'bad_request');
				next.glow = body.glow;
			}
			if ('accentCustomHex' in body) {
				if (body.accentCustomHex === null) next.accentCustomHex = null;
				else if (typeof body.accentCustomHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accentCustomHex)) next.accentCustomHex = body.accentCustomHex.toUpperCase();
				else return error(400, 'bad_request');
			}
			if ((next.accent === 'custom') !== (next.accentCustomHex !== null)) return error(400, 'bad_request');
			account.preferences = { ...next, updatedAt: new Date().toISOString() };
			return { status: 200, body: account.preferences };
		}
		if (path === '/api/v1/me/onboarding' && method === 'PUT') {
			if (!['pending', 'completed', 'skipped'].includes(body.state)) return error(400, 'bad_request');
			account.onboarding = { state: body.state, updatedAt: new Date().toISOString() };
			return { status: 200, body: profileBody() };
		}

		if (path === '/api/v1/me/recovery' && method === 'GET') {
			return {
				status: 200,
				body: {
					recoveryCodes: {
						active: !!account.recoveryCodes,
						remaining: account.recoveryCodes?.length ?? 0
					},
					fallbackPassword: { active: !!account.fallbackPassword },
					email: {
						available: mailAvailable,
						active: account.emailRecovery.active,
						verified: account.emailRecovery.verified
					}
				}
			};
		}
		if (path === '/api/v1/me/recovery/recovery-codes') {
			if (method === 'POST') {
				account.recoveryCodes = Array.from({ length: 8 }, () =>
					[0, 1, 2].map(() => randomToken().slice(0, 4).toUpperCase()).join('-')
				);
				return { status: 201, body: { codes: [...account.recoveryCodes] } };
			}
			if (method === 'DELETE') {
				account.recoveryCodes = null;
				return { status: 204 };
			}
		}
		if (path === '/api/v1/me/recovery/fallback-password') {
			if (method === 'PUT') {
				if (typeof body.password !== 'string' || body.password.length < 12) return error(400, 'bad_request');
				account.fallbackPassword = body.password;
				return { status: 204 };
			}
			if (method === 'DELETE') {
				account.fallbackPassword = null;
				return { status: 204 };
			}
		}
		if (path === '/api/v1/me/recovery/email') {
			if (method === 'PUT') {
				if (!mailAvailable) return error(501, 'not_implemented');
				account.email = body.email;
				account.emailRecovery = { active: false, verified: false };
				return { status: 202 };
			}
			if (method === 'DELETE') {
				account.emailRecovery = { active: false, verified: false };
				return { status: 204 };
			}
		}
		if (path === '/api/v1/me/recovery/email/verify' && method === 'POST') {
			if (body.code !== '123456') return error(400, 'invalid_code');
			account.emailRecovery = { active: true, verified: true };
			return { status: 204 };
		}

		const mailResponse = mail.handle(
			{ admin: account.role === 'admin', stale: !!session.stale, email: account.emailVerified ? account.email : undefined },
			{ method, path, body: req.body }
		);
		if (mailResponse) return mailResponse;

		const modulesResponse = modules.handle(account.id, account.role, { method, path, body: req.body });
		if (modulesResponse) return modulesResponse;
		const disabled = modules.guard(account.id, path);
		if (disabled) return disabled;

		const notificationsResponse = notifications.handle(account.id, { method, path: req.path, body: req.body });
		if (notificationsResponse) return notificationsResponse;

		const mcpResponse = mcp.handle(account.id, session, { method, path: req.path, body: req.body });
		if (mcpResponse) return mcpResponse;

		const weekResponse = week.handle(account.id, { method, path: req.path, body: req.body });
		if (weekResponse) return weekResponse;

		const timeResponse = time.handle(account.id, {
			method,
			path: req.path,
			body: req.body,
			ifMatch: req.ifMatch
		});
		if (timeResponse) return timeResponse;

		const transferResponse = transfer.handle(account.id, { method, path: req.path, body: req.body, file: req.file, role: account.role });
		if (transferResponse) return transferResponse;

		const reportsResponse = reports.handle(account.id, { method, path: req.path, body: req.body, ifMatch: req.ifMatch });
		if (reportsResponse) return reportsResponse;

		const vacationFormResponse = vacationForm.handle(account.id, { method, path: req.path, body: req.body, rawBody: req.rawBody, fileName: req.fileName, contentType: req.contentType });
		if (vacationFormResponse) return vacationFormResponse;

		const planningResponse = planning.handle(account.id, {
			method,
			path: req.path,
			body: req.body,
			ifMatch: req.ifMatch
		});
		if (planningResponse) return planningResponse;

		if (path.startsWith('/api/v1/admin/')) {
			if (account.role !== 'admin') return error(403, 'forbidden');
			if (path === '/api/v1/admin/accounts' && method === 'GET') {
				const query = new URLSearchParams(req.path.split('?')[1] ?? '');
				const limit = query.has('limit') ? Number(query.get('limit')) : 50;
				const offset = query.has('offset') ? Number(query.get('offset')) : 0;
				if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return error(400, 'bad_request');
				const all = [...accounts.values()].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.handle.localeCompare(b.handle));
				return { status: 200, body: { items: all.slice(offset, offset + limit).map(adminAccountView), total: all.length, limit, offset } };
			}
			if ((m = path.match(/^\/api\/v1\/admin\/accounts\/([^/]+)\/sessions$/)) && method === 'DELETE') {
				if (!accounts.has(m[1])) return error(404, 'not_found');
				revokeSessionsOf(m[1]);
				return { status: 204 };
			}
			if ((m = path.match(/^\/api\/v1\/admin\/accounts\/([^/]+)$/))) {
				const target = accounts.get(m[1]);
				if (!target) return error(404, 'not_found');
				if (method === 'PATCH') {
					const role = body.role;
					const state = body.state;
					if ((role === undefined && state === undefined) || (role !== undefined && role !== 'admin' && role !== 'member') || (state !== undefined && state !== 'active' && state !== 'disabled')) {
						return error(400, 'bad_request');
					}
					if (role !== undefined && session.stale) return error(403, 'reauth_required');
					if (target.id === account.id) return error(409, 'self_lockout');
					const losesAdmin = target.role === 'admin' && !target.disabledAt && (role === 'member' || state === 'disabled');
					if (losesAdmin && activeAdmins().length <= 1) return error(409, 'last_admin');
					if (role !== undefined) target.role = role;
					if (state === 'disabled' && !target.disabledAt) {
						target.disabledAt = new Date().toISOString();
						revokeSessionsOf(target.id);
					}
					if (state === 'active') target.disabledAt = null;
					return { status: 200, body: adminAccountView(target) };
				}
				if (method === 'DELETE') return deleteAccountRules(session, target, body.confirmHandle, false);
			}
			if (path === '/api/v1/admin/invitations' && method === 'GET') {
				const now = Date.now();
				for (const i of invitations) {
					if (i.status === 'open' && Date.parse(i.expiresAt) < now) i.status = 'expired';
				}
				return { status: 200, body: invitations.map(({ token: _token, ...rest }) => rest) };
			}
			if (path === '/api/v1/admin/invitations' && method === 'POST') {
				const hours = Number(body.expiresInHours ?? 72);
				if (!(hours >= 1 && hours <= 720)) return error(400, 'bad_request');
				const invitation: MockInvitation = {
					id: uuid(),
					token: randomToken(),
					note: body.note || null,
					createdAt: new Date().toISOString(),
					expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
					status: 'open'
				};
				invitations.push(invitation);
				return { status: 201, body: invitation };
			}
			if ((m = path.match(/^\/api\/v1\/admin\/invitations\/([^/]+)$/)) && method === 'DELETE') {
				const invitation = invitations.find((i) => i.id === m![1]);
				if (!invitation) return error(404, 'not_found');
				invitation.status = 'revoked';
				return { status: 204 };
			}
		}
		return error(404, 'not_found');
	}

	return { handle, state: { modules: modules.state, accounts, passkeys, sessions, invitations, identities, mcp: mcp.state, notifications: notifications.state } };
}
