import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import type { Place } from '#lib/api/types.js';
import { sessionStore } from '#lib/session.svelte.js';
import TimerCard from './TimerCard.svelte';

const NOW = Date.parse('2026-10-14T09:30:00Z'); // 11:30 in Berlin
let mock: ReturnType<typeof createMockFetch>;
let places: Place[] = [];

beforeEach(async () => {
	mock = createMockFetch({ now: () => NOW });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
	places = await api.listPlaces();
});
afterEach(() => vi.unstubAllGlobals());

const finished = (endIso: string) => api.createSegment({ kind: 'school', startedAt: '2026-10-14T06:00:00Z', endedAt: endIso });
const patches = () => mock.calls.filter((c) => c.method === 'PATCH');
const props = { places: [] as Place[], now: NOW, timeZone: 'Europe/Berlin' };

function patchAnswers(make: () => Response) {
	const inner = mock.fetch;
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => (init?.method === 'PATCH' ? make() : inner(input, init)));
}

describe('TimerCard: Fortführen', () => {
	it('offers one button with the gap hint for a short gap and reopens the segment', async () => {
		const last = await finished('2026-10-14T09:20:00Z'); // 11:20, gap 10 min
		const onchange = vi.fn();
		render(TimerCard, { ...props, running: null, last, onchange });
		expect(screen.getByRole('button', { name: 'Fortführen: Schule, zuletzt bis 11:20' })).toBeInTheDocument();
		expect(screen.getByText('Lücke von 0:10 Std. wird als Arbeitszeit gezählt.')).toBeInTheDocument();
		expect(screen.queryByTestId('continue-restart')).toBeNull();
		await userEvent.click(screen.getByTestId('continue-reopen'));
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(onchange.mock.calls[0][0]).toMatchObject({ id: last.id, endedAt: null });
		expect(patches()).toHaveLength(1);
		expect(screen.getByTestId('continue-notice')).toHaveTextContent('die Lücke zählt als Arbeitszeit');
	});

	it('offers both choices for a gap above 15 minutes; restart keeps the gap a pause', async () => {
		const last = await finished('2026-10-14T09:00:00Z'); // gap 30 min
		const onchange = vi.fn();
		render(TimerCard, { ...props, running: null, last, onchange });
		expect(screen.getByRole('button', { name: 'Fortführen (Lücke zählt mit)' })).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Neu starten (Lücke bleibt Pause)' }));
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(onchange.mock.calls[0][0]).toMatchObject({ kind: 'school', endedAt: null });
		expect(onchange.mock.calls[0][0].id).not.toBe(last.id);
		expect(patches()).toHaveLength(0);
	});

	it('is hidden while a timer runs and when there is nothing to continue', async () => {
		const last = await finished('2026-10-14T09:20:00Z');
		const view = render(TimerCard, { ...props, running: null, last: null, onchange: vi.fn() });
		expect(screen.queryByTestId('continue-panel')).toBeNull();
		view.unmount();
		const started = await api.startTimer({ clientEventId: 'e1', kind: 'work' });
		render(TimerCard, { ...props, running: started, last, onchange: vi.fn() });
		expect(screen.queryByTestId('continue-panel')).toBeNull();
	});

	it('shows the guard message and re-reads the timer on a conflict', async () => {
		const last = await finished('2026-10-14T09:20:00Z');
		await api.startTimer({ clientEventId: 'e2', kind: 'work' }); // another device runs a timer
		const onchange = vi.fn();
		render(TimerCard, { ...props, running: null, last, onchange });
		await userEvent.click(screen.getByTestId('continue-reopen'));
		expect(await screen.findByText('Es läuft bereits ein Timer.')).toBeInTheDocument();
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(onchange.mock.calls[0][0]).not.toBeNull();
	});

	it('tells honestly when the server could not reopen and a new segment was started', async () => {
		const last = await finished('2026-10-14T09:20:00Z');
		patchAnswers(() => new Response(JSON.stringify({ code: 'bad_request', message: 'x' }), { status: 400, headers: { 'content-type': 'application/json' } }));
		const onchange = vi.fn();
		render(TimerCard, { ...props, running: null, last, onchange });
		await userEvent.click(screen.getByTestId('continue-reopen'));
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(screen.getByTestId('continue-notice')).toHaveTextContent('die Lücke von 0:10 Std. bleibt Pause');
	});

	it('shows a network error without falling back', async () => {
		const last = await finished('2026-10-14T09:20:00Z');
		patchAnswers(() => {
			throw new TypeError('offline');
		});
		const onchange = vi.fn();
		render(TimerCard, { ...props, running: null, last, onchange, retryDelayMs: 0 });
		await userEvent.click(screen.getByTestId('continue-reopen'));
		expect(await screen.findByText(/nicht erreichbar/)).toBeInTheDocument();
		expect(onchange).not.toHaveBeenCalled();
		expect(mock.calls.filter((c) => c.path.endsWith('/time/timer/start'))).toHaveLength(0);
	});
});
