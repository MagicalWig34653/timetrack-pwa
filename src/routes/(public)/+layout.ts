import { redirect } from '@sveltejs/kit';
import { sessionStore } from '#lib/session.svelte.js';
import type { LayoutLoad } from './$types';

/** Public pages: fully signed-in users are sent to the app. Recovery sessions may stay. */
export const load: LayoutLoad = async ({ url }) => {
	const session = await sessionStore.refresh();
	if (session && !session.recovery) {
		// A failed account-linking callback lands on /login although the user is signed in: keep the error visible.
		const oidcError = url.searchParams.get('oidc_error');
		redirect(307, oidcError ? `/settings/identities?oidc_error=${encodeURIComponent(oidcError)}` : '/');
	}
};
