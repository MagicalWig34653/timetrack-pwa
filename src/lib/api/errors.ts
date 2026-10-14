/** Uniform error for every failed API call. `code` is the technical English code from the backend. */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	/** Parsed JSON body of the error response, if any (e.g. the conflict list of a refused rollback). */
	readonly body: unknown;

	constructor(status: number, code: string, message = code, body?: unknown) {
		super(message);
		this.body = body;
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
	}
}
