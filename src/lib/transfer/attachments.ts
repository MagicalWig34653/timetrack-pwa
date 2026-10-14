import { formatBytes } from './bytes';

/** ADR-0006 whitelist: pdf, png, jpg, heic, txt. The server also sniffs the content; this only catches the obvious early. */
export const ATTACHMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'txt'] as const;
export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic,.txt,application/pdf,image/png,image/jpeg,image/heic,text/plain';

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAllowedAttachment(file: { name: string }): boolean {
	return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
}

/** "krankmeldung.pdf (1,5 MiB)" */
export function describeFile(file: { name: string; size: number }): string {
	return `${file.name} (${formatBytes(file.size)})`;
}
