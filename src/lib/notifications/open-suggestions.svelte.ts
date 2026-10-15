import { api } from '../api/client';

/** Count of open suggestions for the sidebar badge; refreshed on navigation while the automation module is on. */
class OpenSuggestions {
	count = $state(0);

	async refresh(): Promise<void> {
		try {
			this.count = (await api.listSuggestions()).length;
		} catch {
			this.count = 0;
		}
	}

	reset(): void {
		this.count = 0;
	}
}

export const openSuggestions = new OpenSuggestions();
