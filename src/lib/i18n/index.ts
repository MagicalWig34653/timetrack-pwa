import { ApiError } from '#lib/api/errors.js';
import { WebAuthnError } from '#lib/webauthn.js';
import type { McpScope } from '#lib/api/types.js';
import { de, type MessageKey } from './de';

export type { MessageKey } from './de';

/** Looks up a German message by its English key and fills `{name}` placeholders. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
	return de[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

function hasKey(key: string): key is MessageKey {
	return key in de;
}

/** " Bitte versuche es in etwa 5 Minuten erneut." for a Retry-After; empty when the server named no delay. */
function retryHint(seconds: number | null): string {
	if (seconds === null || seconds <= 0) return '';
	if (seconds < 90) return ' ' + t('error.retry_seconds', { count: Math.max(1, Math.round(seconds)) });
	if (seconds < 5400) return ' ' + t('error.retry_minutes', { count: Math.round(seconds / 60) });
	return ' ' + t('error.retry_hours', { count: Math.round(seconds / 3600) });
}

/** Maps any thrown error to a German, user-facing message. API error codes stay English. */
export function errorMessage(error: unknown): string {
	if (error instanceof WebAuthnError) return t(`webauthn.${error.kind}`);
	if (error instanceof ApiError) {
		const byCode = `error.${error.code}`;
		const base = hasKey(byCode) ? t(byCode) : hasKey(`error.status_${error.status}`) ? t(`error.status_${error.status}` as MessageKey) : null;
		if (base === null) return t('error.unknown');
		return error.status === 429 ? base + retryHint(error.retryAfterSeconds) : base;
	}
	return t('error.unknown');
}

/** German text for an `oidc_error` code from the callback redirect; unknown codes fall back to `oidc_failed`. */
export function oidcErrorMessage(code: string): string {
	const key = `oidc.error.${code}`;
	return t(hasKey(key) ? key : 'oidc.error.oidc_failed');
}

/** German label and plain-language description for an MCP scope. */
export function scopeText(scope: McpScope): { label: string; description: string } {
	const id = scope.replace(':', '_');
	return { label: t(`scope.${id}.label` as MessageKey), description: t(`scope.${id}.desc` as MessageKey) };
}
