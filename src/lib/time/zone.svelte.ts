import { api } from '#lib/api/client.js';
import { DEFAULT_TIMEZONE } from './dates.js';

/** Time zone of the account's current work model (IANA); falls back to Europe/Berlin. */
class ZoneStore {
	value = $state(DEFAULT_TIMEZONE);
	private pending: Promise<string> | null = null;

	/**
	 * Loads the zone once per signed-in account (the session store resets it on every sign-in and sign-out); a failed
	 * query keeps the current value and is asked again next time.
	 */
	ensure(): Promise<string> {
		this.pending ??= api
			.listWorkModels()
			.then((models) => {
				const current = [...models].reverse().find((m) => !m.validTo) ?? models.at(-1);
				if (current?.timezone) this.value = current.timezone;
				return this.value;
			})
			.catch(() => {
				this.pending = null;
				return this.value;
			});
		return this.pending;
	}

	/** After a work model change: keeps the shown zone until the new one has loaded. */
	invalidate(): void {
		this.pending = null;
		void this.ensure();
	}

	reset(zone = DEFAULT_TIMEZONE): void {
		this.pending = null;
		this.value = zone;
	}
}

export const zoneStore = new ZoneStore();
