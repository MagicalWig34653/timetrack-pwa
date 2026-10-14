// In-memory mock of contract v0.4.0 (ADR-0006): export, import, import templates, file storage and absence attachments.
// The backend implements these in C11-C13. Import parsing is the TS port in src/lib/transfer/import-parse.ts.
import { createHash } from 'node:crypto';
import type { DayEvaluation, FileMeta, ImportJob, ImportMapping, ImportPreview, ImportResult, ImportTemplate, StorageBackend, StorageSettings, StorageSettingsInput } from '../src/lib/api/types.ts';
import { addDays } from '../src/lib/time/dates.ts';
import { buildImportPreview, detectDelimiter, mappingIssues, parseCsv, type ParsedItem } from '../src/lib/transfer/import-parse.ts';
import { buildCsv, buildPdfPlaceholder, buildXlsxPlaceholder, exportRows } from './export-files.ts';

export interface UploadedFile {
	name: string;
	type: string;
	bytes: Uint8Array;
}

export interface TransferRequest {
	method: string;
	/** path including `/api/v1` and the query string */
	path: string;
	body?: any;
	file?: UploadedFile;
	role: 'admin' | 'member';
}

export interface TransferResponse {
	status: number;
	body?: unknown;
	binary?: { bytes: Uint8Array; contentType: string; headers: Record<string, string> };
}

export interface TransferDeps {
	clock: () => number;
	displayNameOf: (accountId: string) => string;
	/** internal call into the time mock (segments, days, places) */
	call: (accountId: string, method: string, path: string, body?: unknown) => { status: number; body?: any } | null;
	absenceExists: (accountId: string, absenceId: string) => boolean;
	/** false mimics a server without STORAGE_SECRET_KEY (S3 configuration is refused with 501) */
	storageSecretKey: boolean;
}

const uuid = () => crypto.randomUUID();
const fail = (status: number, code: string, message = code): TransferResponse => ({ status, body: { error: { code, message } } });
const ok = (body: unknown, status = 200): TransferResponse => ({ status, body });

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_EXPORT_DAYS = 366;
const MAX_NAME = 80;

interface ImportState {
	job: ImportJob;
	text: string;
	rows: string[][];
	mapping: ImportMapping | null;
	segmentIds: string[];
	batchId: string | null;
}

interface StoredFile {
	meta: FileMeta;
	ownerId: string;
	bytes: Uint8Array;
}

