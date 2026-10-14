import { createPlanningMock } from './planning.ts';
import { createTimeMock } from './time.ts';
import { createTransferMock, type UploadedFile } from './transfer.ts';

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
}

export interface MockResponse {
	status: number;
	body?: unknown;
	/** file download; replaces the JSON body */
	binary?: { bytes: Uint8Array; contentType: string; headers: Record<string, string> };
	/** Value for the tt_session cookie; null clears it; undefined leaves it untouched. */
	sessionCookie?: string | null;
}

interface MockAccount {
	id: string;
	handle: string;
	displayName: string;
	role: 'admin' | 'member';
	email?: string;
	recoveryCodes: string[] | null;
	fallbackPassword: string | null;
	emailRecovery: { active: boolean; verified: boolean };
}

interface MockSession {
	accountId: string;
	csrfToken: string;
	recovery: boolean;
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
	/** false mimics a server without mail delivery (email.available = false) */
	mailAvailable?: boolean;
	/** clock in epoch ms; defaults to Date.now. Lets tests freeze time for deterministic demo data. */
	now?: () => number;
	/** false skips the demo time-tracking data for the admin account */
	seedTime?: boolean;
	/** false skips the demo vacation/plan data, the second demo account and the demo share */
	seedPlanning?: boolean;
	/** false mimics a server without STORAGE_SECRET_KEY: S3 storage settings are refused with 501 */
	storageSecretKey?: boolean;
}

const uuid = () => crypto.randomUUID();
const randomToken = () => uuid().replace(/-/g, '');
const randomBase64url = () => btoa(randomToken()).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function publicPasskey({ credentialId: _credentialId, accountId: _accountId, ...rest }: MockPasskey) {
	return rest;
}

function error(status: number, code: string, message = code): MockResponse {
	return { status, body: { error: { code, message } } };
}

export function createMockApi(options: MockOptions = {}) {
	const mailAvailable = options.mailAvailable ?? true;
	const time = createTimeMock(options.now ?? Date.now);
	const accounts = new Map<string, MockAccount>();
	const planning = createPlanningMock({
		clock: options.now ?? Date.now,
		modelsOf: time.modelsOf,
		evaluateFor: time.evaluateFor,
		findByHandle: (handle) => [...accounts.values()].find((a) => a.handle === handle),
		displayNameOf: (id) => accounts.get(id)?.displayName ?? ''
	});
	time.setDayContext(planning.dayContext);
	const transfer = createTransferMock({
		clock: options.now ?? Date.now,
		displayNameOf: (id) => accounts.get(id)?.displayName ?? '',
		call: (accountId, method, path, body) => time.handle(accountId, { method, path, body }),
		absenceExists: (accountId, absenceId) => !!planning.states.get(accountId)?.absences.some((a) => a.id === absenceId),
		storageSecretKey: options.storageSecretKey ?? true
	});
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
		emailRecovery: { active: false, verified: false }
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
			emailRecovery: { active: false, verified: false }
		};
		accounts.set(lena.id, lena);
		time.seedDemo(lena.id);
		planning.seedDemo(admin.id);
		planning.seedDemo(lena.id);
		planning.seedShare(lena.id, admin.id, 'admin', { plan: true, actual: false, vacation: true });
	}
	invitations.push({
		id: uuid(),
		token: 'demo-invite',
		note: 'Demo',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
		status: 'open'
	});

	function sessionBody(session: MockSession) {
		const account = accounts.get(session.accountId)!;
		return {
			account: { id: account.id, handle: account.handle, displayName: account.displayName, role: account.role },
			csrfToken: session.csrfToken,
			recovery: session.recovery,
			expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString()
		};
	}

	function openSession(accountId: string, recovery = false): { id: string; session: MockSession } {
		const id = randomToken();
		const session = { accountId, csrfToken: randomToken(), recovery };
		lastAccountId = accountId;
		sessions.set(id, session);
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
				emailRecovery: { active: false, verified: false }
			};
			accounts.set(created.id, created);
			seedPasskey(created.id, body.passkeyName || 'Passkey', body.credential.id);
			const { id, session: opened } = openSession(created.id);
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
			const { id, session: opened } = openSession(target!.id, true);
			return { status: 200, body: sessionBody(opened), sessionCookie: id };
		}

		// Shortcuts: device token instead of cookie/CSRF.
		if (path === '/api/v1/automation/events' && method === 'POST') {
			return time.automationEvent(req.authorization, body);
		}

		// --- authenticated endpoints ---
		if (!session || !account) return error(401, 'unauthorized');
		if (mutating && req.csrfToken !== session.csrfToken) return error(403, 'csrf_invalid');

		if (path === '/api/v1/auth/session' && method === 'GET') return { status: 200, body: sessionBody(session) };
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
		const recoveryAllowed = path.startsWith('/api/v1/me/passkeys') && (method === 'POST' || method === 'GET');
		if (session.recovery && !recoveryAllowed) return error(403, 'recovery_session_restricted');

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
				if (ownPasskeys().length === 1 && !hasRecovery) return error(409, 'last_passkey');
				passkeys.splice(passkeys.indexOf(passkey), 1);
				return { status: 204 };
			}
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

		const timeResponse = time.handle(account.id, {
			method,
			path: req.path,
			body: req.body,
			ifMatch: req.ifMatch
		});
		if (timeResponse) return timeResponse;

		const transferResponse = transfer.handle(account.id, { method, path: req.path, body: req.body, file: req.file, role: account.role });
		if (transferResponse) return transferResponse;

		const planningResponse = planning.handle(account.id, {
			method,
			path: req.path,
			body: req.body,
			ifMatch: req.ifMatch
		});
		if (planningResponse) return planningResponse;

		if (path.startsWith('/api/v1/admin/')) {
			if (account.role !== 'admin') return error(403, 'forbidden');
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

	return { handle, state: { accounts, passkeys, sessions, invitations } };
}
