import { api, ApiError } from '#lib/api/client.js';
import type { Preferences, PreferencesPatch } from '#lib/api/types.js';
import {
	ACCENT_PRESETS,
	DEFAULT_ACCENT,
	accentTokens,
	isPresetId,
	normalizeHex,
	presetHex,
	presetIdForHex,
	type AccentId
} from './accent';

export type ThemeMode = 'system' | 'light' | 'dark';
export type TransparencyMode = 'system' | 'reduced';
/** `idle`: nothing to report (signed out or older server), `saving`, `saved` (the account holds the value), `pending` (not sent yet). */
export type SyncState = 'idle' | 'saving' | 'saved' | 'pending';

const KEY_MODE = 'tt.theme';
const KEY_ACCENT = 'tt.accent';
const KEY_ACCENT_ID = 'tt.accentId';
const KEY_TRANSPARENCY = 'tt.transparency';
/** Account the cached accent/scheme belongs to (set after a reconcile). */
const KEY_OWNER = 'tt.prefsOwner';
/** Account id of a local change that the server has not acknowledged yet (offline or failed write). */
const KEY_PENDING = 'tt.prefsPending';

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// storage can be blocked; the choice then only lasts for this tab
	}
}

/**
 * Appearance preferences. Accent and colour scheme belong to the account (ADR-0020) and are mirrored to localStorage as an
 * instant-apply cache and offline fallback; the transparency switch stays device-local.
 *
 * Reconciliation (`reconcile`, called whenever a session is loaded): an unsent local change of the same account wins and is
 * pushed (last write wins); otherwise the server values replace the cache. A server that never stored anything adopts the
 * cached choice once, but only if the cache was not written for another account.
 */
class ThemeStore {
	mode = $state<ThemeMode>('system');
	accentId = $state<AccentId>('blue');
	accent = $state<string>(DEFAULT_ACCENT);
	transparency = $state<TransparencyMode>('system');
	systemDark = $state(false);
	sync = $state<SyncState>('idle');
	private started = false;
	/** Account whose preferences are synced; null while signed out, in a recovery session or on a server without the endpoint. */
	private syncAccount: string | null = null;
	private flushing = false;

	get dark(): boolean {
		return this.mode === 'dark' || (this.mode === 'system' && this.systemDark);
	}

	/** Reads the cache and wires the system-scheme listener. Safe to call more than once. */
	init(): void {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		const mode = read(KEY_MODE);
		if (mode === 'light' || mode === 'dark' || mode === 'system') this.mode = mode;
		const accent = normalizeHex(read(KEY_ACCENT) ?? '');
		if (accent) {
			this.accent = accent;
			const id = read(KEY_ACCENT_ID);
			// caches written before ADR-0020 carry only the colour
			this.accentId = id === 'custom' ? 'custom' : isPresetId(id) && presetHex(id) === accent ? id : (presetIdForHex(accent) ?? 'custom');
		}
		if (read(KEY_TRANSPARENCY) === 'reduced') this.transparency = 'reduced';
		const query = window.matchMedia?.('(prefers-color-scheme: dark)');
		if (query) {
			this.systemDark = query.matches;
			query.addEventListener?.('change', (event) => {
				this.systemDark = event.matches;
				this.apply();
			});
		}
		window.addEventListener('online', () => void this.flush());
		this.apply();
	}

	setMode(mode: ThemeMode): void {
		this.mode = mode;
		write(KEY_MODE, mode);
		this.apply();
		this.changed();
	}

	/** Chooses a palette preset. */
	setPreset(id: Exclude<AccentId, 'custom'>): void {
		this.accentId = id;
		this.accent = presetHex(id);
		this.storeAccent();
		this.apply();
		this.changed();
	}

	/** Chooses a custom colour. Returns false (and keeps the current accent) for an invalid colour. */
	setAccent(input: string): boolean {
		const hex = normalizeHex(input);
		if (!hex) return false;
		this.accentId = 'custom';
		this.accent = hex;
		this.storeAccent();
		this.apply();
		this.changed();
		return true;
	}

	resetAccent(): void {
		this.setPreset('blue');
	}

	setTransparency(mode: TransparencyMode): void {
		this.transparency = mode;
		write(KEY_TRANSPARENCY, mode);
		this.apply();
	}

	private storeAccent(): void {
		write(KEY_ACCENT, this.accent);
		write(KEY_ACCENT_ID, this.accentId);
	}

	// MARK: account sync

	/** The state as a PATCH body (the colour only for a custom accent). */
	private patch(): PreferencesPatch {
		return this.accentId === 'custom'
			? { accent: 'custom', accentCustomHex: this.accent, colorScheme: this.mode }
			: { accent: this.accentId, colorScheme: this.mode };
	}

