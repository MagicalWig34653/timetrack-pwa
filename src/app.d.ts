// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface ImportMetaEnv {
		/** '1' when started via `npm run dev:mock`: in-repo mock API and fake authenticator */
		readonly VITE_MOCK?: string;
	}
}

export {};
