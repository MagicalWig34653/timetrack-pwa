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

export type StorageMode = 'server' | 'local';

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

/** The endpoints answer 404 (route unknown) or 501 until backend package B7 exists; a disabled module is a real error. */
export function isUnsupported(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 501 || (error.status === 404 && error.code !== 'module_disabled'));
}

/**
 * Template + mapping storage. Prefers the server endpoints (`/vacation/request-form`); when they answer 404/501 the
 * store switches to IndexedDB for this session, keyed per account so users of one browser never see each other's data.
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

	/** Where data lives; known after the first operation. */
	get storage(): StorageMode | null {
		return this.mode;
	}

	/** Runs a server operation; on 404/501 switches to local storage and runs the fallback instead. */
	private async withServer<T>(server: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
		if (this.mode === 'local') return fallback();
		try {
			const result = await server();
			this.mode = 'server';
			return result;
		} catch (error) {
			if (!isUnsupported(error)) throw error;
			this.mode = 'local';
			return fallback();
		}
	}

	async load(): Promise<StoredTemplate | null> {
		return this.withServer(
			async () => {
				const info = await api.getVacationRequestForm();
				if (!info.exists) return null;
				const file = await api.downloadVacationRequestFormFile();
				return {
					fileName: info.fileName ?? file.filename ?? 'vorlage.pdf',
					bytes: new Uint8Array(await file.blob.arrayBuffer()),
					mapping: parseMapping(info.mapping),
					updatedAt: info.updatedAt ?? null
				};
			},
			async () => {
				const record = await this.local.read(this.key);
				return record ? { fileName: record.fileName, bytes: new Uint8Array(record.bytes), mapping: parseMapping(record.mapping), updatedAt: record.updatedAt } : null;
			}
		);
	}

	/** Stores a new template file and resets the mapping (field names belong to the file). */
	async saveFile(bytes: Uint8Array, fileName: string, mapping: FormMapping = emptyMapping()): Promise<void> {
		validatePdfBytes(bytes);
		if (bytes.length > PDF_MAX_BYTES) throw new Error('too large');
		const json = serializeMapping(mapping); // size check before anything is sent
		await this.withServer(
			async () => {
				await api.putVacationRequestFormFile(bytes, fileName);
				await api.putVacationRequestFormMapping(JSON.parse(json));
			},
			async () => this.local.write(this.key, { fileName, bytes: bytes.slice().buffer, mapping: JSON.parse(json), updatedAt: new Date().toISOString() })
		);
	}

	async saveMapping(mapping: FormMapping): Promise<void> {
		const json = serializeMapping(mapping);
		await this.withServer(
			async () => void (await api.putVacationRequestFormMapping(JSON.parse(json))),
			async () => {
				const record = await this.local.read(this.key);
				if (!record) throw new Error('no template');
				await this.local.write(this.key, { ...record, mapping: JSON.parse(json), updatedAt: new Date().toISOString() });
			}
		);
	}

	async remove(): Promise<void> {
		await this.withServer(
			() => api.deleteVacationRequestForm(),
			() => this.local.remove(this.key)
		);
	}

	/** Cheap existence check for the "Urlaubsantrag erstellen" action. */
	async exists(): Promise<boolean> {
		return this.withServer(
			async () => (await api.getVacationRequestForm()).exists,
			async () => (await this.local.read(this.key)) !== null
		);
	}
}
