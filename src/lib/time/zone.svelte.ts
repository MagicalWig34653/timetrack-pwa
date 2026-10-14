import { api } from '#lib/api/client.js';
import { DEFAULT_TIMEZONE } from './dates.js';

/** Time zone of the account's current work model (IANA); falls back to Europe/Berlin. */
class ZoneStore {
	value = $state(DEFAULT_TIMEZONE);
	private pending: Promise<string> | null = null;

	/** Loads the zone once per page lifetime; errors keep the default. */
	ensure(): Promise<string> {
		this.pending ??= api
			.listWorkModels()
			.then((models) => {
				const current = [...models].reverse().find((m) => !m.validTo) ?? models.at(-1);
				if (current?.timezone) this.value = current.timezone;
				return this.value;
			})
			.catch(() => this.value);
		return this.pending;
	}

	reset(zone = DEFAULT_TIMEZONE): void {
		this.pending = null;
		this.value = zone;
	}
}

export const zoneStore = new ZoneStore();
