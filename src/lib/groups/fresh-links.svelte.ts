/**
 * Share links that were just created or renewed. The server returns the token only in that one response, so the owner
 * pages keep it here (memory only, never persisted) until the owner dismisses it or reloads the page.
 */
class FreshLinks {
	#links = $state<Record<string, string>>({});

	get(id: string): string | undefined {
		return this.#links[id];
	}

	set(id: string, path: string): void {
		this.#links[id] = path;
	}

	clear(id: string): void {
		delete this.#links[id];
	}
}

export const freshLinks = new FreshLinks();
