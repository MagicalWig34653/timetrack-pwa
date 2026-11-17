import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { sessionStore } from '#lib/session.svelte.js';
import { zoneStore } from '#lib/time/zone.svelte.js';
import DayTimeSections from './DayTimeSections.svelte';

const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'], now: NOW });
	mock = createMockFetch({ now: () => NOW.getTime() });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	zoneStore.reset();
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('day time sections: switching the date', () => {
	it('ignores a late answer of the previous day, so its settings never show (or get saved) under the new date (review finding 3)', async () => {
		const A = '2026-10-12';
		const B = '2026-10-13';
		await api.setDayPreferences(A, { mark: 'sick', schoolLessonCount: null, creditSeconds: null, skipFixedBreaks: false });
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let held = false;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
			if ((init.method ?? 'GET').toUpperCase() === 'GET' && String(input).endsWith(`/time/days/${A}`)) {
				held = true;
				await gate;
			}
			return mock.fetch(input, init);
		});
		const view = render(DayTimeSections, { date: A });
		await waitFor(() => expect(held).toBe(true));
		await view.rerender({ date: B });
		await waitFor(() => expect(screen.getByLabelText('Markierung')).toBeInTheDocument());
		expect(screen.getByLabelText('Markierung')).toHaveValue('none');
		release();
		await waitFor(() => expect(mock.calls.filter((c) => c.method === 'GET' && c.path.endsWith(`/time/days/${A}`))).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(screen.getByLabelText('Markierung')).toHaveValue('none');
	});
});
