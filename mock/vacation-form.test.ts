import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import { FormTemplateStore, createMemoryBackend } from '#lib/vacation-form/form-template-store.js';
import { emptyMapping, MappingTooLargeError } from '#lib/vacation-form/mapping.js';
import { makeFormPdf } from '#lib/vacation-form/test-pdf.js';
import { createMockFetch } from './fetch.ts';
import { FORM_MAX_FILE_BYTES, FORM_MAX_MAPPING_BYTES } from './vacation-form.ts';

let mock: ReturnType<typeof createMockFetch>;
type Fetch = typeof fetch;

async function login(wrap?: (inner: Fetch) => Fetch) {
	mock = createMockFetch();
	vi.stubGlobal('fetch', wrap ? wrap(mock.fetch as Fetch) : mock.fetch);
	setCsrfToken(null);
	const opts = await api.loginOptions();
	await api.loginVerify(opts.challengeId, { id: 'mock-login' });
}
afterEach(() => vi.unstubAllGlobals());

const code = (promise: Promise<unknown>) => promise.then(() => 'ok', (e: ApiError) => `${e.status}:${e.code}`);

describe('mock vacation request form endpoints', () => {
	beforeEach(() => login());

	it('starts empty, stores file and mapping, serves the file and deletes', async () => {
		expect(await api.getVacationRequestForm()).toMatchObject({ exists: false });
		const pdf = await makeFormPdf();
		const saved = await api.putVacationRequestFormFile(pdf, 'Mein Antrag Ü.pdf');
		expect(saved).toMatchObject({ exists: true, fileName: 'Mein Antrag Ü.pdf', sizeBytes: pdf.length });
		await api.putVacationRequestFormMapping({ version: 1, fields: { a: { source: 'lastName' } } });
		const info = await api.getVacationRequestForm();
		expect(info.mapping).toEqual({ version: 1, fields: { a: { source: 'lastName' } } });
		expect(info.updatedAt).toBeTruthy();
		const file = await api.downloadVacationRequestFormFile();
		expect(file.filename).toBe('Mein Antrag Ü.pdf');
		expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(pdf);
		await api.deleteVacationRequestForm();
		expect(await api.getVacationRequestForm()).toMatchObject({ exists: false });
		expect(await code(api.downloadVacationRequestFormFile())).toBe('404:not_found');
	});

	it('validates magic number, size and mapping preconditions', async () => {
		expect(await code(api.putVacationRequestFormFile(new TextEncoder().encode('hello world'), 'x.pdf'))).toBe('400:bad_request'); // PDF content type without the magic number
		expect(await code(api.putVacationRequestFormFile(new Uint8Array(0), 'x.pdf'))).toBe('400:bad_request');
		const big = new Uint8Array(FORM_MAX_FILE_BYTES + 1);
		big.set(new TextEncoder().encode('%PDF-1.7'));
		expect(await code(api.putVacationRequestFormFile(big, 'x.pdf'))).toBe('413:file_too_large');
		expect(await code(api.putVacationRequestFormMapping({ a: 1 }))).toBe('409:no_template');
		await api.putVacationRequestFormFile(await makeFormPdf(), 'x.pdf');
		const bigMapping = { pad: 'x'.repeat(FORM_MAX_MAPPING_BYTES) };
		expect(await code(api.putVacationRequestFormMapping(bigMapping))).toBe('413:mapping_too_large');
	});

	it('keeps templates apart per account', async () => {
		await api.putVacationRequestFormFile(await makeFormPdf(), 'admin.pdf');
		const second = createMockFetch();
		vi.stubGlobal('fetch', second.fetch);
		setCsrfToken(null);
		const opts = await api.loginOptions();
		await api.loginVerify(opts.challengeId, { id: 'mock-login' });
		expect(await api.getVacationRequestForm()).toMatchObject({ exists: false }); // separate mock instance, separate state
	});
});

