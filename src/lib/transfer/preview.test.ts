import { describe, expect, it } from 'vitest';
import { previewKind, previewMime, typeLabel } from './preview.js';

describe('previewKind', () => {
	it('previews images, PDFs and text', () => {
		expect(previewKind({ name: 'a.png', contentType: 'image/png' })).toBe('image');
		expect(previewKind({ name: 'a.jpg', contentType: 'image/jpeg' })).toBe('image');
		expect(previewKind({ name: 'a.pdf', contentType: 'application/pdf' })).toBe('pdf');
		expect(previewKind({ name: 'a.txt', contentType: 'text/plain; charset=utf-8' })).toBe('text');
	});
	it('falls back to the extension for generic types and offers download only for the rest', () => {
		expect(previewKind({ name: 'a.pdf', contentType: 'application/octet-stream' })).toBe('pdf');
		expect(previewKind({ name: 'a.heic', contentType: 'image/heic' })).toBe('none');
		expect(previewKind({ name: 'a.docx', contentType: 'application/octet-stream' })).toBe('none');
	});
	it('chooses inline MIME types and labels', () => {
		expect(previewMime('pdf', { name: 'a.pdf', contentType: 'application/octet-stream' })).toBe('application/pdf');
		expect(previewMime('image', { name: 'a.png', contentType: 'image/png' })).toBe('image/png');
		expect(typeLabel({ name: 'a.jpeg', contentType: 'image/jpeg' })).toBe('JPG');
		expect(typeLabel({ name: 'a.heic', contentType: 'image/heic' })).toBe('HEIC');
	});
});
