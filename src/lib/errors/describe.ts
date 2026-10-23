import type { MessageKey } from '#lib/i18n/index.js';

export type ErrorKind = 'not_found' | 'forbidden' | 'unauthorized' | 'server' | 'unexpected' | 'offline';

export interface ErrorView {
	kind: ErrorKind;
	titleKey: MessageKey;
	textKey: MessageKey;
}

const VIEWS: Record<ErrorKind, ErrorView> = {
	not_found: { kind: 'not_found', titleKey: 'errorpage.not_found_title', textKey: 'errorpage.not_found_text' },
	forbidden: { kind: 'forbidden', titleKey: 'errorpage.forbidden_title', textKey: 'errorpage.forbidden_text' },
	unauthorized: { kind: 'unauthorized', titleKey: 'errorpage.unauthorized_title', textKey: 'errorpage.unauthorized_text' },
	server: { kind: 'server', titleKey: 'errorpage.server_title', textKey: 'errorpage.server_text' },
	unexpected: { kind: 'unexpected', titleKey: 'errorpage.unexpected_title', textKey: 'errorpage.unexpected_text' },
	offline: { kind: 'offline', titleKey: 'errorpage.offline_title', textKey: 'errorpage.offline_text' }
};

/** Maps an HTTP-like status (and the browser's online state) to the texts of an error page. Raw error messages are never shown. */
export function describeError(status: number, online = true): ErrorView {
	if (!online && status !== 404 && status !== 403) return VIEWS.offline;
	if (status === 404) return VIEWS.not_found;
	if (status === 403) return VIEWS.forbidden;
	if (status === 401) return VIEWS.unauthorized;
	if (status >= 500) return VIEWS.server;
	return VIEWS.unexpected;
}

/** Short random identifier for an unexpected error, so a report can be matched with the browser console. */
export function newErrorId(random: () => number = Math.random): string {
	let id = '';
	for (let i = 0; i < 8; i++) id += Math.floor(random() * 16).toString(16);
	return id.toUpperCase();
}
