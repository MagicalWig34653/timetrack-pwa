import { redirect } from '@sveltejs/kit';
import { isoWeekLabel, isValidDate, startOfWeek } from '#lib/time/dates.js';
import type { PageLoad } from './$types';

/**
 * /time was merged into the week page (N2): old links and bookmarks land on /week. `?week=YYYY-MM-DD` (a day of the wanted
 * week) becomes `?week=YYYY-Www`; the review filter stays reachable there (`?review=1`).
 */
export const load: PageLoad = ({ url }) => {
	const day = url.searchParams.get('week') ?? '';
	const params = new URLSearchParams();
	if (isValidDate(day)) params.set('week', isoWeekLabel(startOfWeek(day)));
	if (url.searchParams.get('review') === '1') params.set('review', '1');
	const query = params.toString();
	redirect(307, query ? `/week?${query}` : '/week');
};
