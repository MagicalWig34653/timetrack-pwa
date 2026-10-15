import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { unread } from '#lib/notifications/unread.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => ({
	supported: true,
	permission: 'default' as 'default' | 'granted' | 'denied',
	requested: 'granted' as 'default' | 'granted' | 'denied',
	existing: null as null | { endpoint: string; unsubscribe: () => Promise<boolean>; toJSON: () => unknown; getKey: () => null },
	subscribeCalls: [] as string[]
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/notifications'), params: {} } }));
vi.mock('#lib/pwa/push.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/pwa/push.js')>();
	const makeSub = (endpoint: string) => ({
		endpoint,
		unsubscribe: vi.fn(async () => {
			push.existing = null;
			return true;
		}),
		toJSON: () => ({ endpoint, keys: { p256dh: 'BPubKey', auth: 'AuthSecret' } }),
		getKey: () => null
	});
	return {
		...original,
		pushSupported: () => push.supported,
		permissionState: () => push.permission,
		requestPermission: async () => {
			push.permission = push.requested;
			return push.requested;
		},
		browserSubscription: async () => push.existing,
		subscribeBrowser: async (key: string) => {
			push.subscribeCalls.push(key);
			push.existing = makeSub('https://push.example/send/device-1') as never;
			return { subscription: push.existing, created: true };
		},
		unsubscribeBrowser: async () => {
			push.existing = null;
		}
	};
});

import NotificationsPage from './(app)/notifications/+page.svelte';
import SettingsPage from './(app)/settings/notifications/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signIn() {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
}

