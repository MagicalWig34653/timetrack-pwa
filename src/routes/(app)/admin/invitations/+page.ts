import { redirect } from '@sveltejs/kit';
import { sessionStore } from '#lib/session.svelte.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	await parent();
	if (sessionStore.current?.account.role !== 'admin') redirect(307, '/');
};
