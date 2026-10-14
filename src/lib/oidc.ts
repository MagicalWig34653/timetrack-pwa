import { api } from '#lib/api/client.js';
import { navigateTo } from '#lib/browser.js';
import type { OidcConfig, OidcPurpose } from '#lib/api/types.js';

/**
 * Reads the optional OIDC config. Any failure (old server, 404/501, network) means "not available":
 * the passkey login must never depend on this call.
 */
export async function loadOidcConfig(): Promise<OidcConfig & { enabled: boolean }> {
	try {
		const config = await api.oidcConfig();
		return config.enabled ? { enabled: true, name: config.name?.trim() || undefined } : { enabled: false };
	} catch {
		return { enabled: false };
	}
}

/** Starts the authorization code flow and navigates to the provider; throws ApiError on refusal. */
export async function startOidc(purpose: OidcPurpose, inviteToken?: string): Promise<void> {
	const { authorizationUrl } = await api.oidcStart(purpose, inviteToken);
	navigateTo(authorizationUrl);
}

/** Display name of the provider with a neutral fallback. */
export const providerLabel = (config: { name?: string }): string => config.name ?? 'externem Anbieter';
