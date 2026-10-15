import { api, setModuleDisabledHandler } from '#lib/api/client.js';
import { ApiError } from '#lib/api/errors.js';
import type { ModuleKey, ModuleStatus } from '#lib/api/types.js';

/**
 * Module switches of the signed-in account (GET /modules, ADR-0012). Until the status is known - and on servers that
 * predate the API (404/501) - every module counts as enabled so nothing is hidden by mistake.
 */
class ModuleStore {
	/** null = unknown / not supported by the server */
	statuses = $state<ModuleStatus[] | null>(null);
	loaded = $state(false);
	#accountId: string | null = null;
	#inflight: Promise<void> | null = null;

	statusOf(key: ModuleKey): ModuleStatus | undefined {
		return this.statuses?.find((s) => s.key === key);
	}

	enabled(key: ModuleKey): boolean {
		return this.statusOf(key)?.effective ?? true;
	}

	/** Loads once per signed-in account; later navigations reuse the cache. */
	async ensure(accountId: string): Promise<void> {
		if (this.#accountId === accountId && this.loaded) return;
		if (this.#accountId !== accountId) this.statuses = null;
		this.#accountId = accountId;
		await this.refresh();
	}

	/** Re-reads the status. Never throws: a failing read keeps the last known state. */
	refresh(): Promise<void> {
		if (this.#inflight) return this.#inflight;
		this.#inflight = (async () => {
			try {
				this.statuses = await api.listModules();
			} catch (error) {
				// older backend without the module API: everything is available
				if (error instanceof ApiError && (error.status === 404 || error.status === 501)) this.statuses = null;
			} finally {
				this.loaded = true;
				this.#inflight = null;
			}
		})();
		return this.#inflight;
	}

	set(statuses: ModuleStatus[]): void {
		this.statuses = statuses;
		this.loaded = true;
	}

	reset(): void {
		this.statuses = null;
		this.loaded = false;
		this.#accountId = null;
		this.#inflight = null;
	}
}

export const moduleStore = new ModuleStore();

// A 404 module_disabled from any call means the cached state is stale: re-read it so navigation and pages follow.
setModuleDisabledHandler(() => void moduleStore.refresh());
