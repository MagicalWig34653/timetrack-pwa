import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import type { Place, Segment } from '#lib/api/types.js';
import { sessionStore } from '#lib/session.svelte.js';
import { toLocalInputValue } from '#lib/time/dates.js';
import SegmentForm from './SegmentForm.svelte';
import TimerCard from './TimerCard.svelte';

const NOW = Date.parse('2026-10-14T09:30:00Z'); // 11:30 in Berlin
let mock: ReturnType<typeof createMockFetch>;
let places: Place[] = [];

async function signIn() {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
	places = await api.listPlaces();
}

beforeEach(async () => {
	mock = createMockFetch({ now: () => NOW });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	await signIn();
});
afterEach(() => vi.unstubAllGlobals());

const timerCalls = (suffix: string) => mock.calls.filter((c) => c.method === 'POST' && c.path.endsWith(suffix));

describe('TimerCard', () => {
	it('starts the timer with place and kind and reports the running segment', async () => {
		const onchange = vi.fn();
		render(TimerCard, { running: null, places, now: NOW, timeZone: 'Europe/Berlin', onchange });
		await userEvent.selectOptions(screen.getByLabelText('Ort'), 'Berufsschule');
		// choosing a place preselects its default kind
		expect(screen.getByLabelText('Art')).toHaveValue('school');
		await userEvent.click(screen.getByRole('button', { name: 'Start' }));
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		const segment = onchange.mock.calls[0][0] as Segment;
		expect(segment).toMatchObject({ kind: 'school', endedAt: null, source: 'timer' });
		expect(segment.placeId).toBe(places.find((p) => p.name === 'Berufsschule')!.id);
	});

	it('does not book twice on a double click and sends one UUID clientEventId', async () => {
		// hold the response so the second and third click arrive while the first call is still pending
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const inner = mock.fetch;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).endsWith('/time/timer/start')) await gate;
			return inner(input, init);
		});
		const onchange = vi.fn();
		render(TimerCard, { running: null, places, now: NOW, timeZone: 'Europe/Berlin', onchange });
		const button = screen.getByRole('button', { name: 'Start' });
		const clicks = Promise.all([userEvent.click(button), userEvent.click(button), userEvent.click(button)]);
		await new Promise((resolve) => setTimeout(resolve, 30));
		release();
		await clicks;
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(timerCalls('/time/timer/start')).toHaveLength(1);
		expect(onchange).toHaveBeenCalledTimes(1);
		const segments = await api.listSegments('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z');
		expect(segments.filter((s) => s.endedAt === null)).toHaveLength(1);
	});

	it('disables the button while the call is pending', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const inner = mock.fetch;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			await gate;
			return inner(input, init);
		});
		render(TimerCard, { running: null, places, now: NOW, timeZone: 'Europe/Berlin', onchange: vi.fn() });
		await userEvent.click(screen.getByRole('button', { name: 'Start' }));
		expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
		release();
		await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled());
	});

	it('retries after a network error with the SAME clientEventId and ends with one running segment', async () => {
		const inner = mock.fetch;
		const bodies: string[] = [];
		let failures = 1;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).endsWith('/time/timer/start')) {
				bodies.push(String(init?.body));
				if (failures-- > 0) {
					// the request reached the server but the response got lost
					await inner(input, init);
					throw new TypeError('network down');
				}
			}
			return inner(input, init);
		});
		const onchange = vi.fn();
		render(TimerCard, { running: null, places, now: NOW, timeZone: 'Europe/Berlin', onchange, retryDelayMs: 0 });
		await userEvent.click(screen.getByRole('button', { name: 'Start' }));
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(bodies).toHaveLength(2);
		expect(JSON.parse(bodies[0]).clientEventId).toBe(JSON.parse(bodies[1]).clientEventId);
		expect(JSON.parse(bodies[0]).clientEventId).toMatch(/^[0-9a-f-]{36}$/);
		const segments = await api.listSegments('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z');
		expect(segments.filter((s) => s.endedAt === null)).toHaveLength(1);
	});

	it('shows the elapsed time as h:mm and stops the timer', async () => {
		const started = await api.startTimer({ clientEventId: crypto.randomUUID() });
		const onchange = vi.fn();
		const startedMs = Date.parse(started.startedAt);
		render(TimerCard, { running: started, places, now: startedMs + (2 * 3600 + 5 * 60 + 9) * 1000, timeZone: 'Europe/Berlin', onchange });
		expect(screen.getByTestId('elapsed')).toHaveTextContent('2:05');
		await userEvent.click(screen.getByRole('button', { name: 'Stopp' }));
		await waitFor(() => expect(onchange).toHaveBeenCalled());
		expect(onchange.mock.calls[0][0]).toBeNull();
		expect(await api.currentTimer()).toBeNull();
	});

	it('shows a German message when a timer is already running elsewhere and re-reads the state', async () => {
		await api.startTimer({ clientEventId: crypto.randomUUID() });
		const onchange = vi.fn();
		render(TimerCard, { running: null, places, now: NOW, timeZone: 'Europe/Berlin', onchange });
		await userEvent.click(screen.getByRole('button', { name: 'Start' }));
		expect(await screen.findByText('Es läuft bereits ein Timer.')).toBeInTheDocument();
		await waitFor(() => expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ endedAt: null })));
	});
});

