import { ApiError } from '#lib/api/errors.js';
import { WebAuthnError } from '#lib/webauthn.js';
import { de, type MessageKey } from './de';

export type { MessageKey } from './de';

/** Looks up a German message by its English key and fills `{name}` placeholders. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
	return de[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

function hasKey(key: string): key is MessageKey {
	return key in de;
}

/** Maps any thrown error to a German, user-facing message. API error codes stay English. */
export function errorMessage(error: unknown): string {
	if (error instanceof WebAuthnError) return t(`webauthn.${error.kind}`);
	if (error instanceof ApiError) {
		const byCode = `error.${error.code}`;
		if (hasKey(byCode)) return t(byCode);
		const byStatus = `error.status_${error.status}`;
		if (hasKey(byStatus)) return t(byStatus);
	}
	return t('error.unknown');
}

/** German text for an `oidc_error` code from the callback redirect; unknown codes fall back to `oidc_failed`. */
export function oidcErrorMessage(code: string): string {
	const key = `oidc.error.${code}`;
	return t(hasKey(key) ? key : 'oidc.error.oidc_failed');
}
