import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import type { Session } from '#lib/api/types.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { theme } from '#lib/theme/theme.svelte.js';

class SessionStore {
	current = $state<Session | null>(null);
	loaded = $state(false);

	/** Reads GET /auth/session. 401 means signed out; other errors propagate. */
	async refresh(): Promise<Session | null> {
		try {
			this.current = await api.currentSession();
			this.refreshedAt = Date.now();
			this.reconcileTheme();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				this.current = null;
				setCsrfToken(null);
				moduleStore.reset();
				theme.detach();
			} else throw error;
		}
		this.loaded = true;
		return this.current;
	}

	private refreshedAt = 0;

	/**
	 * Route guard variant of refresh(): within a short window the session read is not repeated on every navigation, so
	 * switching between sibling pages does not wait for a round trip before anything changes. A revoked session still
	 * surfaces on the next API call (401) or after the window.
	 */
	async ensureFresh(maxAgeMs = 20_000): Promise<Session | null> {
		if (this.current && Date.now() - this.refreshedAt < maxAgeMs) return this.current;
		return this.refresh();
	}

	set(session: Session): void {
		this.current = session;
		this.refreshedAt = Date.now();
		this.loaded = true;
		setCsrfToken(session.csrfToken);
		this.reconcileTheme();
	}

	/** Merges the account's appearance preferences (session response, contract v0.14.0) into the local theme. */
	private reconcileTheme(): void {
		const session = this.current;
		if (session) theme.reconcile(session.account.id, session.account.preferences, !session.recovery);
	}

	async signOut(): Promise<void> {
		try {
			await api.logout();
		} finally {
			this.current = null;
			setCsrfToken(null);
			moduleStore.reset();
			theme.detach();
		}
	}
}

export const sessionStore = new SessionStore();

/** Only allow same-origin absolute paths as post-login targets. */
export function safeNext(next: string | null | undefined): string {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
