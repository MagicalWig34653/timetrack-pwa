// Mock of the vacation request form endpoints (backend package B7, contract 0.25.0, ADR-0026):
//   GET    /api/v1/vacation/request-form           -> {exists, fileName, sizeBytes, mapping, updatedAt}
//   PUT    /api/v1/vacation/request-form/file      body application/pdf (<= 5 MB), header X-File-Name (percent-encoded)
//   PUT    /api/v1/vacation/request-form/mapping   JSON body (opaque, <= 64 KB)
//   GET    /api/v1/vacation/request-form/file      download
//   DELETE /api/v1/vacation/request-form
// One template per account. A real server would store the PDF in the file store; here it lives in memory.
import type { MockResponse } from './api.ts';

export const FORM_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FORM_MAX_MAPPING_BYTES = 64 * 1024;

interface StoredForm {
	fileName: string;
	bytes: Uint8Array;
	mapping: unknown;
	updatedAt: string;
}

export interface VacationFormRequest {
	method: string;
	path: string;
	body?: any;
	rawBody?: Uint8Array;
	fileName?: string;
	contentType?: string;
}

const error = (status: number, code: string): MockResponse => ({ status, body: { error: { code, message: code } } });
const hasPdfMagic = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';

export function createVacationFormMock(clock: () => number) {
	const forms = new Map<string, StoredForm>();

	function info(form: StoredForm | undefined) {
		return form
			? { exists: true, fileName: form.fileName, sizeBytes: form.bytes.length, mapping: form.mapping, updatedAt: form.updatedAt }
			: { exists: false, fileName: null, sizeBytes: null, mapping: null, updatedAt: null };
	}

	function handle(accountId: string, req: VacationFormRequest): MockResponse | null {
		const route = req.path.split('?')[0].replace(/^\/api\/v1\//, '');
		if (route !== 'vacation/request-form' && !route.startsWith('vacation/request-form/')) return null;
		const form = forms.get(accountId);
		const now = new Date(clock()).toISOString();

		if (route === 'vacation/request-form') {
			if (req.method === 'GET') return { status: 200, body: info(form) };
			if (req.method === 'DELETE') {
				forms.delete(accountId);
				return { status: 204 };
			}
		}
		if (route === 'vacation/request-form/file') {
			if (req.method === 'GET') {
				if (!form) return error(404, 'not_found');
				return {
					status: 200,
					binary: { bytes: form.bytes, contentType: 'application/pdf', headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(form.fileName)}` } }
				};
			}
			if (req.method === 'PUT') {
				// order as on the server: Content-Type 415, empty body 400, size 413, missing %PDF- magic number 400
				if (req.contentType !== undefined && !req.contentType.toLowerCase().startsWith('application/pdf')) return error(415, 'unsupported_type');
				const bytes = req.rawBody;
				if (!bytes || bytes.length === 0) return error(400, 'bad_request');
				if (bytes.length > FORM_MAX_FILE_BYTES) return error(413, 'file_too_large');
				if (!hasPdfMagic(bytes)) return error(400, 'bad_request');
				let fileName = 'vorlage.pdf';
				try {
					fileName = decodeURIComponent(req.fileName ?? '') || fileName;
				} catch {
					return error(400, 'bad_request');
				}
				const stored: StoredForm = { fileName: fileName.slice(0, 255), bytes: new Uint8Array(bytes), mapping: form?.mapping ?? null, updatedAt: now };
				forms.set(accountId, stored);
				return { status: 200, body: info(stored) };
			}
		}
		if (route === 'vacation/request-form/mapping' && req.method === 'PUT') {
			if (!form) return error(409, 'no_template');
			if (req.body === undefined || req.body === null || typeof req.body !== 'object') return error(400, 'bad_request');
			if (new TextEncoder().encode(JSON.stringify(req.body)).length > FORM_MAX_MAPPING_BYTES) return error(413, 'mapping_too_large');
			form.mapping = req.body;
			form.updatedAt = now;
			return { status: 200, body: info(form) };
		}
		return error(404, 'not_found');
	}

	return { handle, forms };
}
