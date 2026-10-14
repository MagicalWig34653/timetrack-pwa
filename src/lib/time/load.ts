import { ApiError } from '#lib/api/errors.js';
import { errorMessage } from '#lib/i18n/index.js';

export type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'unavailable' } | { status: 'error'; message: string };

/** 404/501 from a time endpoint means the server predates the time tracking API (stage 2). */
export function toLoadState(error: unknown): LoadState {
	if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
		return { status: 'unavailable' };
	}
	return { status: 'error', message: errorMessage(error) };
}
