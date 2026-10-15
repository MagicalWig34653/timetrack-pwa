import { redirect } from '@sveltejs/kit';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';
import type { LayoutLoad } from './$types';

/**
 * OAuth pages live outside the app layout (no navigation bar) but need a signed-in person:
 * without a session the visitor is sent to the login and comes back to the exact consent URL.
 */
export const load: LayoutLoad = async ({ url }) => {
	const session = await sessionStore.refresh();
	if (!session) redirect(307, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	if (session.recovery) redirect(307, '/recover/passkey');
	await moduleStore.ensure(session.account.id);
	return { session };
};