describe('SegmentForm', () => {
	const timeZone = 'Europe/Berlin';
	let segment: Segment;

	beforeEach(async () => {
		segment = await api.createSegment({ kind: 'work', startedAt: '2026-10-14T06:00:00Z', endedAt: '2026-10-14T10:00:00Z' });
	});

	function renderCorrection(onsaved = vi.fn(), oncancel = vi.fn()) {
		render(SegmentForm, { segment, date: '2026-10-14', places, timeZone, onsaved, oncancel });
		return { onsaved, oncancel };
	}

	it('requires a reason for a correction and sends nothing without it', async () => {
		const { onsaved } = renderCorrection();
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Bitte gib einen Grund an.')).toBeInTheDocument();
		expect(onsaved).not.toHaveBeenCalled();
		expect(mock.calls.some((c) => c.method === 'PATCH')).toBe(false);
	});

	it('rejects an end before the start', async () => {
		renderCorrection();
		const end = screen.getByLabelText('Ende');
		await userEvent.clear(end);
		await userEvent.type(end, toLocalInputValue('2026-10-14T05:00:00Z', timeZone));
		await userEvent.type(screen.getByLabelText(/^Grund/), 'Falsch eingetragen');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Das Ende muss nach dem Beginn liegen.')).toBeInTheDocument();
		expect(mock.calls.some((c) => c.method === 'PATCH')).toBe(false);
	});

	it('corrects with If-Match = current version and keeps the raw times', async () => {
		const { onsaved } = renderCorrection();
		const end = screen.getByLabelText('Ende');
		await userEvent.clear(end);
		await userEvent.type(end, toLocalInputValue('2026-10-14T10:30:00Z', timeZone));
		await userEvent.type(screen.getByLabelText(/^Grund/), 'Später gestoppt');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		const saved = onsaved.mock.calls[0][0] as Segment;
		expect(saved).toMatchObject({ version: 2, revisions: 1, endedAt: '2026-10-14T10:30:00.000Z', rawEndedAt: '2026-10-14T10:00:00Z' });
	});

	it('walks through the stale-version conflict: shows both sides, then applies on the new version', async () => {
		// somebody else corrects the segment first
		await api.correctSegment(segment.id, { endedAt: '2026-10-14T09:00:00Z', reason: 'Anderes Gerät' }, segment.version);
		const { onsaved } = renderCorrection();
		const end = screen.getByLabelText('Ende');
		await userEvent.clear(end);
		await userEvent.type(end, toLocalInputValue('2026-10-14T10:30:00Z', timeZone));
		await userEvent.type(screen.getByLabelText(/^Grund/), 'Später gestoppt');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

		const conflict = await screen.findByTestId('stale-conflict');
		expect(conflict).toHaveTextContent('Der Eintrag wurde zwischenzeitlich geändert');
		expect(conflict).toHaveTextContent('08:00–11:00'); // the other correction (09:00Z end = 11:00)
		expect(conflict).toHaveTextContent('08:00–12:30'); // my input
		expect(onsaved).not.toHaveBeenCalled();
		// one PATCH from the other client (setup) and exactly one rejected attempt from the form so far
		expect(mock.calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);

		await userEvent.click(screen.getByRole('button', { name: 'Auf neue Version anwenden' }));
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect((onsaved.mock.calls[0][0] as Segment).version).toBe(3);
	});

	it('lets the user discard after a conflict', async () => {
		await api.correctSegment(segment.id, { note: 'x', reason: 'anders' }, segment.version);
		const { oncancel } = renderCorrection();
		await userEvent.type(screen.getByLabelText(/^Grund/), 'Meine Änderung');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await screen.findByTestId('stale-conflict');
		await userEvent.click(screen.getByRole('button', { name: 'Verwerfen und neu laden' }));
		expect(oncancel).toHaveBeenCalled();
	});

	it('creates a manual segment without a reason', async () => {
		const onsaved = vi.fn();
		render(SegmentForm, { date: '2026-10-15', places, timeZone, onsaved, oncancel: vi.fn() });
		const start = screen.getByLabelText('Beginn');
		await userEvent.clear(start);
		await userEvent.type(start, '2026-10-15T08:00');
		const end = screen.getByLabelText('Ende');
		await userEvent.type(end, '2026-10-15T12:00');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(onsaved.mock.calls[0][0]).toMatchObject({ source: 'manual', startedAt: '2026-10-15T06:00:00.000Z' });
	});

	it('maps an overlap to a German message', async () => {
		const onsaved = vi.fn();
		render(SegmentForm, { date: '2026-10-14', places, timeZone, onsaved, oncancel: vi.fn() });
		const start = screen.getByLabelText('Beginn');
		await userEvent.clear(start);
		await userEvent.type(start, '2026-10-14T09:00'); // overlaps 08:00-12:00 local of the segment above
		await userEvent.type(screen.getByLabelText('Ende'), '2026-10-14T10:00');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		expect(await screen.findByText('Der Zeitraum überschneidet sich mit einem anderen Eintrag.')).toBeInTheDocument();
		expect(onsaved).not.toHaveBeenCalled();
	});
});
