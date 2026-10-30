import { ApiError } from '../api/errors';
import { filenameFromDisposition } from '../api/client';
import type { DownloadedFile, EntryCreated, EntryInput, EntryTake, OrderEntry, PollAnswer, PollVote, PublicGroup, VoteCreated, VoteInput } from '../api/types';
import { pwa } from '../pwa/pwa.svelte';

/**
 * Participant side of the groups module (ADR-0033): no account, no cookie, no CSRF token. The link token in the path is the
 * only credential; own votes and entries are changed with the edit secret in the X-Edit-Secret header. Deliberately a
 * separate client: requests never send credentials, never touch the owner read cache and are never retried automatically.
 */
const BASE = '/api/v1/public/groups';

async function send(method: string, path: string, body?: unknown, editSecret?: string): Promise<Response> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	if (editSecret) headers['X-Edit-Secret'] = editSecret;
	let response: Response;
	try {
		response = await fetch(BASE + path, { method, headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', body: body === undefined ? undefined : JSON.stringify(body) });
		pwa.reportNetwork(true);
	} catch {
		pwa.reportNetwork(false);
		throw new ApiError(0, 'network_error');
	}
	if (!response.ok) {
		let code = `http_${response.status}`;
		let message = response.statusText;
		try {
			const payload = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
			if (payload?.error?.code) code = String(payload.error.code);
			if (payload?.error?.message) message = String(payload.error.message);
		} catch {
			// non-JSON error body: keep the generic code
		}
		throw new ApiError(response.status, code, message);
	}
	return response;
}

async function json<T>(method: string, path: string, body?: unknown, editSecret?: string): Promise<T> {
	const response = await send(method, path, body, editSecret);
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

export const publicGroups = {
	view: (token: string) => json<PublicGroup>('GET', `/${enc(token)}`),
	castVote: (token: string, input: VoteInput) => json<VoteCreated>('POST', `/${enc(token)}/votes`, input),
	updateVote: (token: string, voteId: string, secret: string, input: VoteInput) => json<PollVote>('PUT', `/${enc(token)}/votes/${voteId}`, input, secret),
	deleteVote: (token: string, voteId: string, secret: string) => json<void>('DELETE', `/${enc(token)}/votes/${voteId}`, undefined, secret),
	addEntry: (token: string, input: EntryInput) => json<EntryCreated>('POST', `/${enc(token)}/entries`, input),
	updateEntry: (token: string, entryId: string, secret: string, input: EntryInput) => json<OrderEntry>('PUT', `/${enc(token)}/entries/${entryId}`, input, secret),
	deleteEntry: (token: string, entryId: string, secret: string) => json<void>('DELETE', `/${enc(token)}/entries/${entryId}`, undefined, secret),
	takeEntry: (token: string, entryId: string, input: EntryTake) => json<EntryCreated>('POST', `/${enc(token)}/entries/${entryId}/take`, input),
	async exportOrder(token: string, format: 'csv' | 'txt'): Promise<DownloadedFile> {
		const response = await send('GET', `/${enc(token)}/export?format=${format}`);
		return { blob: await response.blob(), filename: filenameFromDisposition(response.headers.get('Content-Disposition')) };
	}
};

export type { PollAnswer };