async function hook(path: string, body: unknown) {
	const res = await mock.fetch(`/api/v1/mock/${path}`, { method: 'POST', headers: { 'X-CSRF-Token': (sessionStore.current as { csrfToken: string }).csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	return res.json();
}

beforeEach(async () => {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
	unread.set(0);
	Object.assign(push, { supported: true, permission: 'default', requested: 'granted', existing: null, subscribeCalls: [] });
	await signIn();
});
afterEach(() => vi.unstubAllGlobals());

describe('notification center', () => {
	it('shows the empty state', async () => {
		render(NotificationsPage);
		expect(await screen.findByTestId('notifications-empty')).toHaveTextContent('Keine Hinweise vorhanden.');
	});

	it('marks an unread item read and navigates to its link target', async () => {
		await hook('notify', { kind: 'report_gap' });
		await hook('notify', { kind: 'running_timer', ageMinutes: 5 });
		render(NotificationsPage);
		const list = await screen.findByTestId('notification-list');
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(items[0]).toHaveAttribute('data-unread', 'true');
		expect(within(items[0]).getByTestId('unread-dot')).toBeInTheDocument();
		await waitFor(() => expect(unread.count).toBe(2));

		await userEvent.click(within(items[0]).getAllByRole('button')[0]);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/reports'));
		expect(items[0]).toHaveAttribute('data-unread', 'false');
		expect(unread.count).toBe(1);
		expect(mock.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/notifications/read')).toBe(true);
	});

	it('marks all as read, deletes single entries and filters unread', async () => {
		await hook('notify', { kind: 'document_submission', count: 3 });
		render(NotificationsPage);
		await screen.findByTestId('notification-list');
		await userEvent.click(screen.getByRole('button', { name: 'Alle als gelesen' }));
		await waitFor(() => expect(unread.count).toBe(0));
		for (const item of screen.getAllByRole('listitem')) expect(item).toHaveAttribute('data-unread', 'false');

		const first = screen.getAllByRole('listitem')[0];
		await userEvent.click(within(first).getByRole('button', { name: /^Löschen:/ }));
		await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));

		await userEvent.click(screen.getByLabelText('Nur ungelesene'));
		expect(await screen.findByTestId('notifications-empty')).toHaveTextContent('Keine ungelesenen Hinweise.');
	});

	it('loads further pages with the before cursor', async () => {
		await hook('notify', { kind: 'pending_suggestions', count: 25 });
		render(NotificationsPage);
		await screen.findByTestId('notification-list');
		expect(screen.getAllByRole('listitem')).toHaveLength(20);
		await userEvent.click(screen.getByRole('button', { name: 'Weitere laden' }));
		await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(25));
		expect(mock.calls.some((c) => c.path.includes('before='))).toBe(true);
		expect(screen.queryByRole('button', { name: 'Weitere laden' })).toBeNull();
	});
});

describe('notification settings', () => {
	it('loads defaults and saves changes', async () => {
		render(SettingsPage);
		const timerRow = (await screen.findByTestId('category-list')).querySelector('[data-kind="running_timer"]') as HTMLElement;
		const threshold = within(timerRow).getByLabelText('Erinnern nach (Minuten)');
		expect(threshold).toHaveValue('600');
		await userEvent.clear(threshold);
		await userEvent.type(threshold, '90');
		await userEvent.click(within(timerRow).getByLabelText('Push'));
		await userEvent.click(screen.getByLabelText('Ruhezeiten verwenden'));
		await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
		await screen.findByText('Einstellungen gespeichert.');
		const saved = [...mock.state.notifications.settings.values()][0];
		expect(saved.categories.running_timer).toEqual({ inApp: true, push: false, thresholdMinutes: 90 });
		expect(saved.quietStart).toBeNull();
	});

	it('does not submit an invalid threshold', async () => {
		render(SettingsPage);
		const threshold = await screen.findByLabelText('Erinnern nach (Minuten)');
		await userEvent.clear(threshold);
		await userEvent.type(threshold, '10');
		await userEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
		expect(await screen.findByText('Bitte gib eine ganze Zahl von 30 bis 1440 an.')).toBeInTheDocument();
		expect(mock.calls.some((c) => c.method === 'PUT' && c.path.endsWith('/notifications/settings'))).toBe(false);
	});

	it('explains when push is unavailable on the server or unsupported/denied in the browser', async () => {
		await hook('push', { available: false });
		const first = render(SettingsPage);
		expect(await screen.findByTestId('push-state')).toHaveTextContent('Push ist auf diesem Server nicht eingerichtet.');
		first.unmount();

		await hook('push', { available: true });
		push.supported = false;
		const second = render(SettingsPage);
		expect(await screen.findByTestId('push-state')).toHaveTextContent('unterstützt keine Push-Nachrichten');
		second.unmount();

		push.supported = true;
		push.permission = 'denied';
		render(SettingsPage);
		const state = await screen.findByTestId('push-state');
		expect(state).toHaveTextContent('Zeiterfassung und Hinweise in der App funktionieren trotzdem');
		expect(screen.queryByRole('button', { name: 'Push auf diesem Gerät aktivieren' })).toBeNull();
	});

	it('enables push with the VAPID key, marks this device, sends a test and disables again', async () => {
		render(SettingsPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Push auf diesem Gerät aktivieren' }));
		await screen.findByText('Push wurde aktiviert.');
		expect(push.subscribeCalls[0]).toMatch(/^B[A-Za-z0-9_-]{86}$/);
		const row = within(await screen.findByTestId('subscription-list')).getByRole('listitem');
		expect(row).toHaveAttribute('data-this-device', 'true');
		expect(within(row).getByText('dieses Gerät')).toBeInTheDocument();
		const post = mock.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/me/push-subscriptions');
		expect(post.length).toBeGreaterThan(0);

		await userEvent.click(within(row).getByRole('button', { name: 'Testnachricht senden' }));
		await screen.findByText('Testnachricht wurde gesendet.');

		await userEvent.click(screen.getByRole('button', { name: 'Push auf diesem Gerät deaktivieren' }));
		await screen.findByText('Push wurde deaktiviert.');
		expect(push.existing).toBeNull();
		expect(screen.getByText('Noch kein Gerät hat Push aktiviert.')).toBeInTheDocument();
	});

	it('keeps tracking usable when the permission prompt is denied', async () => {
		push.requested = 'denied';
		render(SettingsPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Push auf diesem Gerät aktivieren' }));
		expect(await screen.findByText(/blockiert/)).toBeInTheDocument();
		expect(push.subscribeCalls).toHaveLength(0);
		expect(mock.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/me/push-subscriptions')).toBe(false);
	});

	it('handles the subscription limit, 429 and 502 on the test message', async () => {
		await hook('push', { maxSubscriptions: 0 });
		render(SettingsPage);
		await userEvent.click(await screen.findByRole('button', { name: 'Push auf diesem Gerät aktivieren' }));
		expect(await screen.findByText(/zu viele Geräte für Push/)).toBeInTheDocument();
		expect(push.existing).toBeNull();

		await hook('push', { maxSubscriptions: 10, testLimit: 0 });
		await userEvent.click(screen.getByRole('button', { name: 'Push auf diesem Gerät aktivieren' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Testnachricht senden' }));
		expect(await screen.findByText('Zu viele Testnachrichten. Bitte warte eine Stunde.')).toBeInTheDocument();

		await hook('push', { testLimit: 5, testResult: 'failed' });
		await userEvent.click(screen.getByRole('button', { name: 'Testnachricht senden' }));
		expect(await screen.findByText(/nicht angenommen/)).toBeInTheDocument();
	});
});