interface Stored {
	imports: Map<string, ImportState>;
	templates: ImportTemplate[];
	/** fileId -> absence ids */
	links: Map<string, Set<string>>;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;

function decodeText(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		// German Excel writes CSV as Windows-1252 by default
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

/** Content sniffing for the attachment whitelist (pdf, png, jpg, heic, txt). Returns the content type or null. */
export function sniffAttachment(name: string, bytes: Uint8Array): string | null {
	const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
	const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
	if (ext === 'pdf') return starts(0x25, 0x50, 0x44, 0x46) ? 'application/pdf' : null;
	if (ext === 'png') return starts(0x89, 0x50, 0x4e, 0x47) ? 'image/png' : null;
	if (ext === 'jpg' || ext === 'jpeg') return starts(0xff, 0xd8, 0xff) ? 'image/jpeg' : null;
	if (ext === 'heic') return bytes.length > 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp' ? 'image/heic' : null;
	if (ext === 'txt') return bytes.includes(0) ? null : 'text/plain';
	return null;
}

export function sanitizeFilename(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? '';
	// eslint-disable-next-line no-control-regex
	const cleaned = base.replace(/[\u0000-\u001f"<>|:*?]/g, '_').replace(/^\.+/, '').trim();
	return cleaned.slice(0, 120) || 'datei';
}

export function createTransferMock(deps: TransferDeps) {
	const stored = new Map<string, Stored>();
	const files = new Map<string, StoredFile>();
	let storage: StorageSettings & { secret?: string } = { rules: [{ maxBytes: null, backend: 'db' }], maxUploadBytes: 10 * 1024 * 1024, localPath: null, s3: null, hasSecret: false };

	const stateOf = (accountId: string): Stored => {
		let s = stored.get(accountId);
		if (!s) stored.set(accountId, (s = { imports: new Map(), templates: [], links: new Map() }));
		return s;
	};

	function backendFor(size: number): StorageBackend {
		return (storage.rules.find((r) => r.maxBytes == null || size <= r.maxBytes) ?? { backend: 'db' as const }).backend;
	}

	// ------------------------------------------------------------------------------------------ export
	function exportTime(accountId: string, query: URLSearchParams): TransferResponse {
		const from = query.get('from');
		const to = query.get('to');
		const format = query.get('format');
		if (!isDate(from) || !isDate(to) || to < from || !['xlsx', 'pdf', 'csv'].includes(format ?? '')) return fail(400, 'bad_request');
		const days: DayEvaluation[] = [];
		let count = 0;
		for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) count++;
		if (count > MAX_EXPORT_DAYS) return fail(400, 'range_too_large');
		for (let start = from; start <= to; start = addDays(start, 93)) {
			const end = addDays(start, 92) < to ? addDays(start, 92) : to;
			const response = deps.call(accountId, 'GET', `/api/v1/time/days?from=${start}&to=${end}`);
			if (!response || response.status !== 200) return fail(501, 'not_implemented');
			days.push(...(response.body as DayEvaluation[]));
		}
		const csv = buildCsv(deps.displayNameOf(accountId), from, to, exportRows(days), new Date(deps.clock()));
		const filename = `Arbeitszeit_${from}_${to}.${format}`;
		const contentType =
			format === 'csv' ? 'text/csv; charset=utf-8' : format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		const bytes = format === 'csv' ? new TextEncoder().encode(csv) : format === 'pdf' ? buildPdfPlaceholder(csv) : buildXlsxPlaceholder(csv);
		return {
			status: 200,
			binary: { bytes, contentType, headers: { 'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`, 'X-Content-Type-Options': 'nosniff' } }
		};
	}

	// ------------------------------------------------------------------------------------------ import
	function context(accountId: string) {
		const places = (deps.call(accountId, 'GET', '/api/v1/places')?.body ?? []) as { id: string; name: string; archived?: boolean }[];
		const segments = (deps.call(accountId, 'GET', '/api/v1/time/segments?from=1970-01-01T00:00:00Z&to=2100-01-01T00:00:00Z')?.body ?? []) as { startedAt: string; endedAt: string | null; kind: any }[];
		return { places: places.filter((p) => !p.archived), existing: segments };
	}

	function preview(accountId: string, state: ImportState, mapping: ImportMapping): { preview: ImportPreview; items: ParsedItem[] } {
		return buildImportPreview(state.rows, mapping, context(accountId));
	}

	function validMapping(state: ImportState, m: any): m is ImportMapping {
		if (!m || typeof m !== 'object' || !m.columns || typeof m.columns !== 'object') return false;
		if (!state.job.sheets.includes(m.sheet)) return false;
		if (!Number.isInteger(m.headerRow) || m.headerRow < 0 || m.headerRow > state.rows.length) return false;
		if (!['dd.MM.yyyy', 'yyyy-MM-dd', 'excel_serial'].includes(m.dateFormat)) return false;
		if (!['HH:mm', 'excel_fraction', 'decimal_hours'].includes(m.timeFormat)) return false;
		if (m.defaultKind && !['work', 'travel', 'school'].includes(m.defaultKind)) return false;
		return mappingIssues(m).length === 0;
	}

	function importRoutes(accountId: string, method: string, route: string, req: TransferRequest, query: URLSearchParams): TransferResponse | null {
		const s = stateOf(accountId);
		let m: RegExpMatchArray | null;
		if (route === 'imports' && method === 'POST') {
			if (!req.file) return fail(400, 'bad_request');
			if (req.file.bytes.length > MAX_IMPORT_BYTES) return fail(413, 'file_too_large');
			const kind = /\.csv$/i.test(req.file.name) ? 'csv' : /\.xlsx$/i.test(req.file.name) ? 'xlsx' : null;
			if (!kind) return fail(415, 'unsupported_type');
			// the mock only reads CSV; a workbook would need a ZIP/XML reader
			if (kind === 'xlsx') return fail(400, 'import_unreadable');
			const text = decodeText(req.file.bytes);
			const rows = parseCsv(text, detectDelimiter(text));
			if (rows.length === 0) return fail(400, 'import_unreadable');
			const job: ImportJob = {
				id: uuid(),
				filename: sanitizeFilename(req.file.name),
				kind,
				status: 'uploaded',
				sheets: ['Tabelle1'],
				sha256: createHash('sha256').update(req.file.bytes).digest('hex'),
				createdAt: new Date(deps.clock()).toISOString()
			};
			s.imports.set(job.id, { job, text, rows, mapping: null, segmentIds: [], batchId: null });
			return ok(job, 201);
		}
		if (route === 'import-templates') {
			if (method === 'GET') return ok(s.templates);
			if (method === 'POST') {
				const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
				if (!name || name.length > MAX_NAME || !req.body?.mapping?.columns) return fail(400, 'bad_request');
				const template: ImportTemplate = { id: uuid(), name, mapping: req.body.mapping };
				s.templates.push(template);
				return ok(template, 201);
			}
		}
		if ((m = route.match(/^import-templates\/([^/]+)$/)) && method === 'DELETE') {
			const index = s.templates.findIndex((t) => t.id === m![1]);
			if (index < 0) return fail(404, 'not_found');
			s.templates.splice(index, 1);
			return { status: 204 };
		}
		if (!(m = route.match(/^imports\/([^/]+)(?:\/(preview|mapping|commit|rollback))?$/))) return null;
		const state = s.imports.get(m[1]);
		if (!state) return fail(404, 'not_found');
		const action = m[2];
		if (!action) {
			if (method === 'GET') return ok(state.job);
			if (method === 'DELETE') {
				if (state.job.status === 'committed') return fail(409, 'import_already_committed');
				s.imports.delete(state.job.id);
				return { status: 204 };
			}
			return null;
		}
		if (action === 'preview' && method === 'GET') {
			const sheet = query.get('sheet');
			if (sheet && !state.job.sheets.includes(sheet)) return fail(404, 'not_found');
			return ok({ sheet: sheet ?? state.job.sheets[0], rows: state.rows.slice(0, 50) });
		}
		if (action === 'mapping' && method === 'PUT') {
			if (state.job.status === 'committed') return fail(409, 'import_already_committed');
			if (!validMapping(state, req.body)) return fail(400, 'bad_request');
			state.mapping = req.body;
			state.job.status = 'mapped';
			return ok(preview(accountId, state, req.body).preview);
		}
		if (action === 'commit' && method === 'POST') {
			if (state.job.status === 'committed') return fail(409, 'import_already_committed');
			if (state.job.status !== 'mapped' || !state.mapping) return fail(409, 'import_not_mapped');
			// validated again against the current data: a second import of the same file finds every row as duplicate
			const { preview: p, items } = preview(accountId, state, state.mapping);
			const ignoreErrors = req.body?.ignoreErrors === true;
			if (p.errors.length > 0 && !ignoreErrors) return fail(409, 'import_has_errors');
			let created = 0;
			let skipped = p.duplicates + p.errors.length;
			const ids: string[] = [];
			for (const item of items) {
				const response = deps.call(accountId, 'POST', '/api/v1/time/segments', { kind: item.kind, placeId: item.placeId, startedAt: item.startedAt, endedAt: item.endedAt, note: item.note });
				if (response?.status === 201) {
					created++;
					ids.push(response.body.id);
				} else skipped++;
			}
			state.segmentIds = ids;
			state.batchId = uuid();
			state.job.status = 'committed';
			const result: ImportResult = { batchId: state.batchId, created, skipped };
			return ok(result);
		}
		if (action === 'rollback' && method === 'POST') {
			if (state.job.status !== 'committed' || !state.batchId) return fail(409, 'import_not_committed');
			const all = (deps.call(accountId, 'GET', '/api/v1/time/segments?from=1970-01-01T00:00:00Z&to=2100-01-01T00:00:00Z&includeVoided=true')?.body ?? []) as { id: string; version: number; voided: boolean }[];
			const mine = all.filter((x) => state.segmentIds.includes(x.id) && !x.voided);
			const conflicts = mine.filter((x) => x.version !== 1).map((x) => x.id);
			if (conflicts.length > 0) {
				return { status: 409, body: { error: { code: 'import_rollback_conflict', message: 'import_rollback_conflict' }, conflicts } };
			}
			for (const segment of mine) deps.call(accountId, 'DELETE', `/api/v1/time/segments/${segment.id}?reason=${encodeURIComponent('Import zurückgenommen')}`);
			state.job.status = 'rolled_back';
			const result: ImportResult = { batchId: state.batchId, created: 0, skipped: 0, conflicts: [] };
			return ok(result);
		}
		return null;
	}

	// ------------------------------------------------------------------------------------------ storage and files
	function publicStorage(): StorageSettings {
		const { secret: _secret, ...rest } = storage;
		return rest;
	}

	function putStorage(input: StorageSettingsInput): TransferResponse {
		const rules = input?.rules;
		if (!Array.isArray(rules) || rules.length === 0) return fail(400, 'bad_request');
		let previous = 0;
		for (const [i, rule] of rules.entries()) {
			if (!['db', 's3', 'local'].includes(rule.backend)) return fail(400, 'bad_request');
			const last = i === rules.length - 1;
			if (last !== (rule.maxBytes == null)) return fail(400, 'bad_request');
			if (!last) {
				if (!Number.isInteger(rule.maxBytes) || (rule.maxBytes as number) <= previous) return fail(400, 'bad_request');
				previous = rule.maxBytes as number;
			}
		}
		const maxUploadBytes = input.maxUploadBytes ?? 10 * 1024 * 1024;
		if (!Number.isInteger(maxUploadBytes) || maxUploadBytes < 1) return fail(400, 'bad_request');
		const usesS3 = rules.some((r) => r.backend === 's3');
		const usesLocal = rules.some((r) => r.backend === 'local');
		if (usesLocal && !input.localPath?.trim()) return fail(400, 'bad_request');
		const s3 = input.s3 ?? null;
		if (usesS3 && !(s3?.endpoint && s3.region && s3.bucket && s3.accessKeyId)) return fail(400, 'bad_request');
		if ((usesS3 || s3?.secretAccessKey) && !deps.storageSecretKey) return fail(501, 'not_implemented');
		const secret = s3?.secretAccessKey ? s3.secretAccessKey : storage.secret;
		storage = {
			rules,
			maxUploadBytes,
			localPath: input.localPath?.trim() || null,
			s3: s3 ? { endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, pathStyle: s3.pathStyle ?? true, accessKeyId: s3.accessKeyId } : null,
			hasSecret: secret !== undefined,
			secret
		};
		return ok(publicStorage());
	}

	function fileRoutes(accountId: string, method: string, route: string, req: TransferRequest): TransferResponse | null {
		const s = stateOf(accountId);
		let m: RegExpMatchArray | null;
		if (route === 'files' && method === 'POST') {
			if (!req.file) return fail(400, 'bad_request');
			if (req.file.bytes.length > storage.maxUploadBytes) return fail(413, 'file_too_large');
			const name = sanitizeFilename(req.file.name);
			const contentType = sniffAttachment(name, req.file.bytes);
			if (!contentType) return fail(415, 'unsupported_type');
			const meta: FileMeta = {
				id: uuid(),
				name,
				size: req.file.bytes.length,
				sha256: createHash('sha256').update(req.file.bytes).digest('hex'),
				contentType,
				backend: backendFor(req.file.bytes.length),
				createdAt: new Date(deps.clock()).toISOString()
			};
			files.set(meta.id, { meta, ownerId: accountId, bytes: req.file.bytes });
			return ok(meta, 201);
		}
		if ((m = route.match(/^files\/([^/]+)$/))) {
			const file = files.get(m[1]);
			if (!file || file.ownerId !== accountId) return fail(404, 'not_found');
			if (method === 'GET') {
				return {
					status: 200,
					binary: {
						bytes: file.bytes,
						contentType: file.meta.contentType,
						headers: { 'Content-Disposition': `attachment; filename="${file.meta.name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.meta.name)}`, 'X-Content-Type-Options': 'nosniff' }
					}
				};
			}
			if (method === 'DELETE') {
				files.delete(file.meta.id);
				s.links.delete(file.meta.id);
				return { status: 204 };
			}
		}
		if ((m = route.match(/^absences\/([^/]+)\/attachments(?:\/([^/]+))?$/))) {
			const absenceId = m[1];
			if (!deps.absenceExists(accountId, absenceId)) return fail(404, 'not_found');
			const linked = () => [...s.links.entries()].filter(([, set]) => set.has(absenceId)).map(([id]) => files.get(id)).filter((f): f is StoredFile => !!f && f.ownerId === accountId);
			if (!m[2] && method === 'GET') return ok(linked().map((f) => f.meta));
			if (!m[2] && method === 'POST') {
				const file = files.get(String(req.body?.fileId));
				if (!file || file.ownerId !== accountId) return fail(404, 'not_found');
				const set = s.links.get(file.meta.id) ?? new Set<string>();
				set.add(absenceId);
				s.links.set(file.meta.id, set);
				return ok(file.meta, 201);
			}
			if (m[2] && method === 'DELETE') {
				const set = s.links.get(m[2]);
				if (!set?.has(absenceId)) return fail(404, 'not_found');
				set.delete(absenceId);
				return { status: 204 };
			}
		}
		return null;
	}

	function handle(accountId: string, req: TransferRequest): TransferResponse | null {
		const [path, queryString = ''] = req.path.split('?');
		const prefix = '/api/v1/';
		if (!path.startsWith(prefix)) return null;
		const route = path.slice(prefix.length).replace(/\/+$/, '');
		const method = req.method.toUpperCase();
		const query = new URLSearchParams(queryString);
		if (route === 'export/time' && method === 'GET') return exportTime(accountId, query);
		if (route === 'admin/storage') {
			if (req.role !== 'admin') return fail(403, 'forbidden');
			if (method === 'GET') return ok(publicStorage());
			if (method === 'PUT') return putStorage(req.body);
		}
		return importRoutes(accountId, method, route, req, query) ?? fileRoutes(accountId, method, route, req);
	}

	return { handle, files, stored };
}
