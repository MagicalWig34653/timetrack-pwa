import type { MailCheckResult, MailCheckStep, MailStatus } from '../src/lib/api/types.ts';

// Mock of the e-mail diagnosis of contract v0.18.0 (package MAIL1, ADR-0022): GET /admin/mail, POST /admin/mail/check and
// POST /admin/mail/test. The check is a scripted scenario, nothing is really connected.
// Mock-only hook (authenticated): POST /api/v1/mock/mail {scenario?, rateLimit?, old?}
//   scenario: 'ok' | 'tls' | 'auth' | 'sender' | 'not_configured'; old=true answers 404 like a server without the endpoints.

export type MailScenario = 'ok' | 'tls' | 'auth' | 'sender' | 'not_configured';
export interface MailResponse {
	status: number;
	body?: unknown;
}
const fail = (status: number, code: string): MailResponse => ({ status, body: { error: { code, message: code } } });

const STEP_TITLES = { dns: 'Servername auflösen', tcp: 'Verbindung aufbauen', tls: 'Verschlüsselung', ehlo: 'Server-Fähigkeiten', auth: 'Anmeldung', mailFrom: 'Absender prüfen' } as const;

export function createMailMock(options: { configured?: boolean } = {}) {
	const state = { scenario: (options.configured === false ? 'not_configured' : 'ok') as MailScenario, rateLimit: false, old: false, testsSent: 0 };

	const status = (): MailStatus =>
		state.scenario === 'not_configured'
			? {
					configured: false,
					authConfigured: false,
					source: 'environment',
					hints: [{ severity: 'info', code: 'not_configured', message: 'Auf diesem Server ist kein E-Mail-Versand eingerichtet.' }]
				}
			: {
					configured: true,
					host: 'smtp.example.org',
					port: 587,
					tls: 'starttls',
					fromAddress: 'timetrack@example.org',
					fromName: 'Timetrack',
					authConfigured: true,
					source: 'environment',
					hints: [
						{
							severity: 'info',
							code: 'from_domain_differs_from_public_url',
							message: 'Die Domain der Absenderadresse weicht von der Adresse ab, unter der Timetrack erreichbar ist (PUBLIC_BASE_URL).'
						}
					]
				};

	function check(): MailCheckResult {
		const step = (id: keyof typeof STEP_TITLES, status: MailCheckStep['status'], durationMs: number, details: string[], extra: Partial<MailCheckStep> = {}): MailCheckStep => ({
			id,
			title: STEP_TITLES[id],
			status,
			durationMs,
			details,
			warnings: [],
			...extra
		});
		const skipped = (id: keyof typeof STEP_TITLES) => step(id, 'skipped', 0, ['Übersprungen, weil ein früherer Schritt fehlgeschlagen ist.']);
		const cert = { subject: 'smtp.example.org', issuer: 'Example CA', validFrom: '2026-08-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', daysLeft: 76, hostnameMatches: true };
		const dns = step('dns', 'ok', 12, ['smtp.example.org → 1 Adresse: 192.0.2.25']);
		const tcp = step('tcp', 'ok', 41, ['Verbunden mit 192.0.2.25 auf Port 587', 'Begrüßung: 220 smtp.example.org ESMTP']);
		const tls = step('tls', 'ok', 88, ['Verschlüsselt mit TLS 1.3 (STARTTLS)', 'Zertifikat für smtp.example.org, ausgestellt von Example CA', 'Gültig bis 2027-01-01 (noch 76 Tage)'], { certificate: cert });
		const ehlo = step('ehlo', 'ok', 30, ['Anmeldeverfahren: PLAIN, LOGIN', 'Maximale Nachrichtengröße: 25 MB']);
		const auth = step('auth', 'ok', 120, ['Angemeldet (Verfahren PLAIN). Das Passwort wird nie angezeigt.']);
		const mailFrom = step('mailFrom', 'ok', 35, ['Absender „timetrack@example.org“ wird akzeptiert. Die Sitzung wurde ohne Nachricht beendet.']);
		let steps: MailCheckStep[] = [dns, tcp, tls, ehlo, auth, mailFrom];
		if (state.scenario === 'tls') {
			steps = [
				dns,
				tcp,
				step('tls', 'failed', 95, [], {
					certificate: { ...cert, issuer: 'Unknown Test CA', daysLeft: -3, validUntil: '2026-10-14T00:00:00Z' },
					problem: {
						code: 'certificate_expired',
						message: 'Das Zertifikat des Servers ist am 2026-10-14 abgelaufen.',
						advice: 'Das Zertifikat muss beim Mailanbieter bzw. auf dem Mailserver erneuert werden. Timetrack akzeptiert keine abgelaufenen Zertifikate.'
					}
				}),
				skipped('ehlo'),
				skipped('auth'),
				skipped('mailFrom')
			];
		} else if (state.scenario === 'auth') {
			steps = [
				dns,
				tcp,
				tls,
				ehlo,
				step('auth', 'failed', 140, [], {
					problem: {
						code: 'auth_rejected',
						message: 'Die Anmeldung wurde abgelehnt (Antwort 535). Benutzername oder Passwort stimmen nicht.',
						advice: 'Prüfe SMTP_USER und SMTP_PASSWORD. Manche Anbieter verlangen ein eigenes App-Passwort oder lassen die Anmeldung nur mit der vollständigen E-Mail-Adresse zu.'
					}
				}),
				skipped('mailFrom')
			];
		} else if (state.scenario === 'sender') {
			steps = [
				dns,
				tcp,
				tls,
				ehlo,
				auth,
				step('mailFrom', 'failed', 33, ['Antwort des Servers: 550 Sender not allowed'], {
					problem: {
						code: 'sender_rejected',
						message: 'Der Server lehnt die Absenderadresse „timetrack@example.org“ ab (Antwort 550).',
						advice: 'Die Adresse in SMTP_FROM muss zum angemeldeten Konto gehören oder beim Anbieter als Absender freigegeben sein.'
					}
				})
			];
		}
		const failed = steps.find((s) => s.status === 'failed');
		return {
			ok: !failed,
			summary: failed
				? `Die Prüfung ist bei „${failed.title}“ fehlgeschlagen. ${failed.problem?.message ?? ''}`
				: 'Alles in Ordnung: Der Server ist erreichbar, die Verschlüsselung und die Anmeldung funktionieren und der Absender wird akzeptiert. Es wurde keine Nachricht gesendet.',
			checkedAt: new Date().toISOString(),
			totalMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
			steps
		};
	}

	/** `ctx.admin`/`ctx.stale`/`ctx.email` come from the caller's session and account. */
	function handle(ctx: { admin: boolean; stale: boolean; email?: string }, req: { method: string; path: string; body?: any }): MailResponse | null {
		const { method, path, body } = req;
		if (!path.startsWith('/api/v1/admin/mail')) return null;
		if (state.old) return fail(404, 'not_found');
		if (!ctx.admin) return fail(403, 'forbidden');
		if (path === '/api/v1/admin/mail' && method === 'GET') return { status: 200, body: status() };
		if (path === '/api/v1/admin/mail/check' && method === 'POST') {
			if (state.scenario === 'not_configured') return fail(501, 'not_implemented');
			if (state.rateLimit) return fail(429, 'too_many_requests');
			return { status: 200, body: check() };
		}
		if (path === '/api/v1/admin/mail/test' && method === 'POST') {
			if (ctx.stale) return fail(403, 'reauth_required');
			if (state.scenario === 'not_configured') return fail(501, 'not_implemented');
			const to = typeof body?.to === 'string' && body.to.trim() ? body.to.trim().toLowerCase() : ctx.email;
			if (!to) return fail(400, 'no_recipient');
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return fail(400, 'bad_request');
			if (state.rateLimit) return fail(429, 'too_many_requests');
			if (state.scenario === 'auth') return fail(502, 'mail_auth_failed');
			if (state.scenario === 'tls') return fail(502, 'mail_tls_failed');
			if (state.scenario === 'sender') return fail(502, 'mail_sender_rejected');
			state.testsSent += 1;
			return { status: 200, body: { sent: true, to, durationMs: 412 } };
		}
		return null;
	}

	function hook(body: any): MailResponse {
		if (typeof body?.scenario === 'string') state.scenario = body.scenario as MailScenario;
		if (typeof body?.rateLimit === 'boolean') state.rateLimit = body.rateLimit;
		if (typeof body?.old === 'boolean') state.old = body.old;
		return { status: 200, body: { ...state } };
	}

	return { handle, hook, state };
}
