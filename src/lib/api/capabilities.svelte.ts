import { api } from './client.js';
import { supportsPlanBlocks } from './api-version.js';

/**
 * Server features derived from the API version, loaded once per page load. While unknown or when /system/info is
 * unavailable every feature stays off, so the client falls back to the behaviour of the older contract.
 */
class Capabilities {
	planBlocks = $state(false);
	apiVersion = $state<string | null>(null);
	#loading: Promise<void> | null = null;

	ensure(): Promise<void> {
		this.#loading ??= api
			.getSystemInfo()
			.then((info) => {
				this.apiVersion = info.backend.apiVersion;
				this.planBlocks = supportsPlanBlocks(info.backend.apiVersion);
			})
			.catch(() => {
				// unavailable: stay on the old behaviour and ask again next time
				this.#loading = null;
			});
		return this.#loading;
	}
}

export const capabilities = new Capabilities();
