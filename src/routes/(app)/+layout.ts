import { redirect } from '@sveltejs/kit';
import { sessionStore } from '#lib/session.svelte.js';
import type { LayoutLoad } from './$types';

const RECOVERY_PATH = '/recover/passkey';

/** Route guard: runs on every navigation (reads url) and checks GET /api/v1/auth/session. */
export const load: LayoutLoad = async ({ url }) => {
	const session = await sessionStore.refresh();
	if (!session) {
		const next = url.pathname + url.search;
		redirect(307, `/login?next=${encodeURIComponent(next)}`);
	}
	// A restricted recovery session may only set up a new passkey.
	if (session.recovery && url.pathname !== RECOVERY_PATH) redirect(307, RECOVERY_PATH);
	if (!session.recovery && url.pathname === RECOVERY_PATH) redirect(307, '/');
	return { session };
};
