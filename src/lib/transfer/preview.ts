import { extensionOf } from './attachments.js';

/** How an attachment can be shown in the browser. HEIC is not displayed by most browsers, so it only offers the download. */
export type PreviewKind = 'image' | 'pdf' | 'text' | 'none';

/** Largest text file rendered inline; bigger ones only offer the download. */
export const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;

const baseType = (contentType: string) => contentType.split(';')[0].trim().toLowerCase();

export function previewKind(file: { name: string; contentType: string }): PreviewKind {
	const type = baseType(file.contentType);
	const ext = extensionOf(file.name);
	const generic = type === 'application/octet-stream' || type === '';
	if (type === 'image/png' || type === 'image/jpeg' || type === 'image/jpg' || (generic && ['png', 'jpg', 'jpeg'].includes(ext))) return 'image';
	if (type === 'application/pdf' || (generic && ext === 'pdf')) return 'pdf';
	if (type === 'text/plain' || (generic && ext === 'txt')) return 'text';
	return 'none';
}

/** The type a blob must carry so the browser renders it inline instead of offering a save dialog. */
export function previewMime(kind: PreviewKind, file: { name: string; contentType: string }): string {
	if (kind === 'pdf') return 'application/pdf';
	if (kind === 'text') return 'text/plain;charset=utf-8';
	if (kind === 'image') return extensionOf(file.name) === 'png' || baseType(file.contentType) === 'image/png' ? 'image/png' : 'image/jpeg';
	return file.contentType;
}

/** Human-readable type for the list: "PDF", "PNG", "JPG", "HEIC", "Text". */
export function typeLabel(file: { name: string; contentType: string }): string {
	const type = baseType(file.contentType);
	if (type === 'application/pdf') return 'PDF';
	if (type === 'image/png') return 'PNG';
	if (type === 'image/jpeg') return 'JPG';
	if (type === 'image/heic' || type === 'image/heif') return 'HEIC';
	if (type === 'text/plain') return 'Text';
	return extensionOf(file.name).toUpperCase() || type;
}