	private changed(): void {
		if (!this.syncAccount) return;
		write(KEY_PENDING, this.syncAccount);
		write(KEY_OWNER, this.syncAccount);
		this.sync = 'pending';
		void this.flush();
	}

	/** Sends the pending local state; repeats while the user keeps changing it. Failures leave it pending for the next attempt. */
	async flush(): Promise<void> {
		const account = this.syncAccount;
		if (!account || this.flushing || read(KEY_PENDING) !== account) return;
		this.flushing = true;
		try {
			while (read(KEY_PENDING) === account && this.syncAccount === account) {
				const sent = JSON.stringify(this.patch());
				this.sync = 'saving';
				try {
					await api.updatePreferences(this.patch());
				} catch (error) {
					// a refused value (400) would fail forever: drop it, the next session load shows the account's value
					if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403 && error.status !== 429) {
						write(KEY_PENDING, null);
						this.sync = 'idle';
					} else this.sync = 'pending';
					return;
				}
				if (JSON.stringify(this.patch()) === sent) {
					write(KEY_PENDING, null);
					this.sync = 'saved';
				}
			}
		} finally {
			this.flushing = false;
		}
	}

	/**
	 * Merges the account's preferences into the local state (see the class comment). `preferences` is undefined for servers
	 * older than v0.14.0 and for recovery sessions, which may not write; then the cache stays as it is.
	 */
	reconcile(accountId: string, preferences: Preferences | undefined, canWrite = true): void {
		if (typeof window === 'undefined') return;
		this.init();
		if (!preferences) {
			this.syncAccount = null;
			this.sync = 'idle';
			return;
		}
		this.syncAccount = canWrite ? accountId : null;
		const owner = read(KEY_OWNER);
		const pendingFor = read(KEY_PENDING);
		const neverSet = !preferences.updatedAt;
		const cacheIsDefault = this.accentId === 'blue' && this.mode === 'system';
		if (pendingFor === accountId || (neverSet && !cacheIsDefault && (owner === null || owner === accountId))) {
			// an unsent local change, or a pre-account choice of this browser that the account has not seen yet
			if (canWrite) {
				this.changed();
				return;
			}
			// a recovery session cannot write: keep the local choice until a normal session can send it
			if (pendingFor === accountId) return;
		}
		this.adopt(preferences);
		write(KEY_OWNER, accountId);
		// an unsent change of another account must not leak into this one or be sent later with these values
		write(KEY_PENDING, null);
		this.sync = canWrite ? 'saved' : 'idle';
	}

	/** Replaces the local state with the account's values and refreshes the cache. */
	private adopt(preferences: Preferences): void {
		const mode = preferences.colorScheme;
		this.mode = mode === 'light' || mode === 'dark' ? mode : 'system';
		write(KEY_MODE, this.mode);
		const custom = preferences.accent === 'custom' ? normalizeHex(preferences.accentCustomHex ?? '') : null;
		if (custom) {
			this.accentId = 'custom';
			this.accent = custom;
		} else {
			const id = isPresetId(preferences.accent) ? preferences.accent : 'blue';
			this.accentId = id;
			this.accent = presetHex(id);
		}
		this.storeAccent();
		this.apply();
	}

	/** Re-reads the account's values (used when the appearance page opens, in case another device changed them). */
	async refreshFromServer(): Promise<void> {
		const account = this.syncAccount;
		if (!account) return;
		await this.flush();
		if (read(KEY_PENDING) === account) return;
		try {
			const preferences = await api.getPreferences();
			if (this.syncAccount === account && read(KEY_PENDING) !== account) {
				this.adopt(preferences);
				this.sync = 'saved';
			}
		} catch {
			// offline: keep the cache
		}
	}

	/** Called on sign-out: the cache stays for the login screen, the sync stops. */
	detach(): void {
		this.syncAccount = null;
		this.sync = 'idle';
	}

	apply(): void {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		root.classList.toggle('dark', this.dark);
		if (this.transparency === 'reduced') root.dataset.transparency = 'reduced';
		else delete root.dataset.transparency;
		const tokens = accentTokens(this.accent, this.dark) ?? accentTokens(DEFAULT_ACCENT, this.dark);
		if (!tokens) return;
		root.style.setProperty('--ui-accent', tokens.primary);
		root.style.setProperty('--ui-accent-foreground', tokens.foreground);
		root.style.setProperty('--ui-accent-ink', tokens.ink);
		root.style.setProperty('--ui-accent-soft', tokens.soft);
		// the neutral primary (buttons) follows the accent so that the primary action is accent-coloured
		root.style.setProperty('--primary', tokens.primary);
		root.style.setProperty('--primary-foreground', tokens.foreground);
	}
}

export const theme = new ThemeStore();
export { ACCENT_PRESETS };
