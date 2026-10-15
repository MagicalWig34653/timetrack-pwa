import { isIosDevice } from './core';

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
			if (this.reloading) window.location.reload();
		});
		try {
			const registration = await navigator.serviceWorker.register('/service-worker.js', {
				type: import.meta.env.DEV ? 'module' : 'classic'
			});
			this.registration = registration;
			const track = (worker: ServiceWorker | null) => {
				if (!worker) return;
				const check = () => {
					if (worker.state === 'installed' && navigator.serviceWorker.controller) this.updateReady = true;
				};
				worker.addEventListener('statechange', check);
				check();
			};
			if (registration.waiting && navigator.serviceWorker.controller) this.updateReady = true;
			track(registration.installing);
			registration.addEventListener('updatefound', () => track(registration.installing));
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') void registration.update().catch(() => {});
			});
		} catch {
			// registration failure only means no offline shell / push; the app works without it
		}
	}

	/** User confirmed the update banner: activate the waiting worker; the page reloads on controllerchange. */
	applyUpdate(): void {
		const waiting = this.registration?.waiting;
		if (!waiting) {
			window.location.reload();
			return;
		}
		this.reloading = true;
		waiting.postMessage({ type: 'SKIP_WAITING' });
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
