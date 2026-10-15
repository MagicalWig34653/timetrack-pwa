import { api } from '../api/client';

const POLL_MS = 60_000;

/** Unread counter for the bell: polls every 60 s while the tab is visible and on focus. */
class UnreadStore {
	count = $state(0);
	private timer: ReturnType<typeof setInterval> | null = null;

	async refresh(): Promise<void> {
		try {
			const result = await api.listNotifications({ unreadOnly: true, limit: 1 });
			this.count = result.unreadCount;
		} catch {
			// keep the last known value; the bell is informational
		}
	}

	set(count: number): void {
		this.count = count;
	}

	/** Starts polling; returns the stop function. */
	start(): () => void {
		void this.refresh();
		const tick = () => {
			if (document.visibilityState === 'visible') void this.refresh();
		};
		this.timer = setInterval(tick, POLL_MS);
		const onFocus = () => void this.refresh();
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', tick);
		return () => {
			if (this.timer) clearInterval(this.timer);
			this.timer = null;
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', tick);
		};
	}
}

export const unread = new UnreadStore();
