import { api } from '../api/client';
import { ApiError } from '../api/errors';
import { emptyMapping, parseMapping, serializeMapping } from './mapping';
import { PDF_MAX_BYTES, validatePdfBytes } from './pdf-limits';
import type { FormMapping } from './types';

export interface StoredTemplate {
	fileName: string;
	bytes: Uint8Array;
	mapping: FormMapping;
	updatedAt: string | null;
}

/** Local (browser) persistence behind the same operations; IndexedDB in the app, memory in tests. */
export interface LocalBackend {
	read(key: string): Promise<LocalRecord | null>;
	write(key: string, record: LocalRecord): Promise<void>;
	remove(key: string): Promise<void>;
}

export interface LocalRecord {
	fileName: string;
	bytes: ArrayBuffer;
	mapping: unknown;
	updatedAt: string;
}

export function createMemoryBackend(): LocalBackend {
	const records = new Map<string, LocalRecord>();
	return {
		read: async (key) => records.get(key) ?? null,
		write: async (key, record) => void records.set(key, record),
		remove: async (key) => void records.delete(key)
	};
}

const DB_NAME = 'timetrack-vacation-form';
const STORE = 'template';

export function createIndexedDbBackend(): LocalBackend {
	let opened: Promise<IDBDatabase> | null = null;
	const open = () =>
		(opened ??= new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(STORE);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		}));
	const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
		const db = await open();
		return new Promise<T>((resolve, reject) => {
			const request = work(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	};
	return {
		read: async (key) => ((await run('readonly', (s) => s.get(key))) as LocalRecord | undefined) ?? null,
		write: async (key, record) => void (await run('readwrite', (s) => s.put(record, key))),
		remove: async (key) => void (await run('readwrite', (s) => s.delete(key)))
	};
}

/** The server is the source of truth; `offline` means the data came from the browser cache because the server was unreachable. */
export type StorageMode = 'server' | 'offline';

/** Only a transport failure (no response at all) counts as offline; every HTTP answer, including 404, is a real result. */
export function isOffline(error: unknown): boolean {
	return error instanceof ApiError && error.status === 0;
}

/**
 * Template + mapping storage on the server (`/vacation/request-form`, contract 0.25.0). The browser keeps a per-account
 * copy in IndexedDB only as a cache: it is refreshed on every successful server operation and read when the server is
 * unreachable, so filling out a request works offline. Writes are never accepted offline (they would silently diverge).
 */
export class FormTemplateStore {
	private mode: StorageMode | null = null;

	constructor(
		private readonly accountId: string,
		private readonly local: LocalBackend
	) {}

	private get key() {
		return `template:${this.accountId}`;
	}

	/** Where the last read came from; known after the first operation. */
	get storage(): StorageMode | null {
		return this.mode;
	}

	/** Cache access never breaks the server path (private windows, quota, blocked IndexedDB). */
	private async cache(work: () => Promise<void>): Promise<void> {
		try {
			await work();
		} catch {
			// the cache is optional
		}
	}

	async load(): Promise<StoredTemplate | null> {
		try {
			const info = await api.getVacationRequestForm();
			if (!info.exists) {
				this.mode = 'server';
				await this.cache(() => this.local.remove(this.key));
				return null;
			}
			const file = await api.downloadVacationRequestFormFile();
			const stored: StoredTemplate = {
				fileName: info.fileName ?? file.filename ?? 'vorlage.pdf',
				bytes: new Uint8Array(await file.blob.arrayBuffer()),
				mapping: parseMapping(info.mapping),
				updatedAt: info.updatedAt ?? null
			};
			this.mode = 'server';
			await this.cache(() =>
				this.local.write(this.key, { fileName: stored.fileName, bytes: stored.bytes.slice().buffer, mapping: info.mapping ?? null, updatedAt: stored.updatedAt ?? new Date().toISOString() })
			);
			return stored;
		} catch (error) {
			if (!isOffline(error)) throw error;
			const record = await this.readCache();
			if (!record) throw error; // offline without a cached copy: show the network error
			this.mode = 'offline';
			return { fileName: record.fileName, bytes: new Uint8Array(record.bytes), mapping: parseMapping(record.mapping), updatedAt: record.updatedAt };
		}
	}

	private async readCache(): Promise<LocalRecord | null> {
		try {
			return await this.local.read(this.key);
		} catch {
			return null;
		}
	}

	/** Stores a new template file and resets the mapping (field names belong to the file). */
	async saveFile(bytes: Uint8Array, fileName: string, mapping: FormMapping = emptyMapping()): Promise<void> {
		validatePdfBytes(bytes);
		if (bytes.length > PDF_MAX_BYTES) throw new Error('too large');
		const json = serializeMapping(mapping); // size check before anything is sent
		await api.putVacationRequestFormFile(bytes, fileName);
		let info: Awaited<ReturnType<typeof api.putVacationRequestFormMapping>>;
		try {
			info = await api.putVacationRequestFormMapping(JSON.parse(json));
		} catch (error) {
			// the server now holds the new file with the old mapping; the cached copy would be stale
			await this.cache(() => this.local.remove(this.key));
			throw error;
		}
		this.mode = 'server';
		await this.cache(() => this.local.write(this.key, { fileName, bytes: bytes.slice().buffer, mapping: JSON.parse(json), updatedAt: info.updatedAt ?? new Date().toISOString() }));
	}

	async saveMapping(mapping: FormMapping): Promise<void> {
		const json = serializeMapping(mapping);
		const info = await api.putVacationRequestFormMapping(JSON.parse(json)); // 409 no_template without a stored file
		this.mode = 'server';
		await this.cache(async () => {
			const record = await this.local.read(this.key);
			if (record) await this.local.write(this.key, { ...record, mapping: JSON.parse(json), updatedAt: info.updatedAt ?? new Date().toISOString() });
		});
	}

	async remove(): Promise<void> {
		await api.deleteVacationRequestForm();
		this.mode = 'server';
		await this.cache(() => this.local.remove(this.key));
	}

	/** Cheap existence check for the "Urlaubsantrag erstellen" action; falls back to the cache when offline. */
	async exists(): Promise<boolean> {
		try {
			const exists = (await api.getVacationRequestForm()).exists;
			this.mode = 'server';
			return exists;
		} catch (error) {
			if (!isOffline(error)) throw error;
			this.mode = 'offline';
			return (await this.readCache()) !== null;
		}
	}
}
