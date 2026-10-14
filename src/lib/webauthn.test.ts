import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	base64urlToBuffer,
	bufferToBase64url,
	createPasskey,
	creationOptionsFromJSON,
	getPasskey,
	requestOptionsFromJSON,
	WebAuthnError
} from './webauthn.js';

class FakePublicKeyCredential {}

afterEach(() => vi.unstubAllGlobals());

describe('base64url helpers', () => {
	it('round-trips bytes including URL-unsafe characters', () => {
		const bytes = new Uint8Array([251, 255, 190, 0, 1, 2, 250]);
		const encoded = bufferToBase64url(bytes);
		expect(encoded).not.toMatch(/[+/=]/);
		expect(new Uint8Array(base64urlToBuffer(encoded))).toEqual(bytes);
	});
});

describe('option conversion fallback', () => {
	it('decodes challenge, user id and credential ids to ArrayBuffers', () => {
		vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
		const creation = creationOptionsFromJSON({
			rp: { name: 'Timetrack', id: 'localhost' },
			user: { id: 'AQID', name: 'a', displayName: 'A' },
			challenge: 'BAUG',
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			excludeCredentials: [{ type: 'public-key', id: 'Bw' }]
		});
		expect(new Uint8Array(creation.challenge as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
		expect(new Uint8Array(creation.user.id as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
		expect(new Uint8Array(creation.excludeCredentials![0].id as ArrayBuffer)).toEqual(new Uint8Array([7]));

		const request = requestOptionsFromJSON({ challenge: 'BAUG', allowCredentials: [{ type: 'public-key', id: 'Bw' }] });
		expect(new Uint8Array(request.challenge as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
	});

	it('prefers the native parser when available', () => {
		const parse = vi.fn(() => ({ native: true }));
		vi.stubGlobal('PublicKeyCredential', Object.assign(class {}, { parseRequestOptionsFromJSON: parse }));
		expect(requestOptionsFromJSON({ challenge: 'AA' })).toEqual({ native: true });
		expect(parse).toHaveBeenCalled();
	});
});

describe('credential ceremonies', () => {
	const creationJson = {
		rp: { name: 'T' },
		user: { id: 'AQ', name: 'a', displayName: 'A' },
		challenge: 'AQ',
		pubKeyCredParams: []
	};

	function stubBrowser(create: () => Promise<unknown>) {
		vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
		vi.stubGlobal('navigator', { credentials: { create, get: create } });
	}

	it('reports unsupported browsers', async () => {
		vi.stubGlobal('PublicKeyCredential', undefined);
		await expect(createPasskey(creationJson)).rejects.toMatchObject({ kind: 'unsupported' });
		await expect(getPasskey({ challenge: 'AQ' })).rejects.toBeInstanceOf(WebAuthnError);
	});

	it('maps user cancellation and duplicates', async () => {
		stubBrowser(() => Promise.reject(new DOMException('x', 'NotAllowedError')));
		await expect(createPasskey(creationJson)).rejects.toMatchObject({ kind: 'cancelled' });
		stubBrowser(() => Promise.reject(new DOMException('x', 'InvalidStateError')));
		await expect(createPasskey(creationJson)).rejects.toMatchObject({ kind: 'already_registered' });
	});

	it('uses toJSON() of the credential when present', async () => {
		const credential = Object.assign(new FakePublicKeyCredential(), { toJSON: () => ({ id: 'abc', type: 'public-key' }) });
		stubBrowser(() => Promise.resolve(credential));
		await expect(createPasskey(creationJson)).resolves.toEqual({ id: 'abc', type: 'public-key' });
	});
});
