import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '#lib/api/types.js';

const update = vi.fn();
const fetchPrefs = vi.fn();

vi.mock('#lib/api/client.js', async (original) => ({
	...(await original<typeof import('#lib/api/client.js')>()),
	api: { updatePreferences: (...args: unknown[]) => update(...args), getPreferences: () => fetchPrefs() }
}));

async function freshTheme() {
	vi.resetModules();
	const { theme } = await import('./theme.svelte.js');
	theme.init();
	return theme;
}

const defaults: Preferences = { accent: 'blue', colorScheme: 'system' };
const stored = (accent: Preferences['accent'], colorScheme: Preferences['colorScheme'] = 'system', accentCustomHex: string | null = null): Preferences => ({
	accent,
	accentCustomHex,
	colorScheme,
	updatedAt: '2026-10-16T10:00:00Z'
});
const accentVar = () => document.documentElement.style.getPropertyValue('--ui-accent');

describe('theme store with account preferences', () => {
	beforeEach(() => {
		localStorage.clear();
		update.mockReset();
		update.mockImplementation(async (patch) => ({ ...defaults, ...patch, updatedAt: '2026-10-16T11:00:00Z' }));
		fetchPrefs.mockReset();
		document.documentElement.removeAttribute('style');
		document.documentElement.className = '';
	});

	it('applies the cache at startup and understands caches written before the account sync', async () => {
		localStorage.setItem('tt.accent', '#0d9488');
		localStorage.setItem('tt.theme', 'dark');
		const theme = await freshTheme();
		expect(theme.accentId).toBe('teal');
		expect(accentVar()).toBe('#0d9488');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		localStorage.setItem('tt.accent', '#facc15');
		expect((await freshTheme()).accentId).toBe('custom');
	});

	it('adopts the account values and refreshes the cache', async () => {
		const theme = await freshTheme();
		theme.reconcile('a1', stored('violet', 'dark'));
		expect(theme.accentId).toBe('violet');
		expect(accentVar()).toBe('#7c3aed');
		expect(theme.mode).toBe('dark');
		expect(localStorage.getItem('tt.accentId')).toBe('violet');
		expect(localStorage.getItem('tt.theme')).toBe('dark');
		expect(theme.sync).toBe('saved');
		expect(update).not.toHaveBeenCalled();
		theme.reconcile('a1', stored('custom', 'light', '#12AB9F'));
		expect(theme.accentId).toBe('custom');
		expect(theme.accent).toBe('#12ab9f');
	});

	it('sends a change as a patch and marks it saved', async () => {
		const theme = await freshTheme();
		theme.reconcile('a1', stored('blue'));
		theme.setPreset('pink');
		await theme.flush();
		await vi.waitFor(() => expect(theme.sync).toBe('saved'));
		expect(update).toHaveBeenCalledWith({ accent: 'pink', colorScheme: 'system' });
		theme.setAccent('#FACC15');
		await vi.waitFor(() => expect(theme.sync).toBe('saved'));
		expect(update).toHaveBeenLastCalledWith({ accent: 'custom', accentCustomHex: '#facc15', colorScheme: 'system' });
		theme.setMode('dark');
		await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(3));
		await vi.waitFor(() => expect(theme.sync).toBe('saved'));
		expect(localStorage.getItem('tt.prefsPending')).toBeNull();
	});

	it('keeps an unsent change and sends it with the next session (last write wins)', async () => {
		const theme = await freshTheme();
		theme.reconcile('a1', stored('blue'));
		update.mockRejectedValueOnce(new TypeError('offline'));
		theme.setPreset('green');
		await vi.waitFor(() => expect(theme.sync).toBe('pending'));
		expect(localStorage.getItem('tt.prefsPending')).toBe('a1');
		// the next session still carries the old server value: the local choice is kept and pushed
		const reloaded = await freshTheme();
		reloaded.reconcile('a1', stored('blue'));
		await vi.waitFor(() => expect(reloaded.sync).toBe('saved'));
		expect(reloaded.accentId).toBe('green');
		expect(update).toHaveBeenLastCalledWith({ accent: 'green', colorScheme: 'system' });
	});

	it('does not leak an unsent change of one account into another', async () => {
		const theme = await freshTheme();
		theme.reconcile('a1', stored('blue'));
		update.mockRejectedValueOnce(new TypeError('offline'));
		theme.setPreset('green');
		await vi.waitFor(() => expect(theme.sync).toBe('pending'));
		const other = await freshTheme();
		update.mockClear();
		other.reconcile('b2', stored('orange'));
		expect(other.accentId).toBe('orange');
		expect(update).not.toHaveBeenCalled();
		expect(localStorage.getItem('tt.prefsPending')).toBeNull();
	});

	it('uploads the pre-account choice of this browser once, but not into another account', async () => {
		localStorage.setItem('tt.accent', '#7c3aed');
		const theme = await freshTheme();
		theme.reconcile('a1', defaults);
		await vi.waitFor(() => expect(theme.sync).toBe('saved'));
		expect(update).toHaveBeenCalledWith({ accent: 'violet', colorScheme: 'system' });

		localStorage.clear();
		localStorage.setItem('tt.accent', '#7c3aed');
		localStorage.setItem('tt.prefsOwner', 'a1');
		const other = await freshTheme();
		update.mockClear();
		other.reconcile('b2', defaults);
		expect(update).not.toHaveBeenCalled();
		expect(other.accentId).toBe('blue');
	});

	it('does not write for recovery sessions or older servers, and drops values the server refuses', async () => {
		const theme = await freshTheme();
		theme.reconcile('a1', stored('teal'), false);
		theme.setPreset('pink');
		expect(update).not.toHaveBeenCalled();
		theme.reconcile('a1', undefined);
		theme.setPreset('green');
		expect(update).not.toHaveBeenCalled();
		expect(theme.sync).toBe('idle');

		const { ApiError } = await import('#lib/api/client.js');
		theme.reconcile('a1', stored('teal'));
		update.mockRejectedValueOnce(new ApiError(400, 'bad_request', 'x'));
		theme.setPreset('orange');
		await vi.waitFor(() => expect(theme.sync).toBe('idle'));
		expect(localStorage.getItem('tt.prefsPending')).toBeNull();
	});

	it('keeps the transparency switch device-local', async () => {
		const theme = await freshTheme();
		theme.reconcile('a1', stored('blue'));
		theme.setTransparency('reduced');
		expect(update).not.toHaveBeenCalled();
		expect(localStorage.getItem('tt.transparency')).toBe('reduced');
	});

	it('refreshFromServer adopts changes made elsewhere unless a local change is pending', async () => {
		const theme = await freshTheme();
		theme.reconcile('a1', stored('blue'));
		fetchPrefs.mockResolvedValue(stored('graphite', 'light'));
		await theme.refreshFromServer();
		expect(theme.accentId).toBe('graphite');
		expect(theme.mode).toBe('light');
	});

	describe('glow (contract v0.15.0)', () => {
		const withGlow = (accent: Preferences['accent'], glow: NonNullable<Preferences['glow']>, hex: string | null = null): Preferences => ({ ...stored(accent, 'system', hex), glow });
		const rootGlow = () => document.documentElement.dataset.glow;

		it('defaults to subtle and writes data-glow and the glow colour on <html>', async () => {
			const theme = await freshTheme();
			expect(theme.glow).toBe('subtle');
			expect(rootGlow()).toBe('subtle');
			expect(document.documentElement.style.getPropertyValue('--glow-color')).toBe('#2563eb');
			theme.setPreset('orange');
			expect(document.documentElement.style.getPropertyValue('--glow-color')).toBe('#d97706');
		});

		it('applies the cached level at startup and ignores a garbage cache', async () => {
			localStorage.setItem('tt.glow', 'strong');
			expect((await freshTheme()).glow).toBe('strong');
			localStorage.setItem('tt.glow', 'blinding');
			expect((await freshTheme()).glow).toBe('subtle');
		});

		it('adopts the account level and sends it with the patch', async () => {
			const theme = await freshTheme();
			theme.reconcile('a1', withGlow('blue', 'medium'));
			expect(theme.glow).toBe('medium');
			expect(localStorage.getItem('tt.glow')).toBe('medium');
			theme.setGlow('strong');
			await vi.waitFor(() => expect(theme.sync).toBe('saved'));
			expect(rootGlow()).toBe('strong');
			expect(update).toHaveBeenLastCalledWith({ accent: 'blue', colorScheme: 'system', glow: 'strong' });
			theme.setGlow('off');
			await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
			expect(localStorage.getItem('tt.glow')).toBe('off');
		});

		it('keeps working against a server without glow: local only, new accents stored as custom', async () => {
			const theme = await freshTheme();
			theme.reconcile('a1', stored('blue'));
			theme.setGlow('strong');
			await vi.waitFor(() => expect(update).toHaveBeenCalled());
			expect(update).toHaveBeenLastCalledWith({ accent: 'blue', colorScheme: 'system' });
			expect(theme.glow).toBe('strong');
			theme.setPreset('navy');
			await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
			expect(update).toHaveBeenLastCalledWith({ accent: 'custom', accentCustomHex: '#1e3a8a', colorScheme: 'system' });
			// a reload keeps the local level because the server does not know it
			const reloaded = await freshTheme();
			reloaded.reconcile('a1', stored('custom', 'system', '#1E3A8A'));
			expect(reloaded.glow).toBe('strong');
		});

		it('falls back to the old request shape when a server rejects glow or a new accent id', async () => {
			const { ApiError } = await import('#lib/api/client.js');
			const theme = await freshTheme();
			theme.reconcile('a1', withGlow('blue', 'subtle'));
			update.mockRejectedValueOnce(new ApiError(400, 'bad_request', 'x'));
			theme.setPreset('forest');
			await vi.waitFor(() => expect(theme.sync).toBe('saved'));
			expect(update).toHaveBeenNthCalledWith(1, { accent: 'forest', colorScheme: 'system', glow: 'subtle' });
			expect(update).toHaveBeenNthCalledWith(2, { accent: 'custom', accentCustomHex: '#166534', colorScheme: 'system' });
			expect(theme.accentId).toBe('forest');
		});

		it('keeps glow on a v0.15.0 to v0.20.0 server that rejects only the v0.21.0 accent ids', async () => {
			const { ApiError } = await import('#lib/api/client.js');
			const theme = await freshTheme();
			theme.reconcile('a1', withGlow('blue', 'medium'));
			update.mockRejectedValueOnce(new ApiError(400, 'bad_request', 'x'));
			theme.setPreset('wine');
			await vi.waitFor(() => expect(theme.sync).toBe('saved'));
			expect(update).toHaveBeenNthCalledWith(1, { accent: 'wine', colorScheme: 'system', glow: 'medium' });
			expect(update).toHaveBeenNthCalledWith(2, { accent: 'custom', accentCustomHex: '#7f1d3f', colorScheme: 'system', glow: 'medium' });
			expect(theme.accentId).toBe('wine');
			// older ids still go out by their id on that server
			theme.setPreset('forest');
			await vi.waitFor(() => expect(update).toHaveBeenLastCalledWith({ accent: 'forest', colorScheme: 'system', glow: 'medium' }));
		});

		it('uploads a pre-account glow choice once', async () => {
			localStorage.setItem('tt.glow', 'off');
			localStorage.setItem('tt.accent', '#2563eb');
			const theme = await freshTheme();
			theme.reconcile('a1', { ...defaults, glow: 'subtle' });
			await vi.waitFor(() => expect(theme.sync).toBe('saved'));
			expect(update).toHaveBeenCalledWith({ accent: 'blue', colorScheme: 'system', glow: 'off' });
		});
	});
});
