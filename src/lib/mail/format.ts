import type { MailCheckStep, MailStatus, MailStepId } from '#lib/api/types.js';
import type { MessageKey } from '#lib/i18n/index.js';

export const STEP_IDS: MailStepId[] = ['dns', 'tcp', 'tls', 'ehlo', 'auth', 'mailFrom'];

/** "412 ms" below a second, "1,2 s" above. */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
	return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export const stepTitleKey = (id: MailStepId): MessageKey => `mail.step.${id === 'mailFrom' ? 'mail_from' : id}` as MessageKey;

export function tlsKeys(tls: NonNullable<MailStatus['tls']>): { label: MessageKey; text: MessageKey; tone: 'success' | 'accent' | 'warning' } {
	if (tls === 'implicit') return { label: 'mail.tls.implicit', text: 'mail.tls.implicit_text', tone: 'success' };
	if (tls === 'starttls') return { label: 'mail.tls.starttls', text: 'mail.tls.starttls_text', tone: 'success' };
	return { label: 'mail.tls.off', text: 'mail.tls.off_text', tone: 'warning' };
}

/** The environment lines a not yet configured server needs, as copyable text (values are placeholders). */
export const SETUP_LINES = {
	required: ['SMTP_HOST=smtp.example.org', 'SMTP_FROM=timetrack@example.org'],
	optional: ['SMTP_PORT=587', 'SMTP_TLS=starttls', 'SMTP_USER=timetrack@example.org', 'SMTP_PASSWORD_FILE=/run/secrets/tt_smtp_password']
} as const;

export function setupExample(): string {
	return [...SETUP_LINES.required, ...SETUP_LINES.optional].join('\n');
}

/** Steps shown while the single response is on its way: all pending. */
export function pendingSteps(): { id: MailStepId }[] {
	return STEP_IDS.map((id) => ({ id }));
}

export function stepProblemAdvice(step: MailCheckStep): string | null {
	return step.status === 'failed' && step.problem ? step.problem.advice : null;
}
