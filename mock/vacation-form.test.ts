import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '#lib/api/client.js';
import { FormTemplateStore, createMemoryBackend } from '#lib/vacation-form/form-template-store.js';
import { emptyMapping, MappingTooLargeError } from '#lib/vacation-form/mapping.js';
import { makeFormPdf } from '#lib/vacation-form/test-pdf.js';
import { createMockFetch } from './fetch.ts';
import { FORM_MAX_FILE_BYTES } from './vacation-form.ts';

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
		expect(await code(api.putVacationRequestFormFile(new TextEncoder().encode('hello world'), 'x.pdf'))).toBe('415:unsupported_type');
		const big = new Uint8Array(FORM_MAX_FILE_BYTES + 1);
		big.set(new TextEncoder().encode('%PDF-1.7'));
		expect(await code(api.putVacationRequestFormFile(big, 'x.pdf'))).toBe('413:file_too_large');
		expect(await code(api.putVacationRequestFormMapping({ a: 1 }))).toBe('409:no_template');
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

describe.each([404, 501])('FormTemplateStore falls back to local storage on %i', (status) => {
	const refuse = (inner: Fetch): Fetch => async (input, init) =>
		String(input).includes('/vacation/request-form')
			? new Response(JSON.stringify({ error: { code: status === 404 ? 'not_found' : 'not_implemented', message: 'x' } }), { status, headers: { 'Content-Type': 'application/json' } })
			: inner(input, init);
	beforeEach(() => login(refuse));

	it('stores in the local backend, per account', async () => {
		const local = createMemoryBackend();
		const store = new FormTemplateStore('acc-1', local);
		expect(await store.load()).toBeNull();
		expect(store.storage).toBe('local');
		const pdf = await makeFormPdf();
		await store.saveFile(pdf, 'form.pdf');
		await store.saveMapping({ ...emptyMapping(), person: { ...emptyMapping().person, lastName: 'Muster' } });
		const loaded = await store.load();
		expect(loaded?.bytes).toEqual(pdf);
		expect(loaded?.mapping.person.lastName).toBe('Muster');
		expect(await new FormTemplateStore('acc-2', local).exists()).toBe(false);
		await store.remove();
		expect(await store.exists()).toBe(false);
	});

	it('cannot save a mapping without a template', async () => {
		const store = new FormTemplateStore('acc-1', createMemoryBackend());
		await expect(store.saveMapping(emptyMapping())).rejects.toThrow('no template');
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
