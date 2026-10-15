import { ACCENT_PRESETS, DEFAULT_ACCENT, accentTokens, normalizeHex } from './accent';

export type ThemeMode = 'system' | 'light' | 'dark';
export type TransparencyMode = 'system' | 'reduced';

const KEY_MODE = 'tt.theme';
const KEY_ACCENT = 'tt.accent';
const KEY_TRANSPARENCY = 'tt.transparency';

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// storage can be blocked; the choice then only lasts for this tab
	}
}

/** Appearance preferences (mode, accent, transparency), persisted per browser and applied to <html>. */
class ThemeStore {
	mode = $state<ThemeMode>('system');
	accent = $state<string>(DEFAULT_ACCENT);
	transparency = $state<TransparencyMode>('system');
	systemDark = $state(false);
	private started = false;

	get dark(): boolean {
		return this.mode === 'dark' || (this.mode === 'system' && this.systemDark);
	}

	/** Reads the stored choices and wires the system-scheme listener. Safe to call more than once. */
	init(): void {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		const mode = read(KEY_MODE);
		if (mode === 'light' || mode === 'dark' || mode === 'system') this.mode = mode;
		const accent = normalizeHex(read(KEY_ACCENT) ?? '');
		if (accent) this.accent = accent;
		if (read(KEY_TRANSPARENCY) === 'reduced') this.transparency = 'reduced';
		const query = window.matchMedia?.('(prefers-color-scheme: dark)');
		if (query) {
			this.systemDark = query.matches;
			query.addEventListener?.('change', (event) => {
				this.systemDark = event.matches;
				this.apply();
			});
		}
		this.apply();
	}

	setMode(mode: ThemeMode): void {
		this.mode = mode;
		write(KEY_MODE, mode);
		this.apply();
	}

	/** Returns false (and keeps the current accent) for an invalid colour. */
	setAccent(input: string): boolean {
		const hex = normalizeHex(input);
		if (!hex) return false;
		this.accent = hex;
		write(KEY_ACCENT, hex);
		this.apply();
		return true;
	}

	resetAccent(): void {
		this.setAccent(DEFAULT_ACCENT);
	}

	setTransparency(mode: TransparencyMode): void {
		this.transparency = mode;
		write(KEY_TRANSPARENCY, mode);
		this.apply();
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
