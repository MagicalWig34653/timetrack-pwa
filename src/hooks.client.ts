import type { HandleClientError } from '@sveltejs/kit/hooks';
import { newErrorId } from '#lib/errors/describe.js';

/** Unexpected client errors: details go to the console only; the user sees a generic message and an id (no stack traces). */
export const handleError: HandleClientError = (input) => {
	// framework (404) and app errors keep their status; the message is never shown (the error page uses German texts per status)
	if (input.kind !== 'unknown') return { message: input.kind === 'framework' ? 'Not Found' : 'Error' };
	const errorId = newErrorId();
	console.error(`[${errorId}]`, input.error);
	return { message: 'Unexpected error', errorId };
};
