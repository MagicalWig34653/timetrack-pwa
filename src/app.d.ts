// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		/** `errorId` is set by hooks.client.ts for unexpected errors and shown on the error page (no stack traces). */
		interface Error {
			message: string;
			errorId?: string;
		}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** Build metadata injected by vite.config.ts (`define`). */
	const __APP_VERSION__: string;
	const __APP_REVISION__: string;
	const __APP_BUILD_DATE__: string;

	interface ImportMetaEnv {
		/** '1' when started via `npm run dev:mock`: in-repo mock API and fake authenticator */
		readonly VITE_MOCK?: string;
		/** '1' registers the service worker in dev (E2E only); production builds always register it on https/localhost */
		readonly VITE_SW?: string;
	}
}

export {};
