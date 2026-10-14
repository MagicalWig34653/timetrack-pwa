import { redirect } from '@sveltejs/kit';
import { sessionStore } from '#lib/session.svelte.js';
import type { LayoutLoad } from './$types';

/** Public pages: fully signed-in users are sent to the app. Recovery sessions may stay. */
export const load: LayoutLoad = async () => {
	const session = await sessionStore.refresh();
	if (session && !session.recovery) redirect(307, '/');
};
