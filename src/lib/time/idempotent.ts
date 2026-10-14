import { ApiError } from '#lib/api/errors.js';

export interface RetryOptions {
	attempts?: number;
	delayMs?: number;
}

/**
 * Re-runs `call` after network errors only (status 0). Callers pass the SAME clientEventId on every attempt,
 * so the server (idempotent over clientEventId) answers a repeated request with the first result.
 */
export async function retryOnNetworkError<T>(call: () => Promise<T>, { attempts = 3, delayMs = 400 }: RetryOptions = {}): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await call();
		} catch (error) {
			lastError = error;
			if (!(error instanceof ApiError) || error.status !== 0) throw error;
			if (attempt < attempts - 1 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
		}
	}
	throw lastError;
}

export function newEventId(): string {
	return crypto.randomUUID();
}
