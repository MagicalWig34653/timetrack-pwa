import { sessionStore } from '../session.svelte';
import { FormTemplateStore, createIndexedDbBackend, createMemoryBackend, type LocalBackend } from './form-template-store';

let backend: LocalBackend | null = null;

function localBackend(): LocalBackend {
	// IndexedDB can be missing (private windows, old browsers); the template then lives for this session only.
	backend ??= typeof indexedDB === 'undefined' ? createMemoryBackend() : createIndexedDbBackend();
	return backend;
}

/** Store for the signed-in account (data is keyed per account in the browser fallback). */
export function currentFormStore(): FormTemplateStore {
	return new FormTemplateStore(sessionStore.current?.account.id ?? 'anonymous', localBackend());
}
