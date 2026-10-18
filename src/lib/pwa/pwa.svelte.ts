import { isIosDevice } from './core';
import {
	APPLIED_KEY,
	HARD_RESET_GUARD_MS,
	HARD_RESET_KEY,
	isSuppressed,
	parseServerRevision,
	readStamp,
	shouldShowUpdateBanner,
	writeStamp
} from './update-policy';

/** how long applyUpdate waits for the controller change before it falls back to the hard reset */
export const CONTROLLER_TIMEOUT_MS = 3000;

function storage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/** Server-reported PWA revision, or null when /system/info is unavailable (old backend, offline, not signed in). */
async function fetchServerRevision(): Promise<string | null> {
	try {
		const response = await fetch('/api/v1/system/info', { credentials: 'include', headers: { Accept: 'application/json' } });
		return response.ok ? parseServerRevision(await response.json()) : null;
	} catch {
		return null;
	}
}

/** Drops all service workers and caches, then reloads so the page comes from the server (also used by VersionInfo). */
export async function hardReset(): Promise<void> {
	try {
		const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
		await Promise.all(registrations.map((registration) => registration.unregister()));
		if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
	} catch {
		// a failing cleanup must not block the reload
	}
	window.location.reload();
}

/** Minimal shape of the (non-standard) `beforeinstallprompt` event. */
export interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Whether the service worker should be registered: production builds on https/localhost, or the dev E2E flag. */
export function shouldRegisterServiceWorker(env: { prod: boolean; flag?: string }, location: { protocol: string; hostname: string }): boolean {
	if (!env.prod && env.flag !== '1') return false;
	return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

class PwaState {
	/** a new service worker version is installed and waits for the user's confirmation */
	updateReady = $state(false);
	/** navigator.onLine, kept current by online/offline events */
	browserOnline = $state(true);
	/** the last API request failed with a network error (cleared by the next successful response) */
	requestFailed = $state(false);
	installEvent = $state<InstallPromptEvent | null>(null);
	installed = $state(false);

	/** Offline banner condition: browser says offline, or requests are failing at the network level. */
	get offline(): boolean {
		return !this.browserOnline || this.requestFailed;
	}

	private registration: ServiceWorkerRegistration | null = null;
	private reloading = false;
	private reloadStarted = false;
	private waitingWorker = false;
	private fallbackTimer: ReturnType<typeof setTimeout> | null = null;

	/** Re-decides the banner from the waiting worker, the server revision and the suppression window. */
	async evaluateUpdate(): Promise<void> {
		if (!this.waitingWorker) {
			this.updateReady = false;
			return;
		}
		const serverRevision = await fetchServerRevision();
		this.updateReady = shouldShowUpdateBanner({
			waitingWorker: this.waitingWorker,
			ownRevision: __APP_REVISION__,
			serverRevision,
			suppressed: isSuppressed(readStamp(storage(), APPLIED_KEY), Date.now())
		});
	}

	private markWaiting(): void {
		this.waitingWorker = true;
		void this.evaluateUpdate();
	}

	/** Called by the API client after each request: `false` for network errors, `true` for any HTTP response. */
	reportNetwork(ok: boolean): void {
		if (this.requestFailed === !ok) return;
		this.requestFailed = !ok;
	}

	/** Wires online/offline, install prompt and navigation messages; safe to call once from the root layout. */
	init(): () => void {
		this.browserOnline = navigator.onLine;
		this.installed = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
		const onOnline = () => {
			this.browserOnline = true;
			this.requestFailed = false;
		};
		const onOffline = () => (this.browserOnline = false);
		const onInstallPrompt = (event: Event) => {
			event.preventDefault();
			this.installEvent = event as InstallPromptEvent;
		};
		const onInstalled = () => {
			this.installed = true;
			this.installEvent = null;
		};
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		window.addEventListener('beforeinstallprompt', onInstallPrompt);
		window.addEventListener('appinstalled', onInstalled);
		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			window.removeEventListener('beforeinstallprompt', onInstallPrompt);
			window.removeEventListener('appinstalled', onInstalled);
		};
	}

	/** Registers the service worker and tracks update state. `onNavigate` handles `NAVIGATE` messages from notification clicks. */
	async register(onNavigate: (url: string) => void): Promise<void> {
		if (!('serviceWorker' in navigator)) return;
		navigator.serviceWorker.addEventListener('message', (event) => {
			const data = event.data as { type?: string; url?: unknown } | null;
			if (data?.type === 'NAVIGATE' && typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')) onNavigate(data.url);
		});
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// at most one automatic reload per update attempt
			if (this.reloading && !this.reloadStarted) {
				this.reloadStarted = true;
				this.clearFallback();
				window.location.reload();
			}
		});
		try {
			const registration = await navigator.serviceWorker.register('/service-worker.js', {
				type: import.meta.env.DEV ? 'module' : 'classic'
			});
			this.registration = registration;
			const track = (worker: ServiceWorker | null) => {
				if (!worker) return;
				const check = () => {
					if (worker.state === 'installed' && navigator.serviceWorker.controller) this.markWaiting();
				};
				worker.addEventListener('statechange', check);
				check();
			};
			if (registration.waiting && navigator.serviceWorker.controller) this.markWaiting();
			track(registration.installing);
			registration.addEventListener('updatefound', () => track(registration.installing));
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState !== 'visible') return;
				void registration.update().catch(() => {});
				if (this.waitingWorker) void this.evaluateUpdate();
			});
		} catch {
			// registration failure only means no offline shell / push; the app works without it
		}
	}

	private clearFallback(): void {
		if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
		this.fallbackTimer = null;
	}

	/**
	 * User confirmed the update banner: activate the waiting worker; the page reloads on controllerchange. The attempt
	 * is recorded so the banner stays quiet afterwards. If the controller does not change within a few seconds (or
	 * there is nothing to activate), the service worker and caches are dropped and the page reloads once.
	 */
	applyUpdate(): void {
		writeStamp(storage(), APPLIED_KEY, Date.now());
		this.updateReady = false;
		const waiting = this.registration?.waiting;
		if (!waiting) {
			// nothing left to activate (already active elsewhere): a plain reload picks the new version up
			this.reloadStarted = true;
			window.location.reload();
			return;
		}
		this.reloading = true;
		this.clearFallback();
		this.fallbackTimer = setTimeout(() => void this.safeHardReset(), CONTROLLER_TIMEOUT_MS);
		try {
			waiting.postMessage({ type: 'SKIP_WAITING' });
		} catch {
			this.clearFallback();
			void this.safeHardReset();
		}
	}

	/** Hard reset, but never twice within a minute: a second failure falls back to a plain reload. */
	private async safeHardReset(): Promise<void> {
		if (this.reloadStarted) return;
		this.reloadStarted = true;
		const now = Date.now();
		const last = readStamp(storage(), HARD_RESET_KEY);
		writeStamp(storage(), HARD_RESET_KEY, now);
		if (last !== null && now - last >= 0 && now - last < HARD_RESET_GUARD_MS) {
			window.location.reload();
			return;
		}
		await hardReset();
	}

	async promptInstall(): Promise<void> {
		const event = this.installEvent;
		if (!event) return;
		this.installEvent = null;
		await event.prompt();
		await event.userChoice;
	}

	get isIos(): boolean {
		return typeof navigator !== 'undefined' && isIosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0);
	}
}

export const pwa = new PwaState();