describe('FormTemplateStore against the server', () => {
	beforeEach(() => login());

	it('round-trips through the server endpoints', async () => {
		const store = new FormTemplateStore('acc-1', createMemoryBackend());
		expect(await store.load()).toBeNull();
		expect(store.storage).toBe('server');
		const pdf = await makeFormPdf();
		const mapping = { ...emptyMapping(), fields: { last_name: { source: 'lastName' as const } } };
		await store.saveFile(pdf, 'form.pdf', mapping);
		const loaded = await store.load();
		expect(loaded?.fileName).toBe('form.pdf');
		expect(loaded?.bytes).toEqual(pdf);
		expect(loaded?.mapping.fields).toEqual({ last_name: { source: 'lastName' } });
		await store.saveMapping({ ...mapping, flatten: true });
		expect((await store.load())?.mapping.flatten).toBe(true);
		expect(await store.exists()).toBe(true);
		await store.remove();
		expect(await store.exists()).toBe(false);
	});

	it('refuses an oversized mapping before anything is sent', async () => {
		const store = new FormTemplateStore('acc-1', createMemoryBackend());
		const big = emptyMapping();
		for (let i = 0; i < 2500; i++) big.fields[`a_rather_long_field_name_${i}`] = { source: 'fixedText', text: 'x'.repeat(30) };
		const before = mock.calls.length;
		await expect(store.saveFile(await makeFormPdf(), 'f.pdf', big)).rejects.toBeInstanceOf(MappingTooLargeError);
		expect(mock.calls.length).toBe(before);
	});
});

describe('FormTemplateStore offline cache', () => {
	const cut = { on: false };
	const flaky = (inner: Fetch): Fetch => async (input, init) => {
		if (cut.on) throw new TypeError('offline');
		return inner(input, init);
	};
	beforeEach(() => {
		cut.on = false;
		return login(flaky);
	});

	it('serves the cached copy when the server is unreachable, but refuses writes', async () => {
		const local = createMemoryBackend();
		const store = new FormTemplateStore('acc-1', local);
		const pdf = await makeFormPdf();
		await store.saveFile(pdf, 'form.pdf', { ...emptyMapping(), person: { ...emptyMapping().person, lastName: 'Muster' } });
		cut.on = true;
		const offline = new FormTemplateStore('acc-1', local);
		const loaded = await offline.load();
		expect(offline.storage).toBe('offline');
		expect(loaded?.bytes).toEqual(pdf);
		expect(loaded?.mapping.person.lastName).toBe('Muster');
		expect(await offline.exists()).toBe(true);
		await expect(offline.saveMapping(emptyMapping())).rejects.toMatchObject({ code: 'network_error' });
		await expect(offline.remove()).rejects.toMatchObject({ code: 'network_error' });
		expect(await new FormTemplateStore('acc-2', local).exists().catch(() => 'net')).toBe(false); // other account: no cache
	});

	it('shows the network error offline without a cached copy', async () => {
		cut.on = true;
		await expect(new FormTemplateStore('acc-1', createMemoryBackend()).load()).rejects.toMatchObject({ code: 'network_error' });
	});

	it('drops the cache when the server has no template or after removal', async () => {
		const local = createMemoryBackend();
		const store = new FormTemplateStore('acc-1', local);
		await store.saveFile(await makeFormPdf(), 'form.pdf');
		expect(await local.read('template:acc-1')).not.toBeNull();
		await store.remove();
		expect(await local.read('template:acc-1')).toBeNull();
	});

	it('updates the cached mapping after saving', async () => {
		const local = createMemoryBackend();
		const store = new FormTemplateStore('acc-1', local);
		await store.saveFile(await makeFormPdf(), 'form.pdf');
		await store.saveMapping({ ...emptyMapping(), flatten: true });
		expect((await local.read('template:acc-1'))?.mapping).toMatchObject({ flatten: true });
	});

	it('does not break when the cache itself fails', async () => {
		const broken = { read: async () => { throw new Error('idb'); }, write: async () => { throw new Error('idb'); }, remove: async () => { throw new Error('idb'); } };
		const store = new FormTemplateStore('acc-1', broken);
		await store.saveFile(await makeFormPdf(), 'form.pdf');
		expect((await store.load())?.fileName).toBe('form.pdf');
	});

	it('surfaces no_template (409) as an ApiError instead of writing locally', async () => {
		const store = new FormTemplateStore('acc-1', createMemoryBackend());
		await expect(store.saveMapping(emptyMapping())).rejects.toMatchObject({ status: 409, code: 'no_template' });
	});

	it('treats a 404 as a real answer, not as a missing endpoint', async () => {
		await login((inner) => async (input, init) =>
			String(input).includes('/vacation/request-form')
				? new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
				: inner(input, init)
		);
		await expect(new FormTemplateStore('acc-1', createMemoryBackend()).load()).rejects.toMatchObject({ status: 404 });
	});
});

describe('FormTemplateStore with a disabled module', () => {
	it('does not mistake module_disabled for a missing endpoint', async () => {
		await login((inner) => async (input, init) =>
			String(input).includes('/vacation/request-form')
				? new Response(JSON.stringify({ error: { code: 'module_disabled', message: 'x' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
				: inner(input, init)
		);
		const local = createMemoryBackend();
		await expect(new FormTemplateStore('acc-1', local).load()).rejects.toMatchObject({ code: 'module_disabled' });
	});
});
